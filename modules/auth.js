var Auth = (function () {
  'use strict';

  var _credentials = null;

  /* ─── Lista de proxies CORS ─────────────────────────────────────────────────
     Quando o site está em HTTPS mas o servidor IPTV é HTTP,
     o browser bloqueia o acesso direto (mixed-content).
     Tentamos cada proxy em ordem até um funcionar.                            */
  var _PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://thingproxy.freeboard.io/fetch/'
  ];

  function _needsProxy(url) {
    return window.location.protocol === 'https:' && url.indexOf('http://') === 0;
  }

  /* ─── XHR genérico (retorna Promise<string>) ──────────────────────────── */
  function _xhr(url, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.timeout = timeout || 30000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          resolve(x.responseText);
        } else {
          reject(new Error('HTTP ' + x.status));
        }
      };
      x.onerror = function () { reject(new Error('Erro de rede')); };
      x.ontimeout = function () { reject(new Error('Tempo esgotado')); };
      x.send();
    });
  }

  /* ─── Tenta cada proxy em cascata ────────────────────────────────────── */
  function _fetchText(url, timeout) {
    if (!_needsProxy(url)) {
      return _xhr(url, timeout);
    }
    return _tryProxy(url, 0, timeout);
  }

  function _tryProxy(url, idx, timeout) {
    if (idx >= _PROXIES.length) {
      return Promise.reject(new Error(
        'Não foi possível acessar o servidor. ' +
        'Verifique se o endereço está correto ou tente usar HTTPS no servidor.'
      ));
    }
    var proxied = _PROXIES[idx] + encodeURIComponent(url);
    return _xhr(proxied, timeout).catch(function (err) {
      console.warn('[Auth] Proxy ' + _PROXIES[idx] + ' falhou (' + err.message + '). Tentando próximo…');
      return _tryProxy(url, idx + 1, timeout);
    });
  }

  function _fetchJSON(url) {
    return _fetchText(url, 30000).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('Resposta inválida do servidor (não é JSON)');
      }
    });
  }

  /* ─── Login Xtream Codes ──────────────────────────────────────────────── */
  function loginXtream(server, username, password) {
    var base = server.trim().replace(/\/$/, '');
    if (base.indexOf('http') !== 0) base = 'http://' + base;

    var url = base + '/player_api.php?username=' + encodeURIComponent(username) +
      '&password=' + encodeURIComponent(password);

    return _fetchJSON(url).then(function (data) {
      if (!data) {
        return { success: false, error: 'Resposta inválida do servidor' };
      }
      if (data.user_info && data.user_info.auth === 1) {
        _credentials = {
          type: 'xtream',
          server: base,
          username: username,
          password: password,
          userInfo: data.user_info,
          serverInfo: data.server_info
        };
        Storage.saveAuth(_credentials);
        return { success: true, data: _credentials };
      } else if (data.user_info && data.user_info.auth === 0) {
        return { success: false, error: 'Usuário ou senha incorretos' };
      } else {
        return { success: false, error: 'Servidor não reconhecido como Xtream Codes' };
      }
    }).catch(function (err) {
      return { success: false, error: 'Falha de conexão: ' + (err.message || 'verifique o servidor') };
    });
  }

  /* ─── Login M3U ───────────────────────────────────────────────────────── */
  function loginM3U(url) {
    url = url.trim();
    if (!url) return Promise.resolve({ success: false, error: 'URL não pode ser vazia' });
    if (url.indexOf('http') !== 0) return Promise.resolve({ success: false, error: 'URL inválida (deve começar com http)' });

    return _fetchText(url, 45000).then(function (text) {
      if (!text || text.indexOf('#EXTM3U') === -1) {
        return { success: false, error: 'Arquivo M3U inválido ou vazio' };
      }
      _credentials = { type: 'm3u', url: url };
      Storage.saveAuth(_credentials);
      return { success: true, data: _credentials };
    }).catch(function (err) {
      return { success: false, error: 'Não foi possível carregar a lista M3U: ' + (err.message || '') };
    });
  }

  /* ─── Sessão ──────────────────────────────────────────────────────────────
     restoreSession() lê APENAS o localStorage — sem chamadas de rede.
     Isso garante que F5 / refresh volta direto para a tela principal
     sem precisar re-autenticar.                                              */
  function restoreSession() {
    var saved = Storage.getAuth();
    if (saved) {
      _credentials = saved;
      return true;
    }
    return false;
  }

  function getCredentials() { return _credentials; }

  function logout() {
    _credentials = null;
    Storage.clearAuth();
  }

  /* ─── Proxy público para URLs de stream ──────────────────────────────── */
  function getProxiedUrl(url) {
    if (!_needsProxy(url)) return url;
    return _PROXIES[0] + encodeURIComponent(url);
  }

  return {
    loginXtream: loginXtream,
    loginM3U: loginM3U,
    restoreSession: restoreSession,
    getCredentials: getCredentials,
    logout: logout,
    getProxiedUrl: getProxiedUrl,
    _fetchJSON: _fetchJSON,
    _fetchText: _fetchText
  };
})();