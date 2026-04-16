/**
 * auth.js – REESCRITO para TV antiga (Panasonic)
 * Usa XMLHttpRequest em vez de fetch() + ReadableStream
 *
 * CORREÇÕES v2:
 * 1. Timeout de _fetchJSONStream: 45s → 120s
 *    Listas grandes (séries, filmes) podem demorar 60-90s para chegar.
 * 2. Timeout de _fetchJSON: 20s → 30s (categorias podem ser lentas)
 * 3. Timeout de login: 20s → 30s
 * 4. getProxiedImageUrl: REMOVIDO proxy images.weserv.nl
 *    Tags <img> NÃO precisam de proxy CORS — o browser carrega qualquer URL.
 *    O proxy estava causando 30+ requisições extras que travavam a TV.
 */
var Auth = (function () {
  'use strict';

  var _credentials = null;
  var _MAX_ITEMS = 3000;

  /* ── XHR Base ─────────────────────────────────────────── */
  function _xhrText(url, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var xhr = new XMLHttpRequest();
      var ms = timeout || 120000; /* padrão 2 minutos */

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { xhr.abort(); } catch (e) { }
        reject(new Error('timeout'));
      }, ms);

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText || '');
        } else if (xhr.status === 0) {
          reject(new Error('network error'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };

      xhr.onerror = function () {
        if (done) return; done = true;
        clearTimeout(timer);
        reject(new Error('network error'));
      };

      xhr.onabort = function () {
        if (done) return; done = true;
        clearTimeout(timer);
        reject(new Error('aborted'));
      };

      try {
        xhr.open('GET', url, true);
        xhr.send();
      } catch (e) {
        done = true; clearTimeout(timer); reject(e);
      }
    });
  }

  /* ── Parse JSON ou Base64 (como o LIVEBOX usa) ────────── */
  function _parseResponse(text) {
    if (!text) return null;
    var t = text.trim();
    if (!t) return null;

    /* Detecta base64: começa com '=' ou não tem [ nem { */
    var looksB64 = t.charAt(0) === '=';
    if (!looksB64 && t.charAt(0) !== '[' && t.charAt(0) !== '{') {
      var sample = t.replace(/[\r\n]/g, '').substring(0, 80);
      looksB64 = /^[A-Za-z0-9+\/=]+$/.test(sample);
    }

    if (looksB64) {
      try {
        var b64 = t.replace(/[\r\n\s]/g, '');
        if (b64.charAt(0) === '=') b64 = b64.substring(1);
        return JSON.parse(atob(b64));
      } catch (e) { /* não era base64, continua */ }
    }

    try {
      return JSON.parse(t);
    } catch (e) {
      throw new Error('JSON inválido: ' + e.message);
    }
  }

  /* ── _fetchJSON: respostas pequenas (categorias, info) ── */
  function _fetchJSON(url, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));
    return _xhrText(url, timeout || 30000).then(function (text) { /* AUMENTADO: 20s → 30s */
      return _parseResponse(text);
    });
  }

  /* ── _fetchJSONStream: listas grandes (filmes, séries) ───
     CORREÇÃO: timeout aumentado de 45s → 120s.
     Listas com milhares de itens podem demorar 60-90s dependendo
     da velocidade do servidor e do tamanho do payload.              */
  function _fetchJSONStream(url, onChunk, limit, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));

    return _xhrText(url, timeout || 120000).then(function (text) { /* AUMENTADO: 45s → 120s */
      var data;
      try { data = _parseResponse(text); }
      catch (e) { return Promise.reject(e); }

      if (!Array.isArray(data)) {
        if (onChunk) onChunk([]);
        return data || [];
      }

      var total = Math.min(data.length, limit || _MAX_ITEMS);
      if (!onChunk) return data.slice(0, total);

      var BATCH = 50;
      var idx = 0;

      return new Promise(function (resolve) {
        function deliverNext() {
          if (idx >= total) { resolve(data.slice(0, total)); return; }
          var end = Math.min(idx + BATCH, total);
          var batch = data.slice(idx, end);
          idx = end;
          if (batch.length > 0) {
            try { onChunk(batch); } catch (e) { }
          }
          setTimeout(deliverNext, 0);
        }

        if (total > 0) {
          var first = data.slice(0, Math.min(BATCH, total));
          idx = first.length;
          try { onChunk(first); } catch (e) { }
          if (idx < total) setTimeout(deliverNext, 0);
          else resolve(data.slice(0, total));
        } else {
          resolve([]);
        }
      });
    });
  }

  /* ── _fetchText: playlists M3U ────────────────────────── */
  function _fetchText(url, timeout) {
    if (!url) return Promise.reject(new Error('URL inválida'));
    return _xhrText(url, timeout || 120000); /* AUMENTADO: 60s → 120s */
  }

  /* ── Proxy de imagens ─────────────────────────────────── */
  /*
   * CORREÇÃO: getProxiedImageUrl agora retorna a URL ORIGINAL sem proxy.
   *
   * Por quê removemos o proxy images.weserv.nl?
   * ─────────────────────────────────────────────
   * Tags <img src="..."> NÃO têm restrição de CORS no browser.
   * O proxy só seria necessário para chamadas XHR/fetch de imagens,
   * o que não fazemos — usamos apenas <img>.
   *
   * Na prática, o proxy estava causando 30-50 requisições extras para
   * images.weserv.nl que falhavam na TV (timeout ou bloqueio de rede),
   * gerando uma "tempestade" de conexões que travava o browser da TV.
   */
  function getProxiedImageUrl(url) {
    return url; /* Retorna direto — sem proxy para imagens */
  }

  function getProxiedUrl(url, isStream, idx) {
    if (!url || isStream) return url;
    var proxies = ['https://corsproxy.io/?', 'https://api.allorigins.win/raw?url='];
    var i = Math.max(0, Math.min(idx || 0, proxies.length - 1));
    return proxies[i] + encodeURIComponent(url);
  }

  /* ── Login Xtream ─────────────────────────────────────── */
  function loginXtream(server, username, password) {
    server = (server || '').trim();
    if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
    server = server.replace(/\/+$/, '');

    var url = server + '/player_api.php?username=' + encodeURIComponent(username) +
      '&password=' + encodeURIComponent(password);

    return _fetchJSON(url, 30000).then(function (data) { /* AUMENTADO: 20s → 30s */
      if (!data) return { success: false, error: 'Resposta vazia' };
      if (data.user_info && data.user_info.auth === 0)
        return { success: false, error: 'Usuário ou senha incorretos' };

      _credentials = {
        type: 'xtream', server: server,
        username: username, password: password,
        serverInfo: data.server_info || null,
        userInfo: data.user_info || null
      };
      try { Storage.saveAuth(_credentials); } catch (e) { }
      return { success: true, data: data };
    }).catch(function (err) {
      var msg = (err && err.message) || 'erro';
      if (msg.indexOf('timeout') !== -1) msg = 'Servidor não respondeu a tempo';
      else if (msg.indexOf('network') !== -1) msg = 'Servidor inacessível';
      return { success: false, error: msg };
    });
  }

  /* ── Login M3U ────────────────────────────────────────── */
  function loginM3U(url) {
    return _fetchText(url, 120000).then(function (text) { /* AUMENTADO: 30s → 120s */
      if (!text || text.indexOf('#EXTM3U') === -1)
        return { success: false, error: 'Arquivo M3U inválido' };
      _credentials = { type: 'm3u', url: url };
      try { Storage.saveAuth(_credentials); } catch (e) { }
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
      _credentials = saved;
      return true;
    } catch (e) { return false; }
  }

  function getCredentials() { return _credentials; }
  function logout() { _credentials = null; }

  return {
    loginXtream: loginXtream, loginM3U: loginM3U,
    restoreSession: restoreSession, getCredentials: getCredentials,
    logout: logout,
    _fetchJSON: _fetchJSON, _fetchJSONStream: _fetchJSONStream,
    _fetchText: _fetchText,
    getProxiedUrl: getProxiedUrl, getProxiedImageUrl: getProxiedImageUrl
  };
})();