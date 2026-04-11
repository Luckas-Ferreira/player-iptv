/**
 * api.js – Carregamento de dados IPTV (Xtream Codes e M3U)
 * Cache em memória para otimizar performance
 */

var API = (function () {
  'use strict';

  // Cache em memória
  var _cache = {
    liveCategories:  null,
    liveStreams:     null,
    vodCategories:   null,
    vodStreams:      null,
    seriesCategories: null,
    seriesList:      null,
    m3uData:         null
  };

  // ==================== XTREAM CODES ====================

  function _xtreamUrl(action, extraParams) {
    var creds = Auth.getCredentials();
    if (!creds || creds.type !== 'xtream') return null;
    var url = creds.server + '/player_api.php?username=' + encodeURIComponent(creds.username) +
              '&password=' + encodeURIComponent(creds.password) +
              '&action=' + action;
    if (extraParams) url += '&' + extraParams;
    return url;
  }

  function getLiveCategories() {
    if (_cache.liveCategories) return Promise.resolve(_cache.liveCategories);
    var url = _xtreamUrl('get_live_categories');
    return Auth._fetchJSON(url).then(function (data) {
      _cache.liveCategories = data || [];
      return _cache.liveCategories;
    });
  }

  function getLiveStreams(categoryId) {
    var cacheKey = 'live_' + (categoryId || 'all');
    if (_cache[cacheKey]) return Promise.resolve(_cache[cacheKey]);
    var params = categoryId ? 'category_id=' + categoryId : '';
    var url = _xtreamUrl('get_live_streams', params);
    return Auth._fetchJSON(url).then(function (data) {
      var streams = (data || []).map(function (s) { s._type = 'live'; return s; });
      _cache[cacheKey] = streams;
      return streams;
    });
  }

  function getVodCategories() {
    if (_cache.vodCategories) return Promise.resolve(_cache.vodCategories);
    var url = _xtreamUrl('get_vod_categories');
    return Auth._fetchJSON(url).then(function (data) {
      _cache.vodCategories = data || [];
      return _cache.vodCategories;
    });
  }

  function getVodStreams(categoryId) {
    var cacheKey = 'vod_' + (categoryId || 'all');
    if (_cache[cacheKey]) return Promise.resolve(_cache[cacheKey]);
    var params = categoryId ? 'category_id=' + categoryId : '';
    var url = _xtreamUrl('get_vod_streams', params);
    return Auth._fetchJSON(url).then(function (data) {
      var streams = (data || []).map(function (s) { s._type = 'movie'; return s; });
      _cache[cacheKey] = streams;
      return streams;
    });
  }

  function getVodInfo(vodId) {
    var url = _xtreamUrl('get_vod_info', 'vod_id=' + vodId);
    return Auth._fetchJSON(url);
  }

  function getSeriesCategories() {
    if (_cache.seriesCategories) return Promise.resolve(_cache.seriesCategories);
    var url = _xtreamUrl('get_series_categories');
    return Auth._fetchJSON(url).then(function (data) {
      _cache.seriesCategories = data || [];
      return _cache.seriesCategories;
    });
  }

  function getSeriesList(categoryId) {
    var cacheKey = 'series_' + (categoryId || 'all');
    if (_cache[cacheKey]) return Promise.resolve(_cache[cacheKey]);
    var params = categoryId ? 'category_id=' + categoryId : '';
    var url = _xtreamUrl('get_series', params);
    return Auth._fetchJSON(url).then(function (data) {
      var series = (data || []).map(function (s) { s._type = 'series'; return s; });
      _cache[cacheKey] = series;
      return series;
    });
  }

  function getSeriesInfo(seriesId) {
    var url = _xtreamUrl('get_series_info', 'series_id=' + seriesId);
    return Auth._fetchJSON(url);
  }

  /**
   * Constrói URL de stream ao vivo
   */
  function getLiveStreamUrl(streamId, ext) {
    var creds = Auth.getCredentials();
    if (!creds) return '';
    ext = ext || 'ts';
    return creds.server + '/live/' + creds.username + '/' + creds.password + '/' + streamId + '.' + ext;
  }

  /**
   * Constrói URL de stream VOD
   */
  function getVodStreamUrl(streamId, ext) {
    var creds = Auth.getCredentials();
    if (!creds) return '';
    ext = ext || 'mp4';
    return creds.server + '/movie/' + creds.username + '/' + creds.password + '/' + streamId + '.' + ext;
  }

  /**
   * Constrói URL de episódio de série
   */
  function getEpisodeStreamUrl(streamId, ext) {
    var creds = Auth.getCredentials();
    if (!creds) return '';
    ext = ext || 'mkv';
    return creds.server + '/series/' + creds.username + '/' + creds.password + '/' + streamId + '.' + ext;
  }

  // ==================== M3U PARSER ====================

  function parseM3U(text) {
    var lines = text.split('\n');
    var items = [];
    var current = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF')) {
        current = _parseExtInf(line);
      } else if (current && !line.startsWith('#')) {
        current.url = line;
        current._type = _detectType(line, current.group || '');
        items.push(current);
        current = null;
      }
    }
    return items;
  }

  function _parseExtInf(line) {
    var item = {};
    // Nome (após última vírgula)
    var lastComma = line.lastIndexOf(',');
    item.name = lastComma !== -1 ? line.substring(lastComma + 1).trim() : 'Sem nome';

    // tvg-id
    var idMatch = line.match(/tvg-id="([^"]*)"/);
    item.tvg_id = idMatch ? idMatch[1] : '';

    // tvg-logo
    var logoMatch = line.match(/tvg-logo="([^"]*)"/);
    item.stream_icon = logoMatch ? logoMatch[1] : '';

    // group-title
    var groupMatch = line.match(/group-title="([^"]*)"/);
    item.category_name = groupMatch ? groupMatch[1] : 'Sem Categoria';
    item.group = item.category_name;

    return item;
  }

  function _detectType(url, group) {
    var g = (group || '').toLowerCase();
    var u = (url || '').toLowerCase();
    if (g.indexOf('movie') !== -1 || g.indexOf('filme') !== -1 || g.indexOf('film') !== -1) return 'movie';
    if (g.indexOf('serie') !== -1 || g.indexOf('séries') !== -1) return 'series';
    if (u.indexOf('/movie/') !== -1) return 'movie';
    if (u.indexOf('/series/') !== -1) return 'series';
    return 'live';
  }

  function loadM3U() {
    if (_cache.m3uData) return Promise.resolve(_cache.m3uData);
    var creds = Auth.getCredentials();
    if (!creds || creds.type !== 'm3u') return Promise.reject(new Error('Sem credenciais M3U'));

    return Auth._fetchText(creds.url).then(function (text) {
      var items = parseM3U(text);
      _cache.m3uData = items;
      return items;
    });
  }

  // ==================== DADOS DE DEMONSTRAÇÃO ====================

  function getDemoData() {
    return {
      liveCategories: [
        { category_id: '1', category_name: 'Esportes' },
        { category_id: '2', category_name: 'Notícias' },
        { category_id: '3', category_name: 'Entretenimento' },
        { category_id: '4', category_name: 'Documentários' }
      ],
      liveStreams: [
        { stream_id: 101, name: 'Sports HD', stream_icon: '', category_id: '1', category_name: 'Esportes', _type: 'live' },
        { stream_id: 102, name: 'News 24h', stream_icon: '', category_id: '2', category_name: 'Notícias', _type: 'live' },
        { stream_id: 103, name: 'Cinema Plus', stream_icon: '', category_id: '3', category_name: 'Entretenimento', _type: 'live' },
        { stream_id: 104, name: 'Discovery HD', stream_icon: '', category_id: '4', category_name: 'Documentários', _type: 'live' },
        { stream_id: 105, name: 'Music TV', stream_icon: '', category_id: '3', category_name: 'Entretenimento', _type: 'live' },
        { stream_id: 106, name: 'Kids Zone', stream_icon: '', category_id: '3', category_name: 'Entretenimento', _type: 'live' },
        { stream_id: 107, name: 'Fox Sports', stream_icon: '', category_id: '1', category_name: 'Esportes', _type: 'live' },
        { stream_id: 108, name: 'CNN Brasil', stream_icon: '', category_id: '2', category_name: 'Notícias', _type: 'live' },
        { stream_id: 109, name: 'GNT', stream_icon: '', category_id: '3', category_name: 'Entretenimento', _type: 'live' },
        { stream_id: 110, name: 'History Channel', stream_icon: '', category_id: '4', category_name: 'Documentários', _type: 'live' },
        { stream_id: 111, name: 'ESPN', stream_icon: '', category_id: '1', category_name: 'Esportes', _type: 'live' },
        { stream_id: 112, name: 'BBC World', stream_icon: '', category_id: '2', category_name: 'Notícias', _type: 'live' }
      ],
      vodCategories: [
        { category_id: '10', category_name: 'Ação' },
        { category_id: '11', category_name: 'Comédia' },
        { category_id: '12', category_name: 'Drama' },
        { category_id: '13', category_name: 'Ficção Científica' }
      ],
      vodStreams: [
        { vod_id: 201, name: 'Duna (2021)', cover: '', category_id: '13', category_name: 'Ficção Científica', year: '2021', rating: '8.0', _type: 'movie' },
        { vod_id: 202, name: 'Top Gun: Maverick', cover: '', category_id: '10', category_name: 'Ação', year: '2022', rating: '8.2', _type: 'movie' },
        { vod_id: 203, name: 'Parasite', cover: '', category_id: '12', category_name: 'Drama', year: '2019', rating: '8.5', _type: 'movie' },
        { vod_id: 204, name: 'Everything Everywhere', cover: '', category_id: '10', category_name: 'Ação', year: '2022', rating: '7.8', _type: 'movie' },
        { vod_id: 205, name: 'The Batman', cover: '', category_id: '10', category_name: 'Ação', year: '2022', rating: '7.8', _type: 'movie' },
        { vod_id: 206, name: 'Spider-Man: No Way Home', cover: '', category_id: '10', category_name: 'Ação', year: '2021', rating: '8.2', _type: 'movie' },
        { vod_id: 207, name: 'The Grand Budapest Hotel', cover: '', category_id: '11', category_name: 'Comédia', year: '2014', rating: '8.1', _type: 'movie' },
        { vod_id: 208, name: 'Interstellar', cover: '', category_id: '13', category_name: 'Ficção Científica', year: '2014', rating: '8.6', _type: 'movie' },
        { vod_id: 209, name: 'Oppenheimer', cover: '', category_id: '12', category_name: 'Drama', year: '2023', rating: '8.5', _type: 'movie' },
        { vod_id: 210, name: 'Barbie (2023)', cover: '', category_id: '11', category_name: 'Comédia', year: '2023', rating: '7.0', _type: 'movie' }
      ],
      seriesCategories: [
        { category_id: '20', category_name: 'Drama' },
        { category_id: '21', category_name: 'Comédia' },
        { category_id: '22', category_name: 'Sci-Fi' }
      ],
      seriesList: [
        { series_id: 301, name: 'Breaking Bad', series_cover: '', category_id: '20', category_name: 'Drama', rating: '9.5', _type: 'series', episode_run_time: 47, last_modified: '' },
        { series_id: 302, name: 'The Boys', series_cover: '', category_id: '20', category_name: 'Drama', rating: '8.7', _type: 'series', episode_run_time: 60, last_modified: '' },
        { series_id: 303, name: 'Stranger Things', series_cover: '', category_id: '22', category_name: 'Sci-Fi', rating: '8.7', _type: 'series', episode_run_time: 50, last_modified: '' },
        { series_id: 304, name: 'The Office (US)', series_cover: '', category_id: '21', category_name: 'Comédia', rating: '9.0', _type: 'series', episode_run_time: 22, last_modified: '' },
        { series_id: 305, name: 'Game of Thrones', series_cover: '', category_id: '20', category_name: 'Drama', rating: '9.2', _type: 'series', episode_run_time: 56, last_modified: '' },
        { series_id: 306, name: 'Black Mirror', series_cover: '', category_id: '22', category_name: 'Sci-Fi', rating: '8.8', _type: 'series', episode_run_time: 60, last_modified: '' },
        { series_id: 307, name: 'Seinfeld', series_cover: '', category_id: '21', category_name: 'Comédia', rating: '8.9', _type: 'series', episode_run_time: 23, last_modified: '' },
        { series_id: 308, name: 'The Witcher', series_cover: '', category_id: '20', category_name: 'Drama', rating: '8.0', _type: 'series', episode_run_time: 60, last_modified: '' }
      ]
    };
  }

  function clearCache() {
    _cache = {
      liveCategories:  null,
      liveStreams:     null,
      vodCategories:   null,
      vodStreams:      null,
      seriesCategories: null,
      seriesList:      null,
      m3uData:         null
    };
  }

  return {
    getLiveCategories:    getLiveCategories,
    getLiveStreams:        getLiveStreams,
    getVodCategories:     getVodCategories,
    getVodStreams:         getVodStreams,
    getVodInfo:           getVodInfo,
    getSeriesCategories:  getSeriesCategories,
    getSeriesList:        getSeriesList,
    getSeriesInfo:        getSeriesInfo,
    getLiveStreamUrl:     getLiveStreamUrl,
    getVodStreamUrl:      getVodStreamUrl,
    getEpisodeStreamUrl:  getEpisodeStreamUrl,
    parseM3U:             parseM3U,
    loadM3U:              loadM3U,
    getDemoData:          getDemoData,
    clearCache:           clearCache
  };
})();
