/**
 * player.js – Player de vídeo IPTV
 * Suporta HLS via hls.js (carregado sob demanda) e vídeo nativo
 * Otimizado para Smart TVs antigas com interface simples
 */

var Player = (function () {
  'use strict';

  var _hls = null;
  var _video = null;
  var _overlay = null;
  var _hideTimer = null;
  var _currentItem = null;
  var _isPlaying = false;
  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.light.min.js';

  function init() {
    _video = document.getElementById('video-player');
    _overlay = document.getElementById('player-overlay');

    if (!_video) return;

    // Eventos do vídeo
    _video.addEventListener('playing',  _onPlaying);
    _video.addEventListener('waiting',  _onWaiting);
    _video.addEventListener('paused',   _onPaused);
    _video.addEventListener('ended',    _onEnd);
    _video.addEventListener('error',    _onError);
    _video.addEventListener('timeupdate', _onTimeUpdate);

    // Controles
    _bindControls();

    // Mostrar/ocultar overlay ao mover (controle remoto toca OK)
    document.addEventListener('keydown', function (e) {
      var screen = document.getElementById('screen-player');
      if (!screen || screen.classList.contains('hidden')) return;
      _showOverlay();
    });
  }

  function _bindControls() {
    var btnBack = document.getElementById('player-back');
    var btnPlay = document.getElementById('player-play-pause');
    var btnFwd  = document.getElementById('player-forward');
    var btnRew  = document.getElementById('player-rewind');
    var btnFS   = document.getElementById('player-fullscreen');
    var btnRetry = document.getElementById('player-retry');
    var btnBackErr = document.getElementById('player-back-from-error');
    var progressBar = document.getElementById('player-progress-bar');

    if (btnBack) btnBack.addEventListener('click', function () { App.goBack(); });
    if (btnBackErr) btnBackErr.addEventListener('click', function () { App.goBack(); });

    if (btnPlay) btnPlay.addEventListener('click', togglePlayPause);

    if (btnFwd) btnFwd.addEventListener('click', function () {
      if (_video) _video.currentTime = Math.min(_video.currentTime + 10, _video.duration || Infinity);
      _showOverlay();
    });
    if (btnRew) btnRew.addEventListener('click', function () {
      if (_video) _video.currentTime = Math.max(_video.currentTime - 10, 0);
      _showOverlay();
    });

    if (btnFS) btnFS.addEventListener('click', _toggleFullscreen);

    if (btnRetry) btnRetry.addEventListener('click', function () {
      if (_currentItem) play(_currentItem);
    });

    // Clique na barra de progresso
    if (progressBar) {
      progressBar.addEventListener('click', function (e) {
        if (!_video || !_video.duration) return;
        var rect = progressBar.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        _video.currentTime = pct * _video.duration;
        _showOverlay();
      });
    }
  }

  /**
   * Inicia reprodução de um item
   */
  function play(item) {
    _currentItem = item;
    var url = _getStreamUrl(item);

    _showLoading('Carregando stream...');
    _hideError();
    _isPlaying = false;

    // Atualiza UI do player
    var titleEl = document.getElementById('player-title');
    var logoEl  = document.getElementById('player-logo');
    if (titleEl) titleEl.textContent = item.name || '';
    if (logoEl) {
      var icon = item.stream_icon || item.cover || item.series_cover || '';
      if (icon) { logoEl.src = icon; logoEl.style.display = ''; }
      else logoEl.style.display = 'none';
    }

    // Adiciona a recentes
    Storage.addRecent(item);

    // Destruir instância HLS anterior
    _destroyHLS();

    if (!url) {
      _showError('URL de stream não disponível');
      return;
    }

    // Decide se usa HLS ou vídeo nativo
    var ext = _getExt(url);
    var needsHLS = (ext === 'm3u8' || ext === 'hls') && !_video.canPlayType('application/vnd.apple.mpegurl');

    if (needsHLS) {
      _loadHLSandPlay(url);
    } else {
      _playDirect(url);
    }
  }

  function _playDirect(url) {
    _video.src = url;
    _video.load();
    _tryCatch(function () { return _video.play(); });
  }

  function _loadHLSandPlay(url) {
    if (window.Hls) {
      _initHLS(url);
      return;
    }
    // Carrega hls.js sob demanda
    var showLoadingMsg = document.getElementById('player-loading-text');
    if (showLoadingMsg) showLoadingMsg.textContent = 'Carregando suporte HLS...';

    var script = document.createElement('script');
    script.src = HLS_CDN;
    script.onload = function () { _initHLS(url); };
    script.onerror = function () {
      // Fallback: tenta reprodução direta
      console.warn('[Player] Falha ao carregar hls.js, tentando reprodução direta');
      _playDirect(url);
    };
    document.head.appendChild(script);
  }

  function _initHLS(url) {
    if (!window.Hls) { _playDirect(url); return; }
    if (!Hls.isSupported()) {
      _playDirect(url);
      return;
    }
    _hls = new Hls({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      enableWorker: false  // desativado para compatibilidade com TVs antigas
    });
    _hls.loadSource(url);
    _hls.attachMedia(_video);
    _hls.on(Hls.Events.MANIFEST_PARSED, function () {
      _tryCatch(function () { return _video.play(); });
    });
    _hls.on(Hls.Events.ERROR, function (event, data) {
      if (data.fatal) {
        _showError('Erro no stream HLS. Verifique a conexão.');
        _destroyHLS();
      }
    });
  }

  function _destroyHLS() {
    if (_hls) {
      try { _hls.destroy(); } catch (e) {}
      _hls = null;
    }
    if (_video) {
      _video.removeAttribute('src');
      try { _video.load(); } catch(e){}
    }
  }

  function togglePlayPause() {
    if (!_video) return;
    if (_video.paused) {
      _tryCatch(function () { return _video.play(); });
    } else {
      _video.pause();
    }
    _showOverlay();
  }

  function stop() {
    _destroyHLS();
    if (_video) {
      _video.pause();
      _video.removeAttribute('src');
    }
    _currentItem = null;
  }

  // --- Eventos do vídeo ---

  function _onPlaying() {
    _isPlaying = true;
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

  function _onError() {
    _hideLoading();
    var msg = 'Erro ao reproduzir. Verifique sua conexão.';
    if (_video && _video.error) {
      var errCodes = {1: 'Carregamento abortado', 2: 'Erro de rede', 3: 'Decode error', 4: 'Formato não suportado'};
      msg = errCodes[_video.error.code] || msg;
    }
    _showError(msg);
  }

  function _onTimeUpdate() {
    var fill  = document.getElementById('player-progress-fill');
    var curEl = document.getElementById('player-time-current');
    var totEl = document.getElementById('player-time-total');

    if (!_video) return;
    var cur = _video.currentTime;
    var dur = _video.duration;

    if (fill) {
      fill.style.width = (dur ? (cur / dur * 100) : 0) + '%';
    }
    if (curEl) curEl.textContent = _formatTime(cur);
    if (totEl) totEl.textContent = dur && isFinite(dur) ? _formatTime(dur) : '--:--';
  }

  // --- Overlay auto-hide ---

  function _showOverlay() {
    if (!_overlay) return;
    _overlay.classList.remove('hidden-controls');
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(function () {
      if (_isPlaying) _overlay.classList.add('hidden-controls');
    }, 4000);
  }

  // --- Loading / Error UI ---

  function _showLoading(msg) {
    var el = document.getElementById('player-loading');
    var txt = document.getElementById('player-loading-text');
    if (el) el.classList.remove('hidden');
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
    if (el) el.classList.remove('hidden');
    if (txt) txt.textContent = msg || 'Erro desconhecido';
  }

  function _hideError() {
    var el = document.getElementById('player-error');
    if (el) el.classList.add('hidden');
  }

  // --- Fullscreen ---

  function _toggleFullscreen() {
    var el = document.getElementById('screen-player');
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
      } else {
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) req.call(el);
      }
    } catch (e) {
      console.warn('[Player] Fullscreen não suportado', e);
    }
  }

  // --- Helpers ---

  function _getStreamUrl(item) {
    var type = item._type || 'live';
    var creds = Auth.getCredentials();

    // M3U – URL direta
    if (item.url) return item.url;

    // Xtream Codes
    if (creds && creds.type === 'xtream') {
      if (type === 'live') {
        return API.getLiveStreamUrl(item.stream_id);
      } else if (type === 'movie') {
        var ext = item.container_extension || 'mp4';
        return API.getVodStreamUrl(item.stream_id || item.vod_id, ext);
      } else if (type === 'series' && item._episodeId) {
        var ext2 = item._episodeExt || 'mkv';
        return API.getEpisodeStreamUrl(item._episodeId, ext2);
      }
    }
    return '';
  }

  function _getExt(url) {
    try {
      var path = url.split('?')[0];
      var parts = path.split('.');
      return parts[parts.length - 1].toLowerCase();
    } catch (e) { return ''; }
  }

  function _formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = Math.floor(secs % 60);
    if (h > 0) return h + ':' + _pad(m) + ':' + _pad(s);
    return m + ':' + _pad(s);
  }

  function _pad(n) { return n < 10 ? '0' + n : String(n); }

  function _tryCatch(fn) {
    try {
      var result = fn();
      if (result && result.catch) result.catch(function () {});
    } catch (e) {}
  }

  return {
    init:            init,
    play:            play,
    stop:            stop,
    togglePlayPause: togglePlayPause
  };
})();
