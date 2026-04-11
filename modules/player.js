/**
 * player.js – Player de vídeo IPTV
 *
 * Estratégia para canais ao vivo:
 *   1. mpegts.js  → stream MPEG-TS direto (.ts) — uma única conexão HTTP contínua,
 *                   sem segmentos/tokens de segmento que expiram.
 *   2. HLS.js     → fallback se mpegts.js não funcionar (lida com .m3u8)
 *   3. Nativo     → Safari / WebKit SmartTV (suporte HLS nativo)
 *
 * Para filmes/séries:
 *   → reprodução direta via <video src>
 */

var Player = (function () {
  'use strict';

  /* ── CDNs ─────────────────────────────────────────────────── */
  var MPEGTS_CDN = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js';
  var HLS_CDN    = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';

  /* ── Estado ───────────────────────────────────────────────── */
  var _video       = null;
  var _overlay     = null;
  var _hideTimer   = null;
  var _bufTimer    = null;
  var _currentItem = null;
  var _isPlaying   = false;
  var _mpegts      = null;   // instância mpegts.js
  var _hls         = null;   // instância hls.js
  var _attempt     = 0;      // 0 = mpegts, 1 = hls, 2 = nativo

  /* ══════════════════════════════════════
     INICIALIZAÇÃO
  ══════════════════════════════════════ */
  function init() {
    _video   = document.getElementById('video-player');
    _overlay = document.getElementById('player-overlay');
    if (!_video) return;

    _video.addEventListener('playing',    _onPlaying);
    _video.addEventListener('waiting',    _onWaiting);
    _video.addEventListener('paused',     _onPaused);
    _video.addEventListener('ended',      _onEnd);
    _video.addEventListener('error',      _onNativeError);
    _video.addEventListener('timeupdate', _onTimeUpdate);

    _bindControls();

    document.addEventListener('keydown', function () {
      var s = document.getElementById('screen-player');
      if (s && !s.classList.contains('hidden')) _showOverlay();
    });
  }

  /* ══════════════════════════════════════
     PUBLIC: play / stop
  ══════════════════════════════════════ */
  function play(item) {
    _currentItem = item;
    _attempt     = 0;
    _isPlaying   = false;

    _destroyAll();
    _showLoading('Carregando stream...');
    _hideError();

    /* UI do player */
    var titleEl = document.getElementById('player-title');
    var logoEl  = document.getElementById('player-logo');
    if (titleEl) titleEl.textContent = item.name || '';
    if (logoEl) {
      var icon = item.stream_icon || item.cover || item.series_cover || '';
      if (icon) { logoEl.src = icon; logoEl.style.display = ''; }
      else logoEl.style.display = 'none';
    }

    Storage.addRecent(item);

    var type = item._type || 'live';

    if (type === 'live') {
      _startLive();
    } else {
      /* VOD / séries → reprodução direta */
      var url = _getStreamUrl(item);
      if (!url) { _showError('URL de stream não disponível'); return; }
      _playDirect(url);
    }
  }

  function stop() {
    _destroyAll();
    _currentItem = null;
  }

  /* ══════════════════════════════════════
     LIVE: sequência de tentativas
  ══════════════════════════════════════ */
  function _startLive() {
    if (!_currentItem) return;

    /* Sempre usa a URL .ts para mpegts.js — conexão contínua, sem tokens de segmento */
    var tsUrl  = _getLiveUrl('ts');
    var m3u8Url = _getLiveUrl('m3u8');

    _attempt = 0;
    _tryLive(tsUrl, m3u8Url);
  }

  function _tryLive(tsUrl, m3u8Url) {
    /* Tentativa 0: mpegts.js com stream .ts direto */
    if (_attempt === 0) {
      _showLoading('Conectando ao canal...');
      _loadScript(MPEGTS_CDN, function () {
        if (window.mpegts && mpegts.isSupported()) {
          _initMpegts(tsUrl, m3u8Url);
        } else {
          _attempt = 1;
          _tryLive(tsUrl, m3u8Url);
        }
      }, function () {
        /* CDN mpegts falhou */
        _attempt = 1;
        _tryLive(tsUrl, m3u8Url);
      });
      return;
    }

    /* Tentativa 1: HLS.js com .m3u8 */
    if (_attempt === 1) {
      _showLoading('Tentando HLS...');
      _loadScript(HLS_CDN, function () {
        if (window.Hls && Hls.isSupported()) {
          _initHLS(m3u8Url, tsUrl);
        } else {
          /* Browser com suporte nativo HLS (Safari / WebKit SmartTV) */
          _attempt = 2;
          _tryLive(tsUrl, m3u8Url);
        }
      }, function () {
        _attempt = 2;
        _tryLive(tsUrl, m3u8Url);
      });
      return;
    }

    /* Tentativa 2: playback nativo (Safari HLS) */
    if (_attempt === 2) {
      _showLoading('Tentando reprodução nativa...');
      _playDirect(m3u8Url);
      _startBufWatchdog(null); /* sem mais fallback */
      return;
    }

    /* Sem mais tentativas */
    _showError('Stream indisponível. Verifique sua conexão.');
  }

  /* ══════════════════════════════════════
     mpegts.js
  ══════════════════════════════════════ */
  function _initMpegts(tsUrl, fallbackM3u8) {
    _destroyMpegts();

    var player = mpegts.createPlayer({
      type:   'mpegts',
      isLive: true,
      url:    tsUrl,
      cors:   true
    }, {
      enableWorker:              false,  /* compatibilidade TVs antigas */
      liveBufferLatencyChasing:  true,
      liveSync:                  true,
      lazyLoadMaxDuration:       3 * 60,
      seekType:                  'range'
    });

    _mpegts = player;
    player.attachMediaElement(_video);

    player.on(mpegts.Events.ERROR, function (errType, errDetail, errInfo) {
      console.warn('[Player] mpegts erro:', errType, errDetail, errInfo);
      _destroyMpegts();
      if (!_isPlaying) {
        _attempt = 1;
        _tryLive(tsUrl, fallbackM3u8);
      }
    });

    try {
      player.load();
      var p = player.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      console.warn('[Player] mpegts play() exception:', e);
    }

    /* Watchdog: 20s sem _isPlaying → próxima tentativa */
    _startBufWatchdog(function () {
      _destroyMpegts();
      _attempt = 1;
      _tryLive(tsUrl, fallbackM3u8);
    });
  }

  /* ══════════════════════════════════════
     HLS.js
  ══════════════════════════════════════ */
  function _initHLS(m3u8Url, tsUrl) {
    _destroyHLS();

    var hls = new Hls({
      maxBufferLength:        8,
      maxMaxBufferLength:     30,
      enableWorker:           false,
      startFragPrefetch:      true,
      manifestLoadingTimeOut: 15000,
      levelLoadingTimeOut:    15000,
      fragLoadingTimeOut:     20000
    });

    _hls = hls;
    hls.loadSource(m3u8Url);
    hls.attachMedia(_video);

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      var p = _video.play();
      if (p && p.catch) p.catch(function () {});
      _startBufWatchdog(function () {
        _destroyHLS();
        _attempt = 2;
        _tryLive(tsUrl, m3u8Url);
      });
    });

    hls.on(Hls.Events.ERROR, function (evt, data) {
      if (data.fatal) {
        console.warn('[Player] HLS fatal:', data.type, data.details);
        _destroyHLS();
        if (!_isPlaying) {
          _attempt = 2;
          _tryLive(tsUrl, m3u8Url);
        }
      }
    });
  }

  /* ══════════════════════════════════════
     Reprodução direta (VOD / native HLS)
  ══════════════════════════════════════ */
  function _playDirect(url) {
    _video.src = url;
    _video.load();
    var p = _video.play();
    if (p && p.catch) p.catch(function () {});
  }

  /* ══════════════════════════════════════
     Destroy helpers
  ══════════════════════════════════════ */
  function _destroyMpegts() {
    _clearBufWatchdog();
    if (_mpegts) {
      try { _mpegts.pause(); _mpegts.unload(); _mpegts.detachMediaElement(); _mpegts.destroy(); } catch (e) {}
      _mpegts = null;
    }
  }

  function _destroyHLS() {
    _clearBufWatchdog();
    if (_hls) {
      try { _hls.destroy(); } catch (e) {}
      _hls = null;
    }
    if (_video) {
      _video.removeAttribute('src');
      try { _video.load(); } catch (e) {}
    }
  }

  function _destroyAll() {
    _clearBufWatchdog();
    _destroyMpegts();
    if (_hls) { try { _hls.destroy(); } catch (e) {} _hls = null; }
    if (_video) {
      _video.pause();
      _video.removeAttribute('src');
      try { _video.load(); } catch (e) {}
    }
  }

  /* ══════════════════════════════════════
     Watchdog de buffering
  ══════════════════════════════════════ */
  function _startBufWatchdog(onTimeout) {
    _clearBufWatchdog();
    if (!onTimeout) return;
    _bufTimer = setTimeout(function () {
      if (!_isPlaying) {
        console.warn('[Player] Watchdog: buffering timeout, próxima tentativa');
        onTimeout();
      }
    }, 20000);
  }

  function _clearBufWatchdog() {
    if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null; }
  }

  /* ══════════════════════════════════════
     Helpers de URL
  ══════════════════════════════════════ */
  function _getLiveUrl(ext) {
    var creds = Auth.getCredentials();
    if (!creds || !_currentItem) return '';
    return creds.server + '/live/' + creds.username + '/' + creds.password + '/' + _currentItem.stream_id + '.' + ext;
  }

  function _getStreamUrl(item) {
    if (item.url) return item.url;  /* M3U */
    var creds = Auth.getCredentials();
    if (!creds || creds.type !== 'xtream') return '';
    var type = item._type || 'live';
    if (type === 'movie') {
      return creds.server + '/movie/' + creds.username + '/' + creds.password + '/' + (item.stream_id || item.vod_id) + '.' + (item.container_extension || 'mp4');
    }
    if (type === 'series' && item._episodeId) {
      return creds.server + '/series/' + creds.username + '/' + creds.password + '/' + item._episodeId + '.' + (item._episodeExt || 'mkv');
    }
    return '';
  }

  /* ══════════════════════════════════════
     Carregamento de scripts CDN
  ══════════════════════════════════════ */
  function _loadScript(src, onload, onerror) {
    /* Evita carregar o mesmo script duas vezes */
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      /* Script já no DOM — se biblioteca já disponível, chama onload */
      var libReady = (src.indexOf('mpegts') !== -1 && window.mpegts) ||
                     (src.indexOf('hls')    !== -1 && window.Hls);
      if (libReady) { onload(); return; }
      /* Ainda carregando — aguarda */
      existing.addEventListener('load', onload);
      existing.addEventListener('error', onerror);
      return;
    }
    var s = document.createElement('script');
    s.src = src;
    s.onload  = onload;
    s.onerror = onerror;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════
     Controles do player
  ══════════════════════════════════════ */
  function _bindControls() {
    var btnBack    = document.getElementById('player-back');
    var btnPlay    = document.getElementById('player-play-pause');
    var btnFwd     = document.getElementById('player-forward');
    var btnRew     = document.getElementById('player-rewind');
    var btnFS      = document.getElementById('player-fullscreen');
    var btnRetry   = document.getElementById('player-retry');
    var btnBackErr = document.getElementById('player-back-from-error');
    var progressBar = document.getElementById('player-progress-bar');

    if (btnBack)    btnBack.addEventListener('click',    function () { App.goBack(); });
    if (btnBackErr) btnBackErr.addEventListener('click', function () { App.goBack(); });
    if (btnPlay)    btnPlay.addEventListener('click',    togglePlayPause);
    if (btnRetry)   btnRetry.addEventListener('click',  function () { if (_currentItem) play(_currentItem); });

    if (btnFwd) btnFwd.addEventListener('click', function () {
      if (_video) _video.currentTime = Math.min(_video.currentTime + 10, _video.duration || Infinity);
      _showOverlay();
    });
    if (btnRew) btnRew.addEventListener('click', function () {
      if (_video) _video.currentTime = Math.max(_video.currentTime - 10, 0);
      _showOverlay();
    });
    if (btnFS) btnFS.addEventListener('click', _toggleFullscreen);

    if (progressBar) {
      progressBar.addEventListener('click', function (e) {
        if (!_video || !_video.duration) return;
        var rect = progressBar.getBoundingClientRect();
        _video.currentTime = ((e.clientX - rect.left) / rect.width) * _video.duration;
        _showOverlay();
      });
    }
  }

  function togglePlayPause() {
    if (!_video) return;
    if (_video.paused) {
      var p = _video.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      _video.pause();
    }
    _showOverlay();
  }

  /* ══════════════════════════════════════
     Eventos do vídeo
  ══════════════════════════════════════ */
  function _onPlaying() {
    _isPlaying = true;
    _clearBufWatchdog();
    _hideLoading();
    _hideError();
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.textContent = '⏸';
    _showOverlay();
  }

  function _onWaiting() {
    _showLoading('Buffering...');
  }

  function _onPaused() {
    _isPlaying = false;
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.textContent = '▶';
    _showOverlay();
  }

  function _onEnd() {
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.textContent = '↩';
    _showOverlay();
  }

  function _onNativeError() {
    _hideLoading();
    if (!_currentItem) return;
    var code = _video && _video.error ? _video.error.code : 0;
    var msgs = { 1: 'Carregamento interrompido', 2: 'Erro de rede', 3: 'Decode error', 4: 'Formato não suportado' };
    console.warn('[Player] Native video error code:', code);

    /* Se estava tentando nativa (tentativa 2) → sem mais fallback */
    if (_attempt >= 2 || _isPlaying) {
      _showError(msgs[code] || 'Erro ao reproduzir. Tente outro canal.');
      return;
    }
    /* Repassar para próxima tentativa */
    _attempt++;
    var tsUrl   = _getLiveUrl('ts');
    var m3u8Url = _getLiveUrl('m3u8');
    _tryLive(tsUrl, m3u8Url);
  }

  function _onTimeUpdate() {
    var fill  = document.getElementById('player-progress-fill');
    var curEl = document.getElementById('player-time-current');
    var totEl = document.getElementById('player-time-total');
    if (!_video) return;
    var cur = _video.currentTime;
    var dur = _video.duration;
    if (fill) fill.style.width = (dur ? (cur / dur * 100) : 0) + '%';
    if (curEl) curEl.textContent = _formatTime(cur);
    if (totEl) totEl.textContent = (dur && isFinite(dur)) ? _formatTime(dur) : '--:--';
  }

  /* ══════════════════════════════════════
     Overlay
  ══════════════════════════════════════ */
  function _showOverlay() {
    if (!_overlay) return;
    _overlay.classList.remove('hidden-controls');
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(function () {
      if (_isPlaying) _overlay.classList.add('hidden-controls');
    }, 4000);
  }

  /* ══════════════════════════════════════
     Loading / Error UI
  ══════════════════════════════════════ */
  function _showLoading(msg) {
    var el  = document.getElementById('player-loading');
    var txt = document.getElementById('player-loading-text');
    if (el)  el.classList.remove('hidden');
    if (txt) txt.textContent = msg || 'Carregando...';
  }

  function _hideLoading() {
    var el = document.getElementById('player-loading');
    if (el) el.classList.add('hidden');
  }

  function _showError(msg) {
    _hideLoading();
    var el  = document.getElementById('player-error');
    var txt = document.getElementById('player-error-text');
    if (el)  el.classList.remove('hidden');
    if (txt) txt.textContent = msg || 'Erro desconhecido';
  }

  function _hideError() {
    var el = document.getElementById('player-error');
    if (el) el.classList.add('hidden');
  }

  /* ══════════════════════════════════════
     Fullscreen
  ══════════════════════════════════════ */
  function _toggleFullscreen() {
    var el = document.getElementById('screen-player');
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) req.call(el);
      }
    } catch (e) { console.warn('[Player] Fullscreen não suportado', e); }
  }

  /* ══════════════════════════════════════
     Helpers
  ══════════════════════════════════════ */
  function _formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = Math.floor(secs % 60);
    if (h > 0) return h + ':' + _pad(m) + ':' + _pad(s);
    return m + ':' + _pad(s);
  }

  function _pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ══════════════════════════════════════
     API pública
  ══════════════════════════════════════ */
  return {
    init:            init,
    play:            play,
    stop:            stop,
    togglePlayPause: togglePlayPause
  };
})();
