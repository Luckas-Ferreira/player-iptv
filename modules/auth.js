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
 */
var Auth = (function () {
  'use strict';

  /* Default usado se o usuário deixar o campo "Servidor" vazio.
     Mesmo valor do api.js — atualize nos DOIS se trocar de provedor. */
  var IPTV_DEFAULT_BASE = 'http://bmnew26.site';

  var _credentials = null;

  var _MAX_ITEMS = 3000; /* default; api.js sobrescreve em busca (15000) */
  var _BATCH     = 60;   /* itens por chunk entregue ao UI */

  /* ── XHR base ─────────────────────────────────────────── */
  function _xhrText(url, timeout) {
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
      /* Tenta base64 */
      try {
        var b64 = t.replace(/[\r\n\s]/g, '');
        if (b64.charAt(0) === '=') b64 = b64.substring(1);
        if (/^[A-Za-z0-9+\/=]+$/.test(b64)) {
          return JSON.parse(atob(b64));
        }
      } catch (e) { /* segue para JSON normal */ }
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

  /* ── Login Xtream ─────────────────────────────────────── */
  function loginXtream(server, username, password) {
    /* Se o usuário deixar o campo vazio, usa o default.
       Se digitar algo, usa o que foi digitado (permite testar IPs). */
    server = (server || '').trim();
    if (!server) server = IPTV_DEFAULT_BASE;
    if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
    server = server.replace(/\/+$/, '');

    var base = server;

    /* Mandamos ambos os pares pra cobrir tanto Xtream padrão
       (username/password) quanto provedores BR (usuario/senha). */
    var u = encodeURIComponent(username);
    var p = encodeURIComponent(password);
    var url = base + '/player_api.php' +
      '?username=' + u + '&password=' + p +
      '&usuario=' + u + '&senha=' + p;

    return _fetchJSON(url, 25000).then(function (data) {
      if (!data) return { success: false, error: 'Resposta vazia' };
      if (data.user_info && data.user_info.auth === 0) {
        return { success: false, error: 'Usuário ou senha incorretos' };
      }
      _credentials = {
        type: 'xtream',
        server: server,
        username: username,
        password: password
      };
      try { Storage.saveAuth(_credentials); } catch (e) {}
      return { success: true };
    }).catch(function (err) {
      var msg = (err && err.message) || 'erro';
      if (msg === 'timeout') msg = 'Servidor não respondeu';
      else if (msg === 'rede') msg = 'Servidor inacessível';
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
          'https://streams4k.xyz',
          'http://streams4k.xyz',
          'https://godisfaithful.shop',
          'http://godisfaithful.shop'
        ];
        for (var i = 0; i < STALE_SERVERS.length; i++) {
          if (s.indexOf(STALE_SERVERS[i]) === 0) {
            saved.server = IPTV_DEFAULT_BASE;
            delete saved.serverInfo;
            try { Storage.saveAuth(saved); } catch (e) {}
            break;
          }
        }
      }

      _credentials = saved;
      return true;
    } catch (e) { return false; }
  }

  function getCredentials() { return _credentials; }
  function logout()         { _credentials = null; }

  return {
    loginXtream:     loginXtream,
    loginM3U:        loginM3U,
    restoreSession:  restoreSession,
    getCredentials:  getCredentials,
    logout:          logout,
    _fetchJSON:      _fetchJSON,
    _fetchJSONStream: _fetchJSONStream,
    _fetchText:      _fetchText
  };
})();
