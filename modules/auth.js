/**
 * auth.js — Login Xtream Codes + M3U + camada de fetch via XHR
 *
 * Por que XHR e não fetch?
 *  - Smart TVs antigas (Panasonic Viera, LG NetCast, Tizen 2.x) não suportam
 *    fetch + ReadableStream. XHR é universalmente suportado.
 *
 * Memória:
 *  - _MAX_ITEMS = 3000: corta listas gigantes para não estourar memória,
 *    mas alto o suficiente pra buscas trazerem muitos resultados quando
 *    o provedor não respeita &search=. api.js passa um teto explícito
 *    (15000 em busca) que sobrescreve este default.
 *  - _fetchJSONStream entrega em batches de 60 sem manter dois arrays
 *    paralelos vivos. O array original `data` é GC'd assim que terminamos.
 *
 * Migração de servidor (server_info):
 *  - O provedor troca de host de tempos em tempos e anuncia o novo em
 *    server_info.url/port. O app segue essa migração sozinho, mas SÓ em
 *    HTTP puro e só depois de provar que o candidato autentica — ver o
 *    bloco "server_info" abaixo. Revalidação: 1x por semana, em background.
 */
var Auth = (function () {
  'use strict';

  /* Default usado se o usuário deixar o campo "Servidor" vazio.
     Mesmo valor do api.js — atualize nos DOIS se trocar de provedor. */
  var IPTV_DEFAULT_BASE = 'http://191.96.78.246';

  var _credentials = null;

  var _MAX_ITEMS = 3000; /* default; api.js sobrescreve em busca (15000) */
  var _BATCH     = 60;   /* itens por chunk entregue ao UI */

  /* Intervalo mínimo entre revalidações do host via server_info. */
  var _CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000; /* 7 dias */

  /* ── XHR base ─────────────────────────────────────────── */
  function _xhrText(url, timeout) {
    if (typeof window !== 'undefined' && window.IPTV_PROXY &&
        url.indexOf(IPTV_DEFAULT_BASE + '/player_api.php?') === 0) {
      url = '/iptv' + url.substring(IPTV_DEFAULT_BASE.length);
    }
    return new Promise(function (resolve, reject) {
      var done = false;
      var xhr = new XMLHttpRequest();
      /* Default 2 min — listas grandes (15k itens de busca) podem
         demorar 60-90s em TV antiga + provedor lento. */
      var ms  = timeout || 120000;

      var timer = setTimeout(function () {
        if (done) return; done = true;
        try { xhr.abort(); } catch (e) {}
        reject(new Error('timeout'));
      }, ms);

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText || '');
        } else if (xhr.status === 0) {
          reject(new Error('rede'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };

      try {
        xhr.open('GET', url, true);
        xhr.send();
      } catch (e) {
        done = true; clearTimeout(timer); reject(e);
      }
    });
  }

  /* ── Parse JSON (com fallback base64 que alguns servidores usam) ── */
  function _parseResponse(text) {
    if (!text) return null;
    var t = text.trim();
    if (!t) return null;

    var first = t.charAt(0);
    if (first !== '[' && first !== '{') {
      var b64 = t.replace(/[\r\n\s]/g, '');
      /* Tenta base64 */
      try {
        if (/^[A-Za-z0-9+\/=]+$/.test(b64)) {
          return JSON.parse(atob(b64.charAt(0) === '=' ? b64.substring(1) : b64));
        }
      } catch (e) { /* segue para JSON normal */ }
      /* Este provedor envia JSON invertido em duas camadas de base64. */
      try {
        var envelope = atob(b64.split('').reverse().join(''))
          .match(/^([A-Za-z0-9+\/=]+)\|[0-9]+$/);
        if (envelope) {
          return JSON.parse(atob(envelope[1]).split('').reverse().join(''));
        }
      } catch (e) {}
    }

    return JSON.parse(t);
  }

  /* ── _fetchJSON: respostas pequenas (categorias, info) ── */
  function _fetchJSON(url, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));
    return _xhrText(url, timeout || 30000).then(_parseResponse);
  }

  /* ── _fetchJSONStream: listas grandes em chunks ──────────
     Importante: NÃO mantém o array original vivo enquanto entrega
     os chunks. Cortamos `data` para `_MAX_ITEMS` e deixamos o resto
     ir para o GC; depois entregamos em batches sem clonar nada.    */
  function _fetchJSONStream(url, onChunk, limit, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));

    return _xhrText(url, timeout || 120000).then(function (text) {
      var data;
      try { data = _parseResponse(text); }
      catch (e) { return Promise.reject(new Error('JSON inválido')); }

      if (!Array.isArray(data)) {
        if (onChunk) onChunk([]);
        return data || [];
      }

      /* Corta o limite ANTES de entregar — libera memória do resto */
      var cap = Math.min(data.length, limit || _MAX_ITEMS);
      if (cap < data.length) data.length = cap; /* in-place trim */

      if (!onChunk) return data;

      return new Promise(function (resolve) {
        var idx = 0;
        function next() {
          if (idx >= data.length) { resolve(data); return; }
          var end = Math.min(idx + _BATCH, data.length);
          var batch = data.slice(idx, end);
          idx = end;
          try { onChunk(batch); } catch (e) {}
          /* setTimeout 0 cede CPU pro browser pintar antes do próximo lote */
          setTimeout(next, 0);
        }
        next();
      });
    });
  }

  /* ── _fetchText: M3U playlists ────────────────────────── */
  function _fetchText(url, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));
    return _xhrText(url, timeout || 120000);
  }

  /* ── server_info: seguir a migração do provedor, mas só em HTTP ──
     O provedor às vezes troca de host e anuncia o novo em
     server_info.url/port da resposta do login. Seguir isso cegamente é
     perigoso pra TV antiga: o host anunciado costuma estar atrás de
     Cloudflare e só fechar em HTTPS/TLS moderno, que Panasonic Viera e
     LG NetCast não negociam — a TV ficaria sem conseguir conectar.

     Meio-termo aplicado aqui:
       1. Só montamos candidato em `http://` — nunca https.
       2. Descartamos se o próprio server_info.url vier com https:// colado.
       3. Só adotamos depois de PROVAR: um login real contra o candidato,
          em HTTP puro. Se não autenticar, ficamos onde estamos.
     Assim a migração é seguida quando dá, e nunca trocamos um servidor
     que funciona por um que a TV não alcança. */

  function _now() { return (new Date()).getTime(); }

  function _normalizeBase(server) {
    server = (server || '').trim();
    if (!server) return '';
    if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
    return server.replace(/\/+$/, '');
  }

  function _playerApiUrl(base, username, password) {
    /* Mandamos ambos os pares pra cobrir tanto Xtream padrão
       (username/password) quanto provedores BR (usuario/senha). */
    var u = encodeURIComponent(username);
    var p = encodeURIComponent(password);
    return base + '/player_api.php' +
      '?username=' + u + '&password=' + p +
      '&usuario=' + u + '&senha=' + p;
  }

  function _isAuthOk(data) {
    if (!data || !data.user_info) return false;
    return data.user_info.auth === 1 || data.user_info.auth === '1';
  }

  /* Monta `http://host[:porta]` a partir do server_info, ou null se o
     que veio não serve (https, host vazio/inválido). */
  function _httpBaseFromServerInfo(info) {
    if (!info) return null;

    var host = (info.url == null ? '' : String(info.url)).trim();
    if (!host) return null;

    /* Regra 2: host anunciado explicitamente como HTTPS não serve. */
    if (/^https:\/\//i.test(host)) return null;
    host = host.replace(/^http:\/\//i, '');

    /* Descarta path/query e separa porta embutida, se vier colada. */
    host = host.split('/')[0].split('?')[0];
    var inlinePort = '';
    var colon = host.indexOf(':');
    if (colon !== -1) {
      inlinePort = host.substring(colon + 1);
      host = host.substring(0, colon);
    }
    if (!host || !/^[A-Za-z0-9.\-]+$/.test(host)) return null;

    /* info.port é a porta HTTP do Xtream. info.https_port é ignorada
       de propósito — é justamente a que a TV antiga não fecha. */
    var port = (info.port == null ? '' : String(info.port)).replace(/[^0-9]/g, '');
    if (!port) port = inlinePort.replace(/[^0-9]/g, '');

    var base = 'http://' + host;
    if (port && port !== '80') base += ':' + port;
    return base;
  }

  /* Regra 3: prova o candidato com um login real antes de adotar.
     Nunca rejeita — no pior caso devolve o servidor atual. */
  function _adoptServerInfo(info, currentBase, username, password) {
    var candidate;
    try { candidate = _httpBaseFromServerInfo(info); }
    catch (e) { candidate = null; }

    if (!candidate || candidate === currentBase) {
      return Promise.resolve(currentBase);
    }

    return _fetchJSON(_playerApiUrl(candidate, username, password), 12000)
      .then(function (data) { return _isAuthOk(data) ? candidate : currentBase; })
      .catch(function ()     { return currentBase; });
  }

  /* ── Login Xtream ─────────────────────────────────────── */
  function loginXtream(server, username, password) {
    /* Se o usuário deixar o campo vazio, usa o default.
       Se digitar algo, usa o que foi digitado (permite testar IPs). */
    var typed = (server || '').trim();
    var base  = _normalizeBase(typed || IPTV_DEFAULT_BASE);

    return _fetchJSON(_playerApiUrl(base, username, password), 25000)
      .then(function (data) {
        if (!data) return { success: false, error: 'Resposta vazia' };
        if (!_isAuthOk(data)) {
          return { success: false, error: data.user_info
            ? 'Usuário ou senha incorretos' : 'Resposta inválida do servidor' };
        }

        /* Se o usuário digitou um servidor à mão, respeitamos a escolha
           dele — não trocamos por baixo dos panos. */
        var settle = typed
          ? Promise.resolve(base)
          : _adoptServerInfo(data.server_info, base, username, password);

        return settle.then(function (finalBase) {
          _credentials = {
            type: 'xtream',
            server: finalBase,
            username: username,
            password: password,
            serverCheckedAt: _now()
          };
          try { Storage.saveAuth(_credentials); } catch (e) {}
          return { success: true };
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'erro';
        if (msg === 'timeout') msg = 'Servidor não respondeu';
        else if (msg === 'rede') msg = 'Servidor inacessível ou bloqueado pelo navegador. Abra o app com node server.js.';
        else if (err && err.name === 'SyntaxError') msg = 'Resposta inválida do servidor';
        return { success: false, error: msg };
      });
  }

  /* ── Login M3U ────────────────────────────────────────── */
  function loginM3U(url) {
    return _fetchText(url, 60000).then(function (text) {
      if (!text || text.indexOf('#EXTM3U') === -1) {
        return { success: false, error: 'Arquivo M3U inválido' };
      }
      _credentials = { type: 'm3u', url: url };
      try { Storage.saveAuth(_credentials); } catch (e) {}
      return { success: true };
    }).catch(function (err) {
      return { success: false, error: (err && err.message) || 'Erro ao carregar M3U' };
    });
  }

  /* ── Sessão ───────────────────────────────────────────── */
  function restoreSession() {
    try {
      var saved = Storage.getAuth();
      if (!saved) return false;

      /* Servidores antigos que não respondem mais — força para o default.
         Isso é importante: sem isso, uma sessão antiga deixa o app sem
         carregar nenhuma lista e o usuário precisa "Limpar Tudo" no menu.
         OBS: 191.96.78.246 voltou a funcionar (provedor o usa direto
         para search server-side em PT). NÃO incluir nessa lista. */
      if (saved.type === 'xtream') {
        var s = (saved.server || '').toLowerCase();
        var STALE_SERVERS = [
          'http://bmnew26.site',
          'https://bmnew26.site',
          'https://streams4k.xyz',
          'http://streams4k.xyz',
          'https://godisfaithful.shop',
          'http://godisfaithful.shop'
        ];
        for (var i = 0; i < STALE_SERVERS.length; i++) {
          if (s.indexOf(STALE_SERVERS[i]) === 0) {
            saved.server = IPTV_DEFAULT_BASE;
            delete saved.serverInfo;
            delete saved.serverCheckedAt; /* força revalidar já no próximo boot */
            try { Storage.saveAuth(saved); } catch (e) {}
            break;
          }
        }
      }

      _credentials = saved;

      /* A sessão é restaurada do localStorage pra sempre, então sem isto
         o server_info só seria lido no primeiro login e uma migração do
         provedor nunca chegaria na TV. Revalidamos no máximo 1x por
         semana, adiado 8s pra não competir com o carregamento inicial
         das listas num aparelho lento. */
      if (saved.type === 'xtream') {
        var last = Number(saved.serverCheckedAt) || 0;
        if (_now() - last > _CHECK_INTERVAL) {
          setTimeout(_refreshServerFromInfo, 8000);
        }
      }

      return true;
    } catch (e) { return false; }
  }

  /* Fire-and-forget: relê o server_info do host atual e migra se o novo
     responder em HTTP puro. Silencioso de propósito — falha aqui não
     pode afetar a sessão nem aparecer pro usuário. */
  function _refreshServerFromInfo() {
    var c = _credentials;
    if (!c || c.type !== 'xtream') return;

    var base = _normalizeBase(c.server || IPTV_DEFAULT_BASE);

    _fetchJSON(_playerApiUrl(base, c.username, c.password), 20000)
      .then(function (data) {
        if (!_isAuthOk(data)) return null;
        return _adoptServerInfo(data.server_info, base, c.username, c.password)
          .then(function (finalBase) {
            /* logout/novo login podem ter rodado enquanto isto ia e voltava */
            if (_credentials !== c) return;
            c.server = finalBase;
            c.serverCheckedAt = _now();
            try { Storage.saveAuth(c); } catch (e) {}
          });
      })
      .catch(function () { /* mantém o servidor atual */ });
  }

  function getCredentials() { return _credentials; }
  function logout()         { _credentials = null; }

  return {
    loginXtream:     loginXtream,
    loginM3U:        loginM3U,
    restoreSession:  restoreSession,
    getCredentials:  getCredentials,
    logout:          logout,
    /* Hook opcional: força a revalidação do host via server_info agora.
       Serve pra plugar num botão tipo Configurações → "Atualizar Listas". */
    refreshServer:   _refreshServerFromInfo,
    _fetchJSON:      _fetchJSON,
    _fetchJSONStream: _fetchJSONStream,
    _fetchText:      _fetchText
  };
})();
