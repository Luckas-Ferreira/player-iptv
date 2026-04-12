/**
 * api.js – Carregamento de dados IPTV (Xtream Codes e M3U)
 *
 * NOVIDADE: getLiveStreams / getVodStreams / getSeriesList
 *   aceitam onChunk(items[]) opcional para streaming progressivo.
 *   Com onChunk → usa Auth._fetchJSONStream (mostra cards enquanto carrega).
 *   Sem onChunk → usa Auth._fetchJSON (comportamento antigo, lê tudo).
 */

var API = (function () {
  'use strict';

  var _cache = {
    liveCategories: null,
    liveStreams: null,
    vodCategories: null,
    vodStreams: null,
    seriesCategories: null,
    seriesList: null,
    m3uData: null
  };

  /* ─── URL Builder ───────────────────────────────────────────────────── */
  function _xtreamUrl(action, extra) {
    var c = Auth.getCredentials();
    if (!c || c.type !== 'xtream') return null;
    var url = c.server + '/player_api.php?username=' + encodeURIComponent(c.username) +
      '&password=' + encodeURIComponent(c.password) + '&action=' + action;
    if (extra) url += '&' + extra;
    return url;
  }

  /* ─── Categorias (sem streaming — resposta pequena) ─────────────────── */
  function getLiveCategories() {
    if (_cache.liveCategories) return Promise.resolve(_cache.liveCategories);
    return Auth._fetchJSON(_xtreamUrl('get_live_categories')).then(function (d) {
      return (_cache.liveCategories = d || []);
    });
  }

  function getVodCategories() {
    if (_cache.vodCategories) return Promise.resolve(_cache.vodCategories);
    return Auth._fetchJSON(_xtreamUrl('get_vod_categories')).then(function (d) {
      return (_cache.vodCategories = d || []);
    });
  }

  function getSeriesCategories() {
    if (_cache.seriesCategories) return Promise.resolve(_cache.seriesCategories);
    return Auth._fetchJSON(_xtreamUrl('get_series_categories')).then(function (d) {
      return (_cache.seriesCategories = d || []);
    });
  }

  /* ─── Streams com suporte a streaming progressivo ───────────────────────
     Assinatura: getXxxStreams(categoryId, onChunk?)
       - onChunk ausente → retorna Promise<Array> (modo compatível)
       - onChunk presente → streaming; resolve com array completo ao final   */

  function getLiveStreams(categoryId, onChunk) {
    var key = 'live_' + (categoryId || 'all');
    if (_cache[key] && !onChunk) return Promise.resolve(_cache[key]);

    var url = _xtreamUrl('get_live_streams', categoryId ? 'category_id=' + categoryId : '');

    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s._type = 'live'; return s; }));
      }).then(function (all) {
        var streams = all.map(function (s) { s._type = 'live'; return s; });
        _cache[key] = streams;
        return streams;
      });
    }

    return Auth._fetchJSON(url).then(function (data) {
      var streams = (data || []).map(function (s) { s._type = 'live'; return s; });
      _cache[key] = streams;
      return streams;
    });
  }

  function getVodStreams(categoryId, onChunk) {
    var key = 'vod_' + (categoryId || 'all');
    if (_cache[key] && !onChunk) return Promise.resolve(_cache[key]);

    var url = _xtreamUrl('get_vod_streams', categoryId ? 'category_id=' + categoryId : '');

    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s._type = 'movie'; return s; }));
      }).then(function (all) {
        var streams = all.map(function (s) { s._type = 'movie'; return s; });
        _cache[key] = streams;
        return streams;
      });
    }

    return Auth._fetchJSON(url).then(function (data) {
      var streams = (data || []).map(function (s) { s._type = 'movie'; return s; });
      _cache[key] = streams;
      return streams;
    });
  }

  function getSeriesList(categoryId, onChunk) {
    var key = 'series_' + (categoryId || 'all');
    if (_cache[key] && !onChunk) return Promise.resolve(_cache[key]);

    var url = _xtreamUrl('get_series', categoryId ? 'category_id=' + categoryId : '');

    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s._type = 'series'; return s; }));
      }).then(function (all) {
        var streams = all.map(function (s) { s._type = 'series'; return s; });
        _cache[key] = streams;
        return streams;
      });
    }

    return Auth._fetchJSON(url).then(function (data) {
      var streams = (data || []).map(function (s) { s._type = 'series'; return s; });
      _cache[key] = streams;
      return streams;
    });
  }

  function getVodInfo(vodId) {
    return Auth._fetchJSON(_xtreamUrl('get_vod_info', 'vod_id=' + vodId));
  }

  function getSeriesInfo(seriesId) {
    return Auth._fetchJSON(_xtreamUrl('get_series_info', 'series_id=' + seriesId));
  }

  /* ─── URLs de stream ─────────────────────────────────────────────────── */
  function getLiveStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return c.server + '/live/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'm3u8');
  }

  function getVodStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return c.server + '/movie/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mp4');
  }

  function getEpisodeStreamUrl(streamId, ext) {
    var c = Auth.getCredentials(); if (!c) return '';
    return c.server + '/series/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mkv');
  }

  /* ─── M3U ────────────────────────────────────────────────────────────── */
  function parseM3U(text) {
    var lines = text.split('\n'), items = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) { cur = _parseExtInf(line); }
      else if (cur && line[0] !== '#') { cur.url = line; cur._type = _detectType(line, cur.group || ''); items.push(cur); cur = null; }
    }
    return items;
  }

  function _parseExtInf(line) {
    var item = {};
    var lc = line.lastIndexOf(',');
    item.name = lc !== -1 ? line.substring(lc + 1).trim() : 'Sem nome';
    var m;
    m = line.match(/tvg-logo="([^"]*)"/); item.stream_icon = m ? m[1] : '';
    m = line.match(/group-title="([^"]*)"/); item.category_name = m ? m[1] : 'Sem Categoria';
    item.group = item.category_name;
    return item;
  }

  function _detectType(url, group) {
    var g = group.toLowerCase(), u = url.toLowerCase();
    if (g.indexOf('movie') !== -1 || g.indexOf('filme') !== -1) return 'movie';
    if (g.indexOf('serie') !== -1 || g.indexOf('série') !== -1) return 'series';
    if (u.indexOf('/movie/') !== -1) return 'movie';
    if (u.indexOf('/series/') !== -1) return 'series';
    return 'live';
  }

  function loadM3U() {
    if (_cache.m3uData) return Promise.resolve(_cache.m3uData);
    var c = Auth.getCredentials();
    if (!c || c.type !== 'm3u') return Promise.reject(new Error('Sem credenciais M3U'));
    return Auth._fetchText(c.url).then(function (text) {
      var items = parseM3U(text);
      _cache.m3uData = items;
      return items;
    });
  }

  function clearCache() {
    for (var k in _cache) if (_cache.hasOwnProperty(k)) _cache[k] = null;
  }

  return {
    getLiveCategories: getLiveCategories,
    getLiveStreams: getLiveStreams,
    getVodCategories: getVodCategories,
    getVodStreams: getVodStreams,
    getVodInfo: getVodInfo,
    getSeriesCategories: getSeriesCategories,
    getSeriesList: getSeriesList,
    getSeriesInfo: getSeriesInfo,
    getLiveStreamUrl: getLiveStreamUrl,
    getVodStreamUrl: getVodStreamUrl,
    getEpisodeStreamUrl: getEpisodeStreamUrl,
    parseM3U: parseM3U,
    loadM3U: loadM3U,
    clearCache: clearCache
  };
})();
