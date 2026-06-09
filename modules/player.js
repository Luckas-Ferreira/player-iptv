/**
 * player.js — Player IPTV simplificado
 *
 * ESTRATÉGIA (TV antiga):
 *   LIVE:
 *     • .m3u8 com suporte nativo (Safari/Tizen)  → <video src="...">
 *     • .m3u8 sem suporte nativo                 → HLS.js (CDN sob demanda)
 *     • Fallback: .ts direto via <video>
 *
 *   VOD (filmes/séries):
 *     • <video src="..."> direto, tentando as extensões em ordem
 *     • Ordem: extensão original → mp4 → mkv
 *     • Sem proxy CORS (vídeo não passa por proxy de texto)
 *     • Sem HLS para VOD — Xtream entrega VOD em mp4/mkv direto
 *
 * Sem mpegts.js, sem proxies CORS, sem cascata complexa.
 */
var Player = (function () {
  'use strict';

  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';

  /* ── Estado ───────────────────────────────────────────── */
  var _video       = null;
  var _overlay     = null;
  var _hideTimer   = null;
  var _bufTimer    = null;
  var _hls         = null;
  var _currentItem = null;
  var _isPlaying   = false;

  /* URLs a tentar para o item atual e índice atual */
  var _urls    = [];
  var _urlIdx  = 0;

  /* Próximo episódio (autoplay) */
  var _nextItem      = null;
  var _nextCallback  = null;
  var _nextShown     = false;
  var _skipTimer     = null;
  var _skipInterval  = null;
  var _skipStartTime = 0;

  /* Progresso */
  var _progressTimer    = null;
  var _resumePendingTime = 0;

  /* Seek */
  var _isSeeking = false;
  var _seekValue = 0;
  var _seekTimer = null;

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  function init() {
    _video   = document.getElementById('video-player');
    _overlay = document.getElementById('player-overlay');
    if (!_video) return;

    _video.addEventListener('playing', _onPlaying);
    _video.addEventListener('waiting', _onWaiting);
    _video.addEventListener('pause',   _onPaused);
    _video.addEventListener('ended',   _onEnd);
    _video.addEventListener('error',   _onNativeError);
    _video.addEventListener('timeupdate', _onTimeUpdate);
    _video.addEventListener('loadedmetadata', _onMetadataLoaded);

    _bindControls();

    /* Mostra overlay em qualquer interação */
    var showOverlay = function () { _showOverlay(); };
    var s = document.getElementById('screen-player');
    if (s) {
      s.addEventListener('mousemove', showOverlay);
      s.addEventListener('touchstart', showOverlay, { passive: true });
    }
    document.addEventListener('keydown', function () {
      var sc = document.getElementById('screen-player');
      if (sc && !sc.classList.contains('hidden')) _showOverlay();
    });
  }

  /* ══════════════════════════════════════
     PUBLIC: play / stop / seek
  ══════════════════════════════════════ */
  function play(item) {
    _currentItem = item;
    _isPlaying   = false;
    _nextShown   = false;
    _hideNextCard();
    _clearSkipCountdown();
    _clearProgressTimer();
    _isSeeking   = false;
    if (_seekTimer) clearTimeout(_seekTimer);

    /* Autoplay: sempre do zero */
    if (item._fromAutoplay) {
      _resumePendingTime = 0;
      _startPlayback(item);
      return;
    }

    /* Watchlist passa _resumeTime direto */
    if (item._resumeTime && item._resumeTime > 10 && item._type !== 'live') {
      _resumePendingTime = item._resumeTime;
      _startPlayback(item);
      return;
    }

    /* Checa progresso salvo */
    var id = String(item._episodeId || item.vod_id || item.stream_id || item.id || '');
    var prog = (id && item._type !== 'live') ? Storage.getProgress(id) : null;

    if (prog && prog.time > 10) {
      _resumePendingTime = 0;
      _showResumePrompt(prog, item);
      return;
    }

    _resumePendingTime = 0;
    _startPlayback(item);
  }

  function _showResumePrompt(progress, item) {
    var modal       = document.getElementById('modal-resume');
    var timeDisplay = document.getElementById('resume-time-display');
    var btnCont     = document.getElementById('btn-resume-continue');
    var btnOver     = document.getElementById('btn-resume-start-over');

    if (!modal || !timeDisplay || !btnCont || !btnOver) {
      _startPlayback(item);
      return;
    }

    timeDisplay.textContent = _formatTime(progress.time);
    modal.classList.remove('hidden');

    btnCont.onclick = function () {
      modal.classList.add('hidden');
      _resumePendingTime = progress.time;
      _startPlayback(item);
    };
    btnOver.onclick = function () {
      modal.classList.add('hidden');
      _resumePendingTime = 0;
      _startPlayback(item);
    };

    setTimeout(function () { btnCont.focus(); }, 100);
  }

  function _startPlayback(item) {
    _destroyAll();
    _showLoading('Carregando...');
    _hideError();

    /* Marca modo VOD para CSS */
    var screen = document.getElementById('screen-player');
    if (screen) {
      if (item._type === 'movie' || item._type === 'series') screen.classList.add('vod-mode');
      else screen.classList.remove('vod-mode');
    }

    /* UI */
    var titleEl = document.getElementById('player-title');
    var logoEl  = document.getElementById('player-logo');
    if (titleEl) titleEl.textContent = item.name || '';
    if (logoEl) {
      var icon = item.stream_icon || item.cover || item.series_cover || '';
      if (icon) { logoEl.src = icon; logoEl.style.display = ''; }
      else logoEl.style.display = 'none';
    }

    setTimeout(function () {
      var btn = document.getElementById('player-play-pause');
      if (btn) btn.focus();
    }, 200);

    Storage.addRecent(item);

    /* Monta lista de URLs e começa */
    _urls   = _buildUrls(item);
    _urlIdx = 0;

    if (!_urls.length) {
      _showError('URL não disponível. Verifique as credenciais.');
      return;
    }

    _playUrl(_urls[0]);
  }

  function stop() {
    if (_currentItem && _currentItem._type !== 'live' && _video) {
      var id = String(_currentItem._episodeId || _currentItem.vod_id ||
                      _currentItem.stream_id || _currentItem.id || '');
      if (id && _video.duration > 0 && isFinite(_video.duration) && _video.currentTime > 5) {
        Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
      }
    }
    _clearProgressTimer();
    _destroyAll();
    _currentItem = null;
  }

  function seek(seconds) {
    if (!_video || !isFinite(_video.duration)) return;

    if (!_isSeeking) {
      _isSeeking = true;
      _seekValue = _video.currentTime;
    }
    _seekValue = Math.max(0, Math.min(_video.duration, _seekValue + seconds));
    _showOverlay();
    _updateSeekUI(_seekValue);

    if (_seekTimer) clearTimeout(_seekTimer);
    _seekTimer = setTimeout(function () {
      if (_video) _video.currentTime = _seekValue;
      _isSeeking = false;
    }, 1200);
  }

  function _updateSeekUI(t) {
    var fill = document.getElementById('player-progress-fill');
    var cur  = document.getElementById('player-time-current');
    var dur  = _video ? _video.duration : 0;
    if (fill) fill.style.width = (dur ? (t / dur * 100) : 0) + '%';
    if (cur)  cur.textContent  = _formatTime(t);
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
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.focus();
  }

  /* ══════════════════════════════════════
     URLs: monta lista de tentativas
  ══════════════════════════════════════ */
  function _buildUrls(item) {
    var c = Auth.getCredentials();
    if (!c) return [];

    /* M3U: a URL veio direta na lista */
    if (c.type === 'm3u' && item.url) {
      return [item.url];
    }

    if (c.type !== 'xtream') return [];

    var type = item._type || 'live';
    var id, origExt, urlFn;

    if (type === 'live') {
      id      = item.stream_id;
      origExt = 'm3u8';
      urlFn   = API.getLiveStreamUrl;
    } else if (type === 'movie') {
      id      = item.vod_id || item.stream_id || item.id;
      origExt = item.container_extension || 'mp4';
      urlFn   = API.getVodStreamUrl;
    } else if (type === 'series') {
      id      = item._episodeId;
      origExt = item._episodeExt || 'mkv';
      urlFn   = API.getEpisodeStreamUrl;
    }

    if (!id) return [];

    /* Para LIVE: m3u8 primeiro (compatível com HLS.js e Safari nativo), depois ts */
    /* Para VOD: extensão original primeiro (servidor já tem o arquivo), depois mp4 e mkv */
    var exts;
    if (type === 'live') {
      exts = ['m3u8', 'ts'];
    } else {
      origExt = (origExt || 'mp4').toLowerCase().replace(/^\./, '');
      exts = [origExt];
      if (origExt !== 'mp4') exts.push('mp4');
      if (origExt !== 'mkv') exts.push('mkv');
    }

    var urls = [];
    for (var i = 0; i < exts.length; i++) urls.push(urlFn(id, exts[i]));
    return urls;
  }

  /* ══════════════════════════════════════
     Reproduz uma URL: detecta HLS e usa estratégia certa
  ══════════════════════════════════════ */
  function _playUrl(url) {
    if (!_video || !url) return;

    _destroyHls();
    try { _video.pause(); _video.removeAttribute('src'); _video.load(); } catch (e) {}

    var isHls = /\.m3u8(\?|$)/i.test(url);

    if (isHls) {
      /* Suporte nativo? Smart TVs e Safari decodificam HLS direto */
      var canNative = _video.canPlayType('application/vnd.apple.mpegurl') ||
                      _video.canPlayType('application/x-mpegURL');
      if (canNative) {
        _playDirect(url);
        _startWatchdog();
        return;
      }
      /* Sem HLS nativo: carrega HLS.js */
      _loadScript(HLS_CDN, function () {
        if (window.Hls && Hls.isSupported()) _initHls(url);
        else _playDirect(url); /* última tentativa */
      }, function () {
        _playDirect(url);
      });
      _startWatchdog();
      return;
    }

    /* Não-HLS: vídeo direto (mp4, mkv, ts) */
    _playDirect(url);
    _startWatchdog();
  }

  function _playDirect(url) {
    if (!_video) return;
    _video.preload = 'auto';
    _video.src = url;
    try { _video.load(); } catch (e) {}
    var p = _video.play();
    if (p && p.catch) {
      p.catch(function () {
        /* autoplay bloqueado: aguarda canplay para tocar */
        var on = function () {
          _video.removeEventListener('canplay', on);
          try { _video.play(); } catch (e) {}
        };
        _video.addEventListener('canplay', on);
      });
    }
  }

  function _initHls(url) {
    _destroyHls();
    var hls = new Hls({
      enableWorker: false,
      maxBufferLength: 20,
      maxMaxBufferLength: 40,
      manifestLoadingTimeOut: 15000,
      levelLoadingTimeOut:    15000,
      fragLoadingTimeOut:     20000
    });
    _hls = hls;
    hls.loadSource(url);
    hls.attachMedia(_video);
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      var p = _video.play();
      if (p && p.catch) p.catch(function () {});
    });
    hls.on(Hls.Events.ERROR, function (evt, data) {
      if (data && data.fatal) {
        _destroyHls();
        if (!_isPlaying) _tryNextUrl();
      }
    });
  }

  /* ══════════════════════════════════════
     Próxima URL na cascata
  ══════════════════════════════════════ */
  function _tryNextUrl() {
    _clearWatchdog();
    _urlIdx++;
    if (_urlIdx < _urls.length) {
      var url = _urls[_urlIdx];
      _showLoading('Tentando outro formato...');
      _playUrl(url);
    } else {
      var msg = (_currentItem && _currentItem._type === 'live')
        ? 'Canal indisponível no momento.'
        : 'Não foi possível reproduzir este vídeo.';
      _showError(msg);
    }
  }

  /* ══════════════════════════════════════
     Watchdog: detecta travamento de buffer
  ══════════════════════════════════════ */
  function _startWatchdog() {
    _clearWatchdog();
    _bufTimer = setTimeout(function () {
      if (!_isPlaying) _tryNextUrl();
    }, 15000);
  }
  function _clearWatchdog() {
    if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null; }
  }

  /* ══════════════════════════════════════
     Progress save
  ══════════════════════════════════════ */
  function _startProgressTimer() {
    _clearProgressTimer();
    _progressTimer = setInterval(function () {
      if (_video && _isPlaying && _currentItem && _currentItem._type !== 'live') {
        var id = String(_currentItem._episodeId || _currentItem.vod_id ||
                        _currentItem.stream_id || _currentItem.id || '');
        if (id && isFinite(_video.duration) && _video.duration > 0) {
          Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
        }
      }
    }, 10000);
  }
  function _clearProgressTimer() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  }

  /* ══════════════════════════════════════
     Destroy
  ══════════════════════════════════════ */
  function _destroyHls() {
    _clearWatchdog();
    if (_hls) {
      try { _hls.destroy(); } catch (e) {}
      _hls = null;
    }
  }
  function _destroyAll() {
    _clearWatchdog();
    _clearProgressTimer();
    _destroyHls();
    if (_video) {
      try { _video.pause(); _video.removeAttribute('src'); _video.load(); } catch (e) {}
    }
  }

  /* ══════════════════════════════════════
     CDN loader
  ══════════════════════════════════════ */
  function _loadScript(src, onload, onerror) {
    if (window.Hls) { onload(); return; }
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
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
     Controles
  ══════════════════════════════════════ */
  function _bindControls() {
    var btnBack  = document.getElementById('player-back');
    var btnPlay  = document.getElementById('player-play-pause');
    var btnRetry = document.getElementById('player-retry');
    var btnErr   = document.getElementById('player-back-from-error');
    var btnNext  = document.getElementById('player-next-skip');
    var progress = document.getElementById('player-progress-bar');

    if (btnBack)  btnBack.addEventListener('click', function () { App.goBack(); });
    if (btnErr)   btnErr.addEventListener('click', function () { App.goBack(); });
    if (btnPlay)  btnPlay.addEventListener('click', togglePlayPause);
    if (btnRetry) btnRetry.addEventListener('click', function () { if (_currentItem) play(_currentItem); });
    if (btnNext)  btnNext.addEventListener('click', function () {
      if (_nextCallback) _nextCallback();
      _hideNextCard();
    });

    if (progress) {
      progress.addEventListener('click', function (e) {
        if (!_video || !_video.duration) return;
        var rect = progress.getBoundingClientRect();
        _video.currentTime = ((e.clientX - rect.left) / rect.width) * _video.duration;
        _showOverlay();
      });
    }
  }

  /* ══════════════════════════════════════
     Eventos do vídeo
  ══════════════════════════════════════ */
  function _onMetadataLoaded() {
    var dur = _video ? _video.duration : 0;

    /* Detecta redirecionamento para "tela de erro" do servidor (vídeo de 30s) */
    var fake = (dur > 0 && dur < 60 && _currentItem &&
               (_currentItem._type === 'movie' || _currentItem._type === 'series'));
    if (fake) { _tryNextUrl(); return; }

    /* Cancela watchdog anterior, cria um mais curto pra detectar travada após metadata */
    _clearWatchdog();
    _showLoading('Iniciando...');
    _bufTimer = setTimeout(function () {
      if (!_isPlaying) _tryNextUrl();
    }, 10000);

    /* Aplica retomada */
    if (_resumePendingTime > 0 && dur > _resumePendingTime) {
      var t = _resumePendingTime;
      _resumePendingTime = 0;
      setTimeout(function () {
        if (_video) { try { _video.currentTime = t; } catch (e) {} }
      }, 300);
    } else {
      _resumePendingTime = 0;
    }
  }

  function _onPlaying() {
    _isPlaying = true;
    _clearWatchdog();
    _hideLoading();
    _hideError();
    _setPlayBtnIcon('pause');
    _showOverlay();
    if (_currentItem && _currentItem._type !== 'live' && !_progressTimer) {
      _startProgressTimer();
    }
  }

  function _onWaiting() {
    _showLoading('Buffering...');
  }

  function _onPaused() {
    _isPlaying = false;
    if (_currentItem && _currentItem._type !== 'live' && _video) {
      var id = String(_currentItem._episodeId || _currentItem.vod_id ||
                      _currentItem.stream_id || _currentItem.id || '');
      if (id && isFinite(_video.duration) && _video.duration > 0 && _video.currentTime > 5) {
        Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
      }
    }
    _setPlayBtnIcon('play');
    _showOverlay();
  }

  function _onEnd() {
    _clearProgressTimer();
    if (_currentItem && _currentItem._type !== 'live') {
      var id = String(_currentItem._episodeId || _currentItem.vod_id ||
                      _currentItem.stream_id || _currentItem.id || '');
      if (id) Storage.removeProgress(id);
    }
    _setPlayBtnIcon('play');
    _showOverlay();
  }

  function _onNativeError() {
    _hideLoading();
    if (!_currentItem) return;
    if (!_isPlaying) _tryNextUrl();
  }

  function _onTimeUpdate() {
    /* TVs antigas podem não disparar 'playing' — usa avanço do timer como prova */
    if (!_isPlaying && _video && _video.currentTime > 0.2) _onPlaying();
    if (_isSeeking) return;

    var fill = document.getElementById('player-progress-fill');
    var curEl = document.getElementById('player-time-current');
    var totEl = document.getElementById('player-time-total');
    if (!_video) return;
    var cur = _video.currentTime, dur = _video.duration;
    if (fill)  fill.style.width = (dur ? (cur / dur * 100) : 0) + '%';
    if (curEl) curEl.textContent = _formatTime(cur);
    if (totEl) totEl.textContent = (dur && isFinite(dur)) ? _formatTime(dur) : '--:--';

    /* Card de "próximo vídeo" */
    if (_currentItem && (_currentItem._type === 'movie' || _currentItem._type === 'series')) {
      if (dur > 300 && dur - cur <= 60) {
        if (!_nextShown && _nextItem) _showNextCard();
      } else if (_nextShown) {
        _hideNextCard();
      }
    }
  }

  function _setPlayBtnIcon(state) {
    var btn = document.getElementById('player-play-pause');
    if (!btn) return;
    if (state === 'pause') {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    }
  }

  /* ══════════════════════════════════════
     Próximo episódio (autoplay)
  ══════════════════════════════════════ */
  function _showNextCard() {
    if (!_nextItem) return;
    var card  = document.getElementById('player-next-card');
    var title = document.getElementById('player-next-title');
    if (title) title.textContent = _nextItem.name || 'Próximo';
    if (card) {
      card.classList.remove('hidden');
      _nextShown = true;
      _startSkipCountdown();
      var btn = document.getElementById('player-next-skip');
      if (btn) btn.focus();
    }
  }
  function _hideNextCard() {
    var card = document.getElementById('player-next-card');
    if (card) card.classList.add('hidden');
    _nextShown = false;
    _clearSkipCountdown();
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.focus();
  }
  function _startSkipCountdown() {
    _clearSkipCountdown();
    _skipStartTime = Date.now();
    var duration = 30000;
    _skipInterval = setInterval(function () {
      var pct = Math.min(100, (Date.now() - _skipStartTime) / duration * 100);
      var el = document.getElementById('player-next-progress');
      if (el) el.style.setProperty('--skip-progress', pct + '%');
    }, 200);
    _skipTimer = setTimeout(function () {
      if (_nextCallback) _nextCallback();
      _hideNextCard();
    }, duration);
  }
  function _clearSkipCountdown() {
    if (_skipTimer)    clearTimeout(_skipTimer);
    if (_skipInterval) clearInterval(_skipInterval);
    _skipTimer = null; _skipInterval = null;
    var el = document.getElementById('player-next-progress');
    if (el) el.style.setProperty('--skip-progress', '0%');
  }
  function setNextItem(item, callback) {
    _nextItem     = item;
    _nextCallback = callback;
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
     Loading / Error
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
     Helpers
  ══════════════════════════════════════ */
  function _formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = Math.floor(s % 60);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(sec);
    return m + ':' + pad(sec);
  }

  return {
    init:            init,
    play:            play,
    stop:            stop,
    seek:            seek,
    setNextItem:     setNextItem,
    togglePlayPause: togglePlayPause
  };
})();
