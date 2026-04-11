/**
 * auth.js – Autenticação Xtream Codes e parse M3U
 */

var Auth = (function () {
  'use strict';

  var _credentials = null;

  /**
   * Tenta autenticar via Xtream Codes API
   * Retorna Promise com {success, data, error}
   */
  function loginXtream(server, username, password) {
    // Normaliza URL do servidor
    var base = server.trim().replace(/\/$/, '');
    if (!base.startsWith('http')) base = 'http://' + base;

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

  /**
   * Configura conexão via URL M3U
   * Retorna Promise com {success, data, error}
   */
  function loginM3U(url) {
    url = url.trim();
    if (!url) return Promise.resolve({ success: false, error: 'URL não pode ser vazia' });
    if (!url.startsWith('http')) return Promise.resolve({ success: false, error: 'URL inválida (deve começar com http)' });

    // Testa se a URL é alcançável com um fetch simples
    return _fetchText(url).then(function (text) {
      if (!text || text.indexOf('#EXTM3U') === -1) {
        return { success: false, error: 'Arquivo M3U inválido ou vazio' };
      }
      _credentials = {
        type: 'm3u',
        url: url
      };
      Storage.saveAuth(_credentials);
      return { success: true, data: _credentials };
    }).catch(function (err) {
      return { success: false, error: 'Não foi possível carregar a lista M3U: ' + (err.message || '') };
    });
  }

  /**
   * Restaura sessão salva no localStorage
   */
  function restoreSession() {
    var saved = Storage.getAuth();
    if (saved) {
      _credentials = saved;
      return true;
    }
    return false;
  }

  function getCredentials() {
    return _credentials;
  }

  function logout() {
    _credentials = null;
    Storage.clearAuth();
  }

  // --- Helpers de fetch ---
  function _fetchJSON(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 12000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error('JSON inválido'));
          }
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('Erro de rede')); };
      xhr.ontimeout = function () { reject(new Error('Tempo de conexão esgotado')); };
      xhr.send();
    });
  }

  function _fetchText(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 20000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { reject(new Error('Erro de rede')); };
      xhr.ontimeout = function () { reject(new Error('Tempo de conexão esgotado')); };
      xhr.send();
    });
  }

  return {
    loginXtream:    loginXtream,
    loginM3U:       loginM3U,
    restoreSession: restoreSession,
    getCredentials: getCredentials,
    logout:         logout,
    _fetchJSON:     _fetchJSON,
    _fetchText:     _fetchText
  };
})();
