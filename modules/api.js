/**
 * api.js — Xtream Codes + M3U
 *
 * REGRA DE SERVIDOR (URL Builder):
 *  1. Se o usuário digitou algo no login (c.server), USA ISSO.
 *     → Permite testar IPs diferentes sem mexer no código.
 *  2. Senão, cai no DEFAULT abaixo (`IPTV_DEFAULT_BASE`).
 *
 * Por que existe um DEFAULT:
 *  - Domínio streams4k.xyz força HTTPS via Cloudflare e Smart TVs
 *    antigas (Panasonic Viera, LG NetCast) NÃO negociam o TLS moderno.
 *  - O default `http://bmnew26.site` é o servidor real informado pelo
 *    próprio Xtream Codes (campo server_info.url da resposta do login).
 *  - Se o usuário descobrir um IP de origem direto (sem Cloudflare),
 *    basta digitar no campo "Servidor" do login — ele substitui o default.
 *
 * Cache em memória — limpa via Configurações → "Atualizar Listas"
 */
var API = (function () {
  'use strict';

  /* Default usado quando o usuário não digitou nada no login. */
  var IPTV_DEFAULT_BASE = 'http://bmnew26.site';

  var cache = {};

  /* ── URL Builder ─────────────────────────────────────── */
  function _base() {
    var c = Auth.getCredentials();
    if (c && c.server && c.server.indexOf('http') === 0) {
      return c.server.replace(/\/+$/, '');
    }
    return IPTV_DEFAULT_BASE;
  }

  function _xtreamUrl(action, extra) {
    var c = Auth.getCredentials();
    if (!c || c.type !== 'xtream') return null;
    var url = _base() + '/player_api.php' +
      '?username=' + encodeURIComponent(c.username) +
      '&password=' + encodeURIComponent(c.password) +
      '&action=' + action;
    if (extra) url += extra;
    return url;
  }

  /* ── Categorias ─────────────────────────────────────── */
  function _fetchCategories(action, key) {
    if (cache[key]) return Promise.resolve(cache[key]);
    return Auth._fetchJSON(_xtreamUrl(action)).then(function (d) {
      cache[key] = d || [];
      return cache[key];
    });
  }

  function getLiveCategories()   { return _fetchCategories('get_live_categories',   'cats_live'); }
  function getVodCategories()    { return _fetchCategories('get_vod_categories',    'cats_vod'); }
  function getSeriesCategories() { return _fetchCategories('get_series_categories', 'cats_series'); }

  /* ── Streams ─────────────────────────────────────────── */
  function _fetchStreams(action, typeTag, categoryId, onChunk, search) {
    var key = search
      ? (typeTag + '_search_' + search)
      : (typeTag + '_' + (categoryId || 'all'));

    var extra = search
      ? '&search=' + encodeURIComponent(search)
      : (categoryId ? '&category_id=' + categoryId : '');

    var url = _xtreamUrl(action, extra);

    /* Cache hit */
    if (cache[key]) {
      if (onChunk) onChunk(cache[key]);
      return Promise.resolve(cache[key]);
    }

    function tag(arr) {
      for (var i = 0; i < arr.length; i++) arr[i]._type = typeTag;
      return arr;
    }

    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(tag(chunk));
      }, search ? 5000 : 1500).then(function (all) {
        cache[key] = tag(all);
        return cache[key];
      });
    }

    return Auth._fetchJSON(url).then(function (data) {
      cache[key] = tag(data || []);
      return cache[key];
    });
  }

  function getLiveStreams(catId, onChunk, search) {
    return _fetchStreams('get_live_streams', 'live', catId, onChunk, search);
  }
  function getVodStreams(catId, onChunk, search) {
    return _fetchStreams('get_vod_streams', 'movie', catId, onChunk, search);
  }
  function getSeriesList(catId, onChunk, search) {
    return _fetchStreams('get_series', 'series', catId, onChunk, search);
  }

  /* ── Info detalhada ──────────────────────────────────── */
  function getVodInfo(vodId) {
    return Auth._fetchJSON(_xtreamUrl('get_vod_info', '&vod_id=' + vodId));
  }
  function getSeriesInfo(seriesId) {
    return Auth._fetchJSON(_xtreamUrl('get_series_info', '&series_id=' + seriesId));
  }

  /* ── URLs de Stream ──────────────────────────────────── */
  function getLiveStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return _base() + '/live/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'm3u8');
  }
  function getVodStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return _base() + '/movie/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mp4');
  }
  function getEpisodeStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return _base() + '/series/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mkv');
  }

  /* ── M3U ─────────────────────────────────────────────── */
  function _parseM3U(text) {
    var lines = text.split('\n'), items = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        cur = _parseExtInf(line);
      } else if (cur && line[0] !== '#') {
        cur.url = line;
        cur._type = _detectType(line, cur.group);
        items.push(cur);
        cur = null;
      }
    }
    return items;
  }

  function _parseExtInf(line) {
    var item = {}, lc = line.lastIndexOf(','), m;
    item.name = lc !== -1 ? line.substring(lc + 1).trim() : 'Sem nome';
    m = line.match(/tvg-logo="([^"]+)"/); if (m) item.stream_icon = m[1];
    m = line.match(/group-title="([^"]+)"/); if (m) item.category_name = m[1];
    item.group = item.category_name || 'Sem Categoria';
    return item;
  }

  function _detectType(url, group) {
    var g = (group || '').toLowerCase(), u = (url || '').toLowerCase();
    if (g.indexOf('movie') !== -1 || g.indexOf('filme') !== -1) return 'movie';
    if (g.indexOf('serie') !== -1 || g.indexOf('série') !== -1) return 'series';
    if (u.indexOf('/movie/') !== -1) return 'movie';
    if (u.indexOf('/series/') !== -1) return 'series';
    return 'live';
  }

  function loadM3U() {
    if (cache.m3u) return Promise.resolve(cache.m3u);
    var c = Auth.getCredentials();
    if (!c || c.type !== 'm3u') return Promise.reject(new Error('Sem credenciais M3U'));
    return Auth._fetchText(c.url).then(function (text) {
      cache.m3u = _parseM3U(text);
      return cache.m3u;
    });
  }

  /* ── Cache ───────────────────────────────────────────── */
  function clearCache() {
    cache = {};
  }

  return {
    getLiveCategories:   getLiveCategories,
    getVodCategories:    getVodCategories,
    getSeriesCategories: getSeriesCategories,
    getLiveStreams:      getLiveStreams,
    getVodStreams:       getVodStreams,
    getSeriesList:       getSeriesList,
    getVodInfo:          getVodInfo,
    getSeriesInfo:       getSeriesInfo,
    getLiveStreamUrl:    getLiveStreamUrl,
    getVodStreamUrl:     getVodStreamUrl,
    getEpisodeStreamUrl: getEpisodeStreamUrl,
    parseM3U:            _parseM3U,
    loadM3U:             loadM3U,
    clearCache:          clearCache
  };
})();
