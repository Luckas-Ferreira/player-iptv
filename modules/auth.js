/**
 * auth.js – Autenticação Xtream Codes e M3U
 *
 * NOVIDADE: _fetchJSONStream(url, onChunk)
 *   Usa XHR onprogress para parsear objetos JSON conforme chegam,
 *   chamando onChunk([...items]) a cada lote recebido.
 *   Permite mostrar cards na tela antes do JSON terminar de chegar.
 */

var Auth = (function () {
  'use strict';

  var _credentials = null;

  /* ─── Proxies CORS (HTTPS → HTTP) ──────────────────────────────────────
     Tentados em ordem; se um falhar, passa pro próximo automaticamente.   */
  var _PROXIES = [
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://thingproxy.freeboard.io/fetch/'
  ];

  function _needsProxy(url) {
    if (window.location.protocol === 'https:' && url.indexOf('http://') === 0) return true;
    /* Força proxy para IPs diretos (evita CORS fail pq IPs raramente tem headers de controle) */
    var m = url.match(/^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) return true;
    return false;
  }

  /* ─── XHR simples (retorna Promise<string>) ──────────────────────────── */
  function _xhr(url, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = timeout || 30000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) resolve(x.responseText);
        else reject(new Error('HTTP ' + x.status));
      };
      x.onerror = function () { reject(new Error('Erro de rede')); };
      x.ontimeout = function () { reject(new Error('Tempo esgotado')); };
      x.send();
    });
  }

  /* ─── Cascata de proxies (texto) ─────────────────────────────────────── */
  function _fetchText(url, timeout) {
    if (!_needsProxy(url)) return _xhr(url, timeout);
    return _tryProxy(url, 0, timeout);
  }

  function _tryProxy(url, idx, timeout) {
    if (idx >= _PROXIES.length) {
      return Promise.reject(new Error(
        'Não foi possível acessar o servidor. Verifique se o endereço está correto.'
      ));
    }
    return _xhr(_PROXIES[idx] + encodeURIComponent(url), timeout).catch(function (err) {
      console.warn('[Auth] Proxy ' + _PROXIES[idx] + ' falhou (' + err.message + ')');
      return _tryProxy(url, idx + 1, timeout);
    });
  }

  function _fetchJSON(url) {
    return _fetchText(url, 30000).then(function (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('Resposta inválida do servidor (não é JSON)'); }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     STREAMING JSON — parseia objetos conforme chegam via onprogress
     ═══════════════════════════════════════════════════════════════════════
     Retorna Promise<Array> que resolve com TODOS os itens ao final.
     onChunk(items[]) é chamado progressivamente a cada lote detectado.    */
  function _fetchJSONStream(url, onChunk) {
    var proxied = _needsProxy(url) ? (_PROXIES[0] + encodeURIComponent(url)) : url;
    return _doStreamXHR(proxied, url, 0, onChunk);
  }

  function _doStreamXHR(proxied, original, proxyIdx, onChunk) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      var pos = 0;         // posição já processada no responseText
      var all = [];        // todos os itens recebidos
      var maxItems = 3000;  // Limite reduzido drasticamente para 3k para salvar a memória das TVs
      var finished = false; // Flag para evitar duplos retornos

      x.open('GET', proxied, true);
      /* Aumentado timeout para 90s pois listas gigantes demoram para passar pelo proxy */
      x.timeout = 90000;

      /* ── Recebe dados parciais ────────────────────────────────────────── */
      x.onprogress = function () {
        if (finished) return;
        try {
          var text = '';
          try { text = x.responseText; } catch(e) { return; }
          
          if (!text || text.length <= pos) return;
          
          var result = _parseStreamBuf(text, pos);
          if (result.items.length > 0) {
            var toAdd = result.items;
            if (all.length + toAdd.length > maxItems) {
              toAdd = toAdd.slice(0, maxItems - all.length);
            }
            
            if (toAdd.length > 0) {
              all = all.concat(toAdd);
              try { onChunk(toAdd); } catch (e) { }
            }

            /* Se atingiu o limite, ABORTA a conexão imediatamente para parar de consumir RAM */
            if (all.length >= maxItems) {
              finished = true;
              console.warn('[Auth] Limite de segurança (3k) atingido. Abortando download para salvar memória.');
              try { x.abort(); } catch(e) {}
              resolve(all);
              return;
            }
          }
          pos = result.nextPos;
          text = null; // Ajuda o GC
        } catch (e) {
          console.warn('[Auth] Erro no streaming:', e.message);
        }
      };

      /* ── Fim da resposta ─────────────────────────────────────────────── */
      x.onload = function () {
        if (finished) return;
        if (x.status >= 200 && x.status < 300) {
          var text = x.responseText;
          /* Processa qualquer resto que onprogress não pegou */
          if (text.length > pos) {
            var result = _parseStreamBuf(text, pos);
            if (result.items.length > 0 && all.length < maxItems) {
              var toAdd = result.items.slice(0, maxItems - all.length);
              all = all.concat(toAdd);
              try { onChunk(toAdd); } catch (e) { }
            }
          }
          /* Se não chegou nada via streaming, tenta parse completo */
          if (all.length === 0) {
            try { 
              all = JSON.parse(text) || []; 
              if (all && !Array.isArray(all)) all = [all];
              if (all.length > maxItems) all = all.slice(0, maxItems);
              if (all.length > 0) try { onChunk(all); } catch (e) { }
            } catch (e) {
              reject(new Error('Falha ao processar lista gigante (Memória insuficiente)'));
              return;
            }
          }
          finished = true;
          resolve(all);
        } else {
          _tryNextProxy(original, proxyIdx, onChunk, resolve, reject, new Error('HTTP ' + x.status));
        }
      };

      x.onerror = function () { 
        if (finished) return;
        _tryNextProxy(original, proxyIdx, onChunk, resolve, reject, new Error('Erro de conexão com o servidor')); 
      };
      x.ontimeout = function () { 
        if (finished) return;
        _tryNextProxy(original, proxyIdx, onChunk, resolve, reject, new Error('O servidor demorou muito para responder (Timeout)')); 
      };
      x.send();
    });
  }

  function _tryNextProxy(original, proxyIdx, onChunk, resolve, reject, err) {
    var next = proxyIdx + 1;
    if (!_needsProxy(original)) { reject(err); return; }
    if (next >= _PROXIES.length) { reject(new Error('Todos os proxies falharam: ' + err.message)); return; }
    console.warn('[Auth] Proxy ' + proxyIdx + ' falhou (' + err.message + '), tentando ' + next + '...');
    _doStreamXHR(_PROXIES[next] + encodeURIComponent(original), original, next, onChunk)
      .then(resolve).catch(reject);
  }

  /* ─── Parser incremental de JSON Array ───────────────────────────────────
     Extrai objetos JSON completos (top-level items de um array) do buffer
     parcial. Retorna { items: [...], nextPos: N }.                          */
  function _parseStreamBuf(buf, startPos) {
    var items = [];
    var i = startPos;
    var len = buf.length;

    /* Avança até o primeiro '{' */
    while (i < len && buf[i] !== '{') i++;

    while (i < len) {
      if (buf[i] !== '{') { i++; continue; }

      var start = i;
      var depth = 0;
      var inStr = false;
      var esc = false;
      var end = -1;

      for (var j = i; j < len; j++) {
        var c = buf[j];
        if (esc) { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        if (c === '}') {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }

      if (end === -1) break; /* Objeto incompleto — espera mais dados */

      try {
        var obj = JSON.parse(buf.substring(start, end + 1));
        items.push(obj);
      } catch (e) { /* Ignora objeto malformado */ }

      i = end + 1;
      /* Avança vírgulas e whitespace entre objetos */
      while (i < len && (buf[i] === ',' || buf[i] === ' ' ||
        buf[i] === '\n' || buf[i] === '\r' || buf[i] === '\t')) i++;
    }

    return { items: items, nextPos: i };
  }

  /* ─── Proxy de Imagens (CORS/SSL bypass) ───────────────────────────────── */
  function getProxiedImageUrl(url) {
    if (!url) return '';
    // Se a URL já for HTTPS em uma página HTTP, browsers antigos podem reclamar se o cert for novo
    // Usamos um dos proxies conhecidos para "limpar" a requisição
    return _PROXIES[0] + encodeURIComponent(url);
  }

  /* ─── Login Xtream Codes ──────────────────────────────────────────────── */
  function loginXtream(server, username, password) {
    var base = server.trim().replace(/\/$/, '');
    if (base.indexOf('http') !== 0) base = 'http://' + base;
    var url = base + '/player_api.php?username=' + encodeURIComponent(username) +
      '&password=' + encodeURIComponent(password);

    return _fetchJSON(url).then(function (data) {
      if (!data) return { success: false, error: 'Resposta inválida do servidor' };
      if (data.user_info && data.user_info.auth === 1) {
        _credentials = {
          type: 'xtream', server: base, username: username,
          password: password, userInfo: data.user_info, serverInfo: data.server_info
        };
        Storage.saveAuth(_credentials);
        return { success: true, data: _credentials };
      } else if (data.user_info && data.user_info.auth === 0) {
        return { success: false, error: 'Usuário ou senha incorretos' };
      }
      return { success: false, error: 'Servidor não reconhecido como Xtream Codes' };
    }).catch(function (err) {
      return { success: false, error: 'Falha de conexão: ' + (err.message || 'verifique o servidor') };
    });
  }

  /* ─── Login M3U ───────────────────────────────────────────────────────── */
  function loginM3U(url) {
    url = url.trim();
    if (!url) return Promise.resolve({ success: false, error: 'URL não pode ser vazia' });
    if (url.indexOf('http') !== 0) return Promise.resolve({ success: false, error: 'URL inválida' });
    return _fetchText(url, 45000).then(function (text) {
      if (!text || text.indexOf('#EXTM3U') === -1)
        return { success: false, error: 'Arquivo M3U inválido ou vazio' };
      _credentials = { type: 'm3u', url: url };
      Storage.saveAuth(_credentials);
      return { success: true, data: _credentials };
    }).catch(function (err) {
      return { success: false, error: 'Não foi possível carregar a lista M3U: ' + (err.message || '') };
    });
  }

  /* ─── Sessão (lê só localStorage, zero rede) ─────────────────────────── */
  function restoreSession() {
    var saved = Storage.getAuth();
    if (saved) { _credentials = saved; return true; }
    return false;
  }

  function getCredentials() { return _credentials; }
  function logout() { _credentials = null; Storage.clearAuth(); }

  function getProxiedUrl(url, force, proxyIdx) {
    if (force || _needsProxy(url)) {
      var idx = (proxyIdx !== undefined && proxyIdx < _PROXIES.length) ? proxyIdx : 0;
      return _PROXIES[idx] + encodeURIComponent(url);
    }
    return url;
  }

  return {
    loginXtream: loginXtream,
    loginM3U: loginM3U,
    restoreSession: restoreSession,
    getCredentials: getCredentials,
    logout: logout,
    getProxiedUrl: getProxiedUrl,
    _fetchJSON: _fetchJSON,
    _fetchText: _fetchText,
    _fetchJSONStream: _fetchJSONStream
  };
})();
