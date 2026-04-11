/**
 * storage.js – Módulo de persistência local
 * Gerencia favoritos, recentes e configurações no localStorage
 */

var Storage = (function () {
  'use strict';

  var KEYS = {
    favorites: 'stv_favorites',
    recents:   'stv_recents',
    settings:  'stv_settings',
    auth:      'stv_auth'
  };

  var MAX_RECENTS = 30;

  // --- Utilitário ---
  function _read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[Storage] Erro ao ler ' + key, e);
      return null;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[Storage] Erro ao escrever ' + key, e);
      return false;
    }
  }

  // --- Favoritos ---
  function getFavorites() {
    return _read(KEYS.favorites) || {};
  }

  function isFavorite(id) {
    var favorites = getFavorites();
    return !!favorites[id];
  }

  function toggleFavorite(item) {
    var favorites = getFavorites();
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id);
    if (favorites[id]) {
      delete favorites[id];
      _write(KEYS.favorites, favorites);
      return false;
    } else {
      favorites[id] = {
        id: id,
        name: item.name,
        type: item._type || 'live',
        icon: item.stream_icon || item.cover || item.series_cover || '',
        category: item.category_name || '',
        addedAt: Date.now()
      };
      _write(KEYS.favorites, favorites);
      return true;
    }
  }

  function clearFavorites() {
    _write(KEYS.favorites, {});
  }

  function getFavoritesArray() {
    var favs = getFavorites();
    var arr = [];
    for (var id in favs) {
      if (favs.hasOwnProperty(id)) arr.push(favs[id]);
    }
    // Ordena por data de adição (mais recente primeiro)
    arr.sort(function (a, b) { return b.addedAt - a.addedAt; });
    return arr;
  }

  // --- Recentes ---
  function getRecents() {
    return _read(KEYS.recents) || [];
  }

  function addRecent(item) {
    var recents = getRecents();
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id);
    // Remove se já existir
    recents = recents.filter(function (r) { return r.id !== id; });
    // Adiciona no início
    recents.unshift({
      id: id,
      name: item.name,
      type: item._type || 'live',
      icon: item.stream_icon || item.cover || item.series_cover || '',
      category: item.category_name || '',
      watchedAt: Date.now()
    });
    // Limita tamanho
    if (recents.length > MAX_RECENTS) recents = recents.slice(0, MAX_RECENTS);
    _write(KEYS.recents, recents);
  }

  function clearRecents() {
    _write(KEYS.recents, []);
  }

  // --- Configurações ---
  function getSettings() {
    var defaults = { scale: 100 };
    var saved = _read(KEYS.settings) || {};
    return Object.assign({}, defaults, saved);
  }

  function setSetting(key, value) {
    var settings = getSettings();
    settings[key] = value;
    _write(KEYS.settings, settings);
  }

  // --- Auth (credenciais) ---
  function saveAuth(data) {
    _write(KEYS.auth, data);
  }

  function getAuth() {
    return _read(KEYS.auth);
  }

  function clearAuth() {
    localStorage.removeItem(KEYS.auth);
  }

  function clearAll() {
    for (var key in KEYS) {
      if (KEYS.hasOwnProperty(key)) localStorage.removeItem(KEYS[key]);
    }
  }

  // API pública
  return {
    getFavorites:      getFavorites,
    isFavorite:        isFavorite,
    toggleFavorite:    toggleFavorite,
    clearFavorites:    clearFavorites,
    getFavoritesArray: getFavoritesArray,
    getRecents:        getRecents,
    addRecent:         addRecent,
    clearRecents:      clearRecents,
    getSettings:       getSettings,
    setSetting:        setSetting,
    saveAuth:          saveAuth,
    getAuth:           getAuth,
    clearAuth:         clearAuth,
    clearAll:          clearAll
  };
})();
