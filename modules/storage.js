/**
 * storage.js – Módulo de persistência local
 * Gerencia favoritos, recentes e configurações no localStorage
 */

var Storage = (function () {
  'use strict';

  var KEYS = {
    favorites: 'stv_favorites',
    recents: 'stv_recents',
    settings: 'stv_settings',
    auth: 'stv_auth',
    progress: 'stv_progress',
    cache: 'stv_cache_'
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

  // --- Progresso de Vídeo (Continuar Assistindo) ---
  function getProgress(id) {
    var all = _read(KEYS.progress) || {};
    return all[id] || null;
  }

  function getProgressArray() {
    var all = _read(KEYS.progress) || {};
    var arr = [];
    var seriesMap = {};

    for (var id in all) {
      if (!all.hasOwnProperty(id)) continue;
      var p = all[id];
      var item = {
        id: id,
        stream_id: p.type === 'live' ? id : null,
        vod_id: p.type === 'movie' ? id : null,
        series_id: p.type === 'series' ? (p.series_id || null) : null,
        _episodeId: p.type === 'series' ? id : null,
        _episodeExt: p.episodeExt || 'mkv',
        name: p.name || 'Sem nome',
        _type: p.type || 'movie',
        stream_icon: p.icon || '',
        cover: p.icon || '',
        series_cover: p.icon || '',
        category_name: p.type === 'movie' ? 'Filmes' : (p.type === 'series' ? 'Séries' : 'TV'),
        _resumeTime: p.time || 0,
        updatedAt: p.updatedAt || 0
      };

      if (p.type === 'series' && p.series_id) {
        var sid = String(p.series_id);
        if (!seriesMap[sid] || p.updatedAt > seriesMap[sid].updatedAt) {
          seriesMap[sid] = item;
        }
      } else {
        arr.push(item);
      }
    }

    // Adiciona o episódio mais recente de cada série ao array final
    for (var s in seriesMap) {
      if (seriesMap.hasOwnProperty(s)) arr.push(seriesMap[s]);
    }

    arr.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return arr;
  }

  function getSeriesProgress(seriesId) {
    if (!seriesId) return null;
    var all = _read(KEYS.progress) || {};
    var latest = null;
    var sid = String(seriesId);
    for (var id in all) {
      if (!all.hasOwnProperty(id)) continue;
      var p = all[id];
      if (p.type === 'series' && String(p.series_id) === sid) {
        if (!latest || p.updatedAt > latest.updatedAt) latest = p;
      }
    }
    return latest;
  }

  function removeProgress(id) {
    if (!id) return;
    var all = _read(KEYS.progress) || {};
    if (all[id]) {
      delete all[id];
      _write(KEYS.progress, all);
      return true;
    }
    return false;
  }

  function saveProgress(id, time, duration, item) {
    if (!id || !duration || duration < 5) return;
    var all = _read(KEYS.progress) || {};
    var pct = (time / duration) * 100;

    if (pct > 98 || time < 5) {
      if (all[id]) {
        delete all[id];
        _write(KEYS.progress, all);
      }
      return;
    }

    var existing = all[id] || {};
    all[id] = {
      name: item ? (item.name || existing.name || 'Sem nome') : (existing.name || 'Sem nome'),
      type: item ? (item._type || existing.type || 'movie') : (existing.type || 'movie'),
      icon: item ? (item.stream_icon || item.cover || item.series_cover || existing.icon || '') : (existing.icon || ''),
      series_id: item ? (item.series_id || existing.series_id || null) : (existing.series_id || null),
      episodeExt: item ? (item._episodeExt || existing.episodeExt || 'mkv') : (existing.episodeExt || 'mkv'),
      time: time,
      duration: duration,
      pct: pct,
      updatedAt: Date.now()
    };
    _write(KEYS.progress, all);
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
      if (KEYS.hasOwnProperty(key)) {
        if (key === 'cache') {
          // Limpa todos os itens que começam com o prefixo de cache
          for (var i = 0; i < localStorage.length; i++) {
            var lk = localStorage.key(i);
            if (lk && lk.indexOf(KEYS.cache) === 0) {
              localStorage.removeItem(lk); i--;
            }
          }
        } else {
          localStorage.removeItem(KEYS[key]);
        }
      }
    }
  }

  // --- Cache de dados (Persistent) ---
  // DESATIVADO: Cache causava erros de "Nenhum item encontrado" em TVs com pouco storage
  function saveCache(key, data) {
    return true; // Mentimos que salvou para não quebrar chamadas antigas
  }

  function getCache(key) {
    return null; // Sempre retorna null para forçar carregamento da rede
  }

  // API pública
  return {
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    clearFavorites: clearFavorites,
    getFavoritesArray: getFavoritesArray,
    getRecents: getRecents,
    addRecent: addRecent,
    clearRecents: clearRecents,
    getSettings: getSettings,
    setSetting: setSetting,
    saveAuth: saveAuth,
    getAuth: getAuth,
    clearAuth: clearAuth,
    getProgress: getProgress,
    getProgressArray: getProgressArray,
    getSeriesProgress: getSeriesProgress,
    removeProgress: removeProgress,
    saveProgress: saveProgress,
    saveCache: saveCache,
    getCache: getCache,
    clearAll: clearAll
  };
})();
