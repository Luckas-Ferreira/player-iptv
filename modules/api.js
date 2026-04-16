/**
 * api.js – v5 — Bypass Cloudflare via serverInfo.url (godisfaithful.shop:80)
 *
 * DIAGNÓSTICO CONFIRMADO (console log):
 *   serverInfo = { url:"godisfaithful.shop", port:"80", server_protocol:"http", ... }
 *
 * O servidor se autoidentifica como "godisfaithful.shop" na porta 80 via HTTP.
 * A streams4k.xyz é apenas um alias que passa pelo Cloudflare (HTTPS, porta 443).
 *
 * SOLUÇÃO v5:
 * Quando useIp=true e serverInfo tem url+port+server_protocol,
 * usa DIRETAMENTE o endereço real do servidor: http://godisfaithful.shop:80
 * (ou qualquer IP que o usuário configurar no campo servidor do login).
 *
 * DICA RÁPIDA (sem alterar código):
 * Basta fazer logout e logar com o servidor: http://191.96.78.246
 * Aí c.server já é o IP e nada mais precisa de bypass.
 */
var API = (function () {
  'use strict';

  var cache = {
    liveCategories: null, liveStreams: null,
    vodCategories: null, vodStreams: null,
    seriesCategories: null, seriesList: null,
    m3uData: null
  };

  var _reIPv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

  /* ── URL Builder ─────────────────────────────────────── */

  /**
   * Retorna a base URL para requisições.
   *
   * Prioridade quando useIp=true:
   *  1. Se c.server já é um IP → usa direto (usuário logou com IP)
   *  2. serverInfo.server_ip / .ip → IP explícito
   *  3. serverInfo.url (mesmo sendo domínio) + serverInfo.port com HTTP
   *     → usa o endereço que o próprio servidor reporta, ex: http://godisfaithful.shop
   *  4. Fallback: c.server original
   */
  function _getEffectiveServer(typeOrAction, useIp) {
    var c = Auth.getCredentials();
    if (!c || !c.server) return '';
    if (!useIp) return c.server;

    /* 1. c.server já é um IP? Usa direto. */
    var serverHost = (c.server.match(/^https?:\/\/([^/:]+)/) || [])[1] || '';
    if (_reIPv4.test(serverHost)) return c.server;

    var si = c.serverInfo;
    if (!si) return c.server;

    /* 2. IP explícito no serverInfo */
    var ip = '';
    if (si.server_ip && _reIPv4.test(String(si.server_ip).trim())) ip = String(si.server_ip).trim();
    if (!ip && si.ip && _reIPv4.test(String(si.ip).trim())) ip = String(si.ip).trim();

    if (ip) {
      var port0 = String(si.port || '80').trim();
      return 'http://' + ip + (port0 === '80' ? '' : ':' + port0);
    }

    /* 3. Usa serverInfo.url + serverInfo.port com o protocolo real do servidor
          (mesmo que url seja domínio, ex: godisfaithful.shop:80 via HTTP)
          Isso bypassa streams4k.xyz → Cloudflare → HTTPS overhead.          */
    var siUrl = String(si.url || '').trim();
    var siProto = String(si.server_protocol || 'http').trim().toLowerCase();
    var siPort = String(si.port || '80').trim();

    if (siUrl) {
      /* Se siUrl já é IP, usa direto */
      if (_reIPv4.test(siUrl)) {
        return 'http://' + siUrl + (siPort === '80' ? '' : ':' + siPort);
      }
      /* É um domínio (ex: godisfaithful.shop) — usa com HTTP porta 80 */
      var base = siProto + '://' + siUrl + (siPort === '80' && siProto === 'http' ? '' : ':' + siPort);
      console.log('[API] Bypass via serverInfo.url:', base, '(antes:', c.server + ')');
      return base;
    }

    /* 4. Fallback */
    return c.server;
  }

  function _xtreamUrl(action, extra) {
    var c = Auth.getCredentials();
    if (!c || c.type !== 'xtream') return null;
    var base = _getEffectiveServer(action, true);
    var url = base + '/player_api.php?username=' + encodeURIComponent(c.username) +
      '&password=' + encodeURIComponent(c.password) +
      '&action=' + action;
    if (extra) url += extra;
    return url;
  }

  /* ── Categorias ─────────────────────────────────────── */
  function getLiveCategories() {
    if (cache.liveCategories) return Promise.resolve(cache.liveCategories);
    return Auth._fetchJSON(_xtreamUrl('get_live_categories')).then(function (d) {
      cache.liveCategories = d || []; return cache.liveCategories;
    });
  }
  function getVodCategories() {
    if (cache.vodCategories) return Promise.resolve(cache.vodCategories);
    return Auth._fetchJSON(_xtreamUrl('get_vod_categories')).then(function (d) {
      cache.vodCategories = d || []; return cache.vodCategories;
    });
  }
  function getSeriesCategories() {
    if (cache.seriesCategories) return Promise.resolve(cache.seriesCategories);
    return Auth._fetchJSON(_xtreamUrl('get_series_categories')).then(function (d) {
      cache.seriesCategories = d || []; return cache.seriesCategories;
    });
  }

  /* ── Streams ─────────────────────────────────────────── */
  function getLiveStreams(categoryId, onChunk) {
    var key = 'live_' + (categoryId || 'all');
    var url = _xtreamUrl('get_live_streams', categoryId ? ('&category_id=' + categoryId) : '');
    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s.type = 'live'; return s; }));
      }).then(function (all) {
        cache[key] = all.map(function (s) { s.type = 'live'; return s; });
        return cache[key];
      });
    }
    return Auth._fetchJSON(url).then(function (data) {
      cache[key] = (data || []).map(function (s) { s.type = 'live'; return s; });
      return cache[key];
    });
  }

  function getVodStreams(categoryId, onChunk) {
    var key = 'vod_' + (categoryId || 'all');
    var url = _xtreamUrl('get_vod_streams', categoryId ? ('&category_id=' + categoryId) : '');
    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s.type = 'movie'; return s; }));
      }).then(function (all) {
        cache[key] = all.map(function (s) { s.type = 'movie'; return s; });
        return cache[key];
      });
    }
    return Auth._fetchJSON(url).then(function (data) {
      cache[key] = (data || []).map(function (s) { s.type = 'movie'; return s; });
      return cache[key];
    });
  }

  function getSeriesList(categoryId, onChunk) {
    var key = 'series_' + (categoryId || 'all');
    var url = _xtreamUrl('get_series', categoryId ? ('&category_id=' + categoryId) : '');
    if (onChunk) {
      return Auth._fetchJSONStream(url, function (chunk) {
        onChunk(chunk.map(function (s) { s.type = 'series'; return s; }));
      }).then(function (all) {
        cache[key] = all.map(function (s) { s.type = 'series'; return s; });
        return cache[key];
      });
    }
    return Auth._fetchJSON(url).then(function (data) {
      cache[key] = (data || []).map(function (s) { s.type = 'series'; return s; });
      return cache[key];
    });
  }

  /* ── Info ────────────────────────────────────────────── */
  function getVodInfo(vodId) { return Auth._fetchJSON(_xtreamUrl('get_vod_info', '&vod_id=' + vodId)); }
  function getSeriesInfo(seriesId) { return Auth._fetchJSON(_xtreamUrl('get_series_info', '&series_id=' + seriesId)); }

  /* ── URLs de Stream ──────────────────────────────────── */
  function getLiveStreamUrl(streamId, ext, proxied, proxyIdx, useIp) {
    var c = Auth.getCredentials(); if (!c) return '';
    var base = _getEffectiveServer('live', useIp !== false);
    var url = base + '/live/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'm3u8');
    return proxied ? Auth.getProxiedUrl(url, true, proxyIdx) : url;
  }
  function getVodStreamUrl(streamId, ext, proxied, proxyIdx, useIp) {
    var c = Auth.getCredentials(); if (!c) return '';
    var base = _getEffectiveServer('movie', useIp !== false);
    var url = base + '/movie/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mp4');
    return proxied ? Auth.getProxiedUrl(url, true, proxyIdx) : url;
  }
  function getEpisodeStreamUrl(streamId, ext, proxied, proxyIdx, useIp) {
    var c = Auth.getCredentials(); if (!c) return '';
    var base = _getEffectiveServer('series', useIp !== false);
    var url = base + '/series/' + c.username + '/' + c.password + '/' + streamId + '.' + (ext || 'mkv');
    return proxied ? Auth.getProxiedUrl(url, true, proxyIdx) : url;
  }

  /* ── M3U ─────────────────────────────────────────────── */
  function _parseM3U(text) {
    var lines = text.split('\n'), items = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) { cur = _parseExtInf(line); }
      else if (cur && line[0] !== '#') {
        cur.url = line; cur.type = _detectType(line, cur.group);
        items.push(cur); cur = null;
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
    if (u.indexOf('movie') !== -1) return 'movie';
    if (u.indexOf('series') !== -1) return 'series';
    return 'live';
  }
  function loadM3U() {
    if (cache.m3uData) return Promise.resolve(cache.m3uData);
    var c = Auth.getCredentials();
    if (!c || c.type !== 'm3u') return Promise.reject(new Error('Sem credenciais M3U'));
    return Auth._fetchText(c.url).then(function (text) {
      cache.m3uData = _parseM3U(text); return cache.m3uData;
    });
  }

  /* ── Cache ───────────────────────────────────────────── */
  function clearCache(onlyStreams) {
    for (var k in cache) {
      if (!cache.hasOwnProperty(k)) continue;
      if (onlyStreams && k.indexOf('Categories') !== -1) continue;
      cache[k] = null;
      if (onlyStreams) delete cache[k];
    }
  }

  return {
    getLiveCategories: getLiveCategories, getLiveStreams: getLiveStreams,
    getVodCategories: getVodCategories, getVodStreams: getVodStreams,
    getVodInfo: getVodInfo,
    getSeriesCategories: getSeriesCategories, getSeriesList: getSeriesList,
    getSeriesInfo: getSeriesInfo,
    getLiveStreamUrl: getLiveStreamUrl, getVodStreamUrl: getVodStreamUrl,
    getEpisodeStreamUrl: getEpisodeStreamUrl,
    parseM3U: _parseM3U, loadM3U: loadM3U, clearCache: clearCache
  };
})();