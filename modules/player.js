/**
 * player.js – Player de vídeo IPTV
 *
 * Estratégia para canais ao vivo (INALTERADA):
 *   1. mpegts.js  → stream MPEG-TS direto (.ts)
 *   2. HLS.js     → fallback .m3u8
 *   3. Nativo     → Safari / WebKit SmartTV
 *
 * Para filmes/séries (CORRIGIDO):
 *   → URL construída diretamente com IP do servidor (_VOD_BASE)
 *   → Sem proxies CORS (não funcionam para streaming de vídeo)
 *   → Fallback de extensão: ext original → mp4 → mkv
 */

var Player = (function () {
  'use strict';

  /* ── CDNs ─────────────────────────────────────────────────── */
  var MPEGTS_CDN = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js';
  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';

  /* ── IP direto para filmes e séries ──────────────────────── */
  /* Usar IP direto evita problemas de DNS/bloqueio de domínio  */
  var _VOD_BASE = 'http://191.96.78.246';

  /* ── Estado geral ─────────────────────────────────────────── */
  var _video = null;
  var _overlay = null;
  var _hideTimer = null;
  var _bufTimer = null;
  var _currentItem = null;
  var _isPlaying = false;
  var _mpegts = null;
  var _hls = null;
  var _attempt = 0;       /* live: 0=mpegts, 1=hls, 2=nativo */
  var _proxyAttempt = false;
  var _proxyIdx = 0;

  /* ── Estado VOD ───────────────────────────────────────────── */
  var _vodUrls = [];  /* lista de URLs a tentar, em ordem */
  var _vodUrlIdx = 0;  /* índice atual */
  var _nextItem = null;
  var _nextCallback = null;
  var _nextCardShown = false;
  var _skipStartTime = 0;
  var _skipTimer = null;
  var _skipInterval = null;
  var _progressTimer = null;
  var _resumePendingTime = 0;


  /* ── Buffered Seek ────────────────────────────────────────── */
  var _isSeeking = false;
  var _seekValue = 0;
  var _seekTimer = null;


  /* ══════════════════════════════════════
     INICIALIZAÇÃO
  ══════════════════════════════════════ */
  function init() {
    _video = document.getElementById('video-player');
    _overlay = document.getElementById('player-overlay');
    if (!_video) return;

    _video.addEventListener('playing', _onPlaying);
    _video.addEventListener('waiting', _onWaiting);
    _video.addEventListener('paused', _onPaused);
    _video.addEventListener('ended', _onEnd);
    _video.addEventListener('error', _onNativeError);
    _video.addEventListener('timeupdate', _onTimeUpdate);
    _video.addEventListener('loadedmetadata', _onMetadataLoaded);

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
    _isPlaying = false;
    _nextCardShown = false;
    _hideNextCard();
    _clearSkipCountdown();
    _clearProgressTimer();
    _isSeeking = false;
    if (_seekTimer) clearTimeout(_seekTimer);

    // Item da watchlist já vem com _resumeTime definido
    // Usa esse valor como pendente e vai direto para playback
    if (item._resumeTime && item._resumeTime > 10 && item._type !== 'live') {
      _resumePendingTime = item._resumeTime;
      _startPlayback(item);
      return;
    }

    // Item sem _resumeTime: verifica no Storage normalmente
    var id = String(item._episodeId || item.vod_id || item.stream_id || item.id || '');
    var progress = (id && item._type !== 'live') ? Storage.getProgress(id) : null;

    if (progress && progress.time > 10) {
      _resumePendingTime = 0;
      _showResumePrompt(progress, item);
      return;
    }

    _resumePendingTime = 0;
    _startPlayback(item);
  }

  function _showResumePrompt(progress, item) {
    var modal = document.getElementById('modal-resume');
    var timeDisplay = document.getElementById('resume-time-display');
    var btnContinue = document.getElementById('btn-resume-continue');
    var btnStartOver = document.getElementById('btn-resume-start-over');

    if (!modal || !timeDisplay || !btnContinue || !btnStartOver) {
      _startPlayback(item);
      return;
    }

    timeDisplay.textContent = _formatTime(progress.time);
    modal.classList.remove('hidden');

    btnContinue.onclick = function () {
      modal.classList.add('hidden');
      _resumePendingTime = progress.time;
      _startPlayback(item);
    };

    btnStartOver.onclick = function () {
      modal.classList.add('hidden');
      _resumePendingTime = 0;
      _startPlayback(item);
    };

    /* Foca botão de continuar por padrão */
    setTimeout(function () { btnContinue.focus(); }, 100);
  }

  function _startPlayback(item) {
    _destroyAll();
    _showLoading('Carregando...');
    _hideError();

    /* Gerencia classes de UI */
    var screenEl = document.getElementById('screen-player');
    if (screenEl) {
      if (item._type === 'movie' || item._type === 'series') screenEl.classList.add('vod-mode');
      else screenEl.classList.remove('vod-mode');
    }

    /* Foca botão prioritário */
    setTimeout(function () {
      var btn = document.getElementById('player-play-pause');
      if (btn) btn.focus();
    }, 200);

    /* UI do player */
    var titleEl = document.getElementById('player-title');
    var logoEl = document.getElementById('player-logo');
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
      _startVOD();
    }
  }

  function stop() {
    if (_currentItem && _currentItem._type !== 'live' && _video) {
      var id = String(_currentItem._episodeId || _currentItem.vod_id || _currentItem.stream_id || _currentItem.id || '');
      if (id && _video.duration > 0 && isFinite(_video.duration) && _video.currentTime > 5) {
        Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
        console.log('[Player] Progresso salvo ao parar:', Math.round(_video.currentTime) + 's');
      }
    }
    _clearProgressTimer();
    _destroyAll();
    _currentItem = null;
  }

  /* ══════════════════════════════════════
     LIVE: sequência de tentativas
     (código original, INALTERADO)
  ══════════════════════════════════════ */
  function _startLive() {
    if (!_currentItem) return;

    var tsUrl = _getLiveUrl('ts');
    var m3u8Url = _getLiveUrl('m3u8');

    var ua = navigator.userAgent.toLowerCase();
    var isTV = ua.indexOf('smart-tv') !== -1 || ua.indexOf('smarttv') !== -1 ||
      ua.indexOf('tizen') !== -1 || ua.indexOf('webos') !== -1 ||
      ua.indexOf('viera') !== -1 || ua.indexOf('panasonic') !== -1 ||
      ua.indexOf('netcast') !== -1 || ua.indexOf('tv') !== -1;

    var canNativeHls = _video && (
      _video.canPlayType('application/vnd.apple.mpegurl') ||
      _video.canPlayType('application/x-mpegurl')
    );

    if (isTV && canNativeHls) {
      _attempt = 2; /* TV com HLS nativo: pula mpegts/hlsjs */
    } else {
      _attempt = 0;
    }

    _tryLive(tsUrl, m3u8Url);
  }

  function _tryLive(tsUrl, m3u8Url) {
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
        _attempt = 1;
        _tryLive(tsUrl, m3u8Url);
      });
      return;
    }

    if (_attempt === 1) {
      _showLoading('Tentando HLS...');
      _loadScript(HLS_CDN, function () {
        if (window.Hls && Hls.isSupported()) {
          _initHLS(m3u8Url, tsUrl);
        } else {
          _attempt = 2;
          _tryLive(tsUrl, m3u8Url);
        }
      }, function () {
        _attempt = 2;
        _tryLive(tsUrl, m3u8Url);
      });
      return;
    }

    if (_attempt === 2) {
      _showLoading('Reprodução nativa' + (_proxyAttempt ? ' (Proxy)' : '') + '...');
      _playDirect(m3u8Url);

      _startBufWatchdog(function () {
        if (!_proxyAttempt) {
          console.warn('[Player] Falha geral no direto, iniciando modo Proxy...');
          _proxyAttempt = true;
          _proxyIdx = 0;
          _attempt = 0;
          _startLive();
        } else if (_proxyIdx < 2) {
          _proxyIdx++;
          console.warn('[Player] Proxy ' + (_proxyIdx - 1) + ' falhou, tentando Proxy ' + _proxyIdx + '...');
          _attempt = 0;
          _startLive();
        } else {
          _showError('Canal offline ou bloqueado (todos os proxies falharam).');
        }
      });
      return;
    }

    _showError('Stream indisponível. Verifique sua conexão.');
  }


  /* ══════════════════════════════════════
     mpegts.js (live – INALTERADO)
  ══════════════════════════════════════ */
  function _initMpegts(tsUrl, fallbackM3u8) {
    _destroyMpegts();

    var player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: tsUrl,
      cors: true,
      referrerPolicy: 'no-referrer'
    }, {
      enableWorker: false,
      enableStashBuffer: true,
      stashInitialSize: 1024 * 1024, /* 1MB buffer inicial para evitar travas */
      liveBufferLatencyChasing: false, /* Desativa pulos para manter estabilidade */
      liveSync: false,
      lazyLoadMaxDuration: 5 * 60,
      seekType: 'range'
    });

    _mpegts = player;
    player.attachMediaElement(_video);

    player.on(mpegts.Events.ERROR, function (errType, errDetail) {
      console.warn('[Player] mpegts erro:', errType, errDetail);
      _destroyMpegts();
      if (!_isPlaying) {
        _attempt = 1;
        _tryLive(tsUrl, fallbackM3u8);
      }
    });

    try {
      player.load();
      var p = player.play();
      if (p && p.catch) p.catch(function () { });
    } catch (e) {
      console.warn('[Player] mpegts play() exception:', e);
    }

    _startBufWatchdog(function () {
      _destroyMpegts();
      _attempt = 1;
      _tryLive(tsUrl, fallbackM3u8);
    });
  }


  /* ══════════════════════════════════════
     HLS.js (live – INALTERADO)
  ══════════════════════════════════════ */
  function _initHLS(m3u8Url, tsUrl) {
    _destroyHLS();

    var hls = new Hls({
      maxBufferLength: 30, /* Aumentado de 8 para 30s de segurança */
      maxMaxBufferLength: 60,
      liveSyncDurationCount: 5, /* Inicia 5 blocos atrás do vivo para estabilidade */
      liveMaxLatencyDurationCount: 10,
      enableWorker: false,
      startFragPrefetch: true,
      manifestLoadingTimeOut: 15000,
      levelLoadingTimeOut: 15000,
      fragLoadingTimeOut: 20000,
      xhrSetup: function (xhr) {
        xhr.withCredentials = false;
      }
    });

    _hls = hls;
    hls.loadSource(m3u8Url);
    hls.attachMedia(_video);

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      var p = _video.play();
      if (p && p.catch) p.catch(function () { });
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
     VOD: Filmes e Séries
     Usa IP direto – sem CORS proxy
     (proxies CORS não suportam streaming
      de vídeo, apenas texto/JSON)
  ══════════════════════════════════════ */

  /**
   * Monta a lista de URLs a tentar para um item VOD.
   * Formato Xtream Codes:
   *   Filme:  /movie/user/pass/stream_id.ext
   *   Série:  /series/user/pass/episode_id.ext
   * Tenta extensão original, depois mp4, depois mkv.
   */
  function _buildVodUrls(item) {
    var creds = typeof Auth !== 'undefined' ? Auth.getCredentials() : null;
    if (!creds || !creds.username || !creds.password) return [];

    // Pega o servidor real das credenciais em vez do IP hardcoded
    var base = creds.server || _VOD_BASE;
    // Remove barra final
    base = base.replace(/\/$/, '');

    // Se tiver serverInfo com url/port, usa o bypass igual ao API.js
    var si = creds.serverInfo;
    if (si) {
      var siUrl = String(si.url || '').trim();
      var siProto = String(si.server_protocol || 'http').trim().toLowerCase();
      var siPort = String(si.port || '80').trim();
      if (siUrl) {
        base = siProto + '://' + siUrl + (siPort === '80' && siProto === 'http' ? '' : ':' + siPort);
      }
    }

    var u = encodeURIComponent(creds.username);
    var p = encodeURIComponent(creds.password);
    var urls = [];

    function makeExts(orig) {
      orig = (orig || 'mp4').toLowerCase().replace(/^\./, '');
      var list = ['mp4'];
      if (orig !== 'mp4') list.unshift(orig); // extensão original tem prioridade
      list.push('ts');
      var seen = {}, uniq = [];
      for (var i = 0; i < list.length; i++) {
        if (!seen[list[i]]) { seen[list[i]] = true; uniq.push(list[i]); }
      }
      return uniq;
    }

    if (item._type === 'movie') {
      var id = item.vod_id || item.stream_id || item.id;
      if (!id) return [];
      var exts = makeExts(item.container_extension);
      for (var i = 0; i < exts.length; i++) {
        urls.push(base + '/movie/' + u + '/' + p + '/' + id + '.' + exts[i]);
      }
    } else if (item._type === 'series' && item._episodeId) {
      var extsSeries = makeExts(item._episodeExt);
      for (var j = 0; j < extsSeries.length; j++) {
        urls.push(base + '/series/' + u + '/' + p + '/' + item._episodeId + '.' + extsSeries[j]);
      }
    }

    console.log('[Player] VOD URLs:', urls);
    return urls;
  }

  function _startVOD() {
    if (!_currentItem) return;

    _vodUrls = _buildVodUrls(_currentItem);
    _vodUrlIdx = 0;

    if (!_vodUrls.length) {
      _showError('URL de stream não disponível. Verifique as credenciais.');
      return;
    }

    console.log('[Player] VOD URLs a tentar:', _vodUrls);
    _showLoading('Carregando vídeo...');
    _playDirect(_vodUrls[0]);

    /* Watchdog: 25s sem reprodução → tenta próxima URL/extensão */
    _startBufWatchdog(function () {
      if (!_isPlaying) {
        console.warn('[Player] VOD watchdog: sem resposta em 25s');
        _tryNextVodUrl();
      }
    }, 25000);
  }

  function _tryNextVodUrl() {
    _clearBufWatchdog();
    _vodUrlIdx++;

    if (_vodUrlIdx < _vodUrls.length) {
      var url = _vodUrls[_vodUrlIdx];
      var ext = url.split('.').pop().toUpperCase();
      console.warn('[Player] VOD tentando próxima URL (' + ext + '):', url);
      _showLoading('Tentando formato ' + ext + '...');
      _playDirect(url);

      _startBufWatchdog(function () {
        if (!_isPlaying) _tryNextVodUrl();
      }, 20000);
    } else {
      _showError(
        'Não foi possível reproduzir este vídeo.\n' +
        'Servidor: ' + _VOD_BASE + '\n' +
        'Verifique sua conexão de rede.'
      );
    }
  }

  function _onVODError() {
    _clearBufWatchdog();
    if (!_isPlaying) {
      console.warn('[Player] Erro nativo no VOD, tentando próxima URL...');
      _tryNextVodUrl();
    }
  }


  /* ══════════════════════════════════════
     Reprodução direta
  ══════════════════════════════════════ */
  function _playDirect(url) {
    if (!_video) return;
    _video.pause();
    _video.removeAttribute('src');
    try { _video.load(); } catch (e) { }

    _video.setAttribute('referrerpolicy', 'no-referrer');
    _video.preload = 'auto';
    _video.src = url;
    _video.load();

    var p = _video.play();
    if (p && p.catch) {
      p.catch(function (err) {
        console.warn('[Player] play() rejeitado:', err);
        _showLoading(false);
        _showOverlay();
      });
    }
    // NÃO aplica _resumePendingTime aqui — é aplicado no _onMetadataLoaded
  }



  /* ══════════════════════════════════════
     Destroy helpers
  ══════════════════════════════════════ */
  function _destroyMpegts() {
    _clearBufWatchdog();
    if (_mpegts) {
      try { _mpegts.pause(); _mpegts.unload(); _mpegts.detachMediaElement(); _mpegts.destroy(); } catch (e) { }
      _mpegts = null;
    }
  }

  function _destroyHLS() {
    _clearBufWatchdog();
    if (_hls) {
      try { _hls.destroy(); } catch (e) { }
      _hls = null;
    }
    if (_video) {
      _video.removeAttribute('src');
      try { _video.load(); } catch (e) { }
    }
  }

  function _destroyAll() {
    _clearProgressTimer();
    _clearBufWatchdog();
    _destroyMpegts();
    if (_hls) { try { _hls.destroy(); } catch (e) { } _hls = null; }
    if (_video) {
      _video.pause();
      _video.removeAttribute('src');
      try { _video.load(); } catch (e) { }
    }
  }



  /* ══════════════════════════════════════
     Watchdog de buffering
  ══════════════════════════════════════ */
  function _startBufWatchdog(onTimeout, customTime) {
    _clearBufWatchdog();
    if (!onTimeout) return;

    /* Live: 8s direto / 20s via proxy. VOD: passado como parâmetro */
    var time = customTime !== undefined
      ? customTime
      : (_proxyAttempt ? 20000 : 8000);

    _bufTimer = setTimeout(function () {
      if (!_isPlaying) {
        console.warn('[Player] Watchdog timeout (' + time + 'ms)');
        onTimeout();
      }
    }, time);
  }

  function _clearBufWatchdog() {
    if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null; }
  }

  /* ── Progresso do vídeo ── */
  function _startProgressTimer() {
    _clearProgressTimer();
    _progressTimer = setInterval(function () {
      if (_video && _isPlaying && _currentItem && _currentItem._type !== 'live') {
        var id = String(_currentItem._episodeId || _currentItem.vod_id || _currentItem.stream_id || _currentItem.id || '');
        if (id && isFinite(_video.duration) && _video.duration > 0) {
          Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
        }
      }
    }, 10000);
  }

  function _clearProgressTimer() {
    if (_progressTimer) {
      clearInterval(_progressTimer);
      _progressTimer = null;
    }
  }



  /* ══════════════════════════════════════
     Helpers de URL (live – INALTERADO)
  ══════════════════════════════════════ */
  function _getLiveUrl(ext) {
    if (!_currentItem) return '';
    return API.getLiveStreamUrl(_currentItem.stream_id, ext, _proxyAttempt, _proxyIdx);
  }


  /* ══════════════════════════════════════
     Carregamento de scripts CDN (INALTERADO)
  ══════════════════════════════════════ */
  function _loadScript(src, onload, onerror) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      var libReady = (src.indexOf('mpegts') !== -1 && window.mpegts) ||
        (src.indexOf('hls') !== -1 && window.Hls);
      if (libReady) { onload(); return; }
      existing.addEventListener('load', onload);
      existing.addEventListener('error', onerror);
      return;
    }
    var s = document.createElement('script');
    s.src = src;
    s.onload = onload;
    s.onerror = onerror;
    document.head.appendChild(s);
  }


  /* ══════════════════════════════════════
     Controles do player (INALTERADO)
  ══════════════════════════════════════ */
  function _bindControls() {
    var btnBack = document.getElementById('player-back');
    var btnPlay = document.getElementById('player-play-pause');
    var btnFwd = document.getElementById('player-seek-fwd');
    var btnRew = document.getElementById('player-seek-back');
    var btnFS = document.getElementById('player-fullscreen');
    var btnRetry = document.getElementById('player-retry');
    var btnBackErr = document.getElementById('player-back-from-error');
    var progressBar = document.getElementById('player-progress-bar');
    var btnNext = document.getElementById('player-next-skip');

    if (btnBack) btnBack.addEventListener('click', function () { App.goBack(); });
    if (btnBackErr) btnBackErr.addEventListener('click', function () { App.goBack(); });
    if (btnPlay) btnPlay.addEventListener('click', togglePlayPause);
    if (btnRetry) btnRetry.addEventListener('click', function () { if (_currentItem) play(_currentItem); });
    if (btnNext) btnNext.addEventListener('click', function () {
      if (_nextCallback) _nextCallback();
      _hideNextCard();
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
    }, 1500);
  }

  function _updateSeekUI(targetTime) {
    var fill = document.getElementById('player-progress-fill');
    var curEl = document.getElementById('player-time-current');
    var dur = _video ? _video.duration : 0;

    if (fill) fill.style.width = (dur ? (targetTime / dur * 100) : 0) + '%';
    if (curEl) curEl.textContent = _formatTime(targetTime);
  }

  function togglePlayPause() {
    if (!_video) return;
    if (_video.paused) {
      var p = _video.play();
      if (p && p.catch) p.catch(function () { });
    } else {
      _video.pause();
    }
    _showOverlay();

    /* Mantém o foco no botão de play para o Enter funcionar */
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.focus();
  }


  /* ══════════════════════════════════════
     Eventos do vídeo
  ══════════════════════════════════════ */
  function _onMetadataLoaded() {
    var dur = _video ? _video.duration : 0;

    var isAbuse = (dur > 0 && dur < 60 &&
      _currentItem &&
      (_currentItem._type === 'movie' || _currentItem._type === 'series'));
    if (isAbuse) {
      console.warn('[Player] Redirecionamento detectado (duration=' + dur + 's)');
      _onVODError();
      return;
    }

    _showLoading(false);
    _isPlaying = true;
    _clearBufWatchdog();

    // Aplica seek de retomada somente aqui, após metadata estar disponível
    if (_resumePendingTime > 0 && _video && dur > _resumePendingTime) {
      var seekTo = _resumePendingTime;
      _resumePendingTime = 0;
      console.log('[Player] Retomando em:', seekTo + 's de ' + dur + 's');
      setTimeout(function () {
        if (_video) {
          try { _video.currentTime = seekTo; } catch (e) { console.warn('[Player] seek falhou:', e); }
        }
      }, 300);
    } else {
      _resumePendingTime = 0;
    }
  }

  function _onPlaying() {
    _isPlaying = true;
    _clearBufWatchdog();
    _hideLoading();
    _hideError();
    var btn = document.getElementById('player-play-pause');
    if (btn) btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    _showOverlay();

    // Inicia progresso apenas para filmes/séries e apenas se não estiver rodando já
    if (_currentItem && _currentItem._type !== 'live' && !_progressTimer) {
      _startProgressTimer();
    }
  }

  function _onWaiting() {
    _showLoading('Buffering...');
  }

  function _onPaused() {
    _isPlaying = false;

    // Salva progresso ao pausar (além do intervalo de 10s)
    if (_currentItem && _currentItem._type !== 'live' && _video) {
      var id = String(_currentItem._episodeId || _currentItem.vod_id || _currentItem.stream_id || _currentItem.id || '');
      if (id && isFinite(_video.duration) && _video.duration > 0 && _video.currentTime > 5) {
        Storage.saveProgress(id, _video.currentTime, _video.duration, _currentItem);
        console.log('[Player] Progresso salvo ao pausar:', Math.round(_video.currentTime) + 's / ' + Math.round(_video.duration) + 's');
      }
    }

    var btn = document.getElementById('player-play-pause');
    if (btn) btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    _showOverlay();
  }

  function _onEnd() {
    _clearProgressTimer();

    // Remove o progresso salvo quando o vídeo termina
    if (_currentItem && _currentItem._type !== 'live') {
      var id = String(_currentItem._episodeId || _currentItem.vod_id || _currentItem.stream_id || _currentItem.id || '');
      if (id) {
        Storage.removeProgress(id);
        console.log('[Player] Progresso removido (vídeo finalizado):', id);
      }
    }

    var btn = document.getElementById('player-play-pause');
    if (btn) btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>';
    _showOverlay();
  }


  function _onNativeError() {
    _hideLoading();
    if (!_currentItem) return;

    var code = (_video && _video.error) ? _video.error.code : 0;
    var msgs = {
      1: 'Carregamento interrompido pelo usuário',
      2: 'Erro de rede ao carregar o vídeo',
      3: 'Erro de decodificação (formato incompatível)',
      4: 'Formato de vídeo não suportado pela TV'
    };
    console.warn('[Player] Erro nativo código:', code, msgs[code] || '');

    /* VOD: tenta próxima URL/extensão */
    if (_currentItem._type === 'movie' || _currentItem._type === 'series') {
      _onVODError();
      return;
    }

    /* Live: avança para próxima tentativa */
    if (_attempt >= 2 || _isPlaying) {
      _showError(msgs[code] || 'Erro ao reproduzir. Tente outro canal.');
      return;
    }
    _attempt++;
    _tryLive(_getLiveUrl('ts'), _getLiveUrl('m3u8'));
  }

  function _onTimeUpdate() {
    if (_isSeeking) return;

    var fill = document.getElementById('player-progress-fill');
    var curEl = document.getElementById('player-time-current');
    var totEl = document.getElementById('player-time-total');
    if (!_video) return;
    var cur = _video.currentTime;
    var dur = _video.duration;

    if (fill) fill.style.width = (dur ? (cur / dur * 100) : 0) + '%';
    if (curEl) curEl.textContent = _formatTime(cur);
    if (totEl) totEl.textContent = (dur && isFinite(dur)) ? _formatTime(dur) : '--:--';

    /* Lógica de Próximo Vídeo (VOD) */
    if (_currentItem && (_currentItem._type === 'movie' || _currentItem._type === 'series')) {
      if (dur > 300 && dur - cur <= 60) {
        if (!_nextCardShown && _nextItem) _showNextCard();
      } else {
        if (_nextCardShown) _hideNextCard();
      }
    }
  }

  function _showNextCard() {
    if (!_nextItem) return;
    var card = document.getElementById('player-next-card');
    var title = document.getElementById('player-next-title');
    if (title) title.textContent = _nextItem.name || 'Próximo';
    if (card) {
      card.classList.remove('hidden');
      _nextCardShown = true;
      _startSkipCountdown();

      /* Foca o botão de pular automaticamente */
      var nextBtn = document.getElementById('player-next-skip');
      if (nextBtn) nextBtn.focus();
    }
  }

  function _hideNextCard() {
    var card = document.getElementById('player-next-card');
    if (card) card.classList.add('hidden');
    _nextCardShown = false;
    _clearSkipCountdown();

    /* Retorna o foco para o play quando o card some */
    var playBtn = document.getElementById('player-play-pause');
    if (playBtn) playBtn.focus();
  }

  function _startSkipCountdown() {
    _clearSkipCountdown();
    _skipStartTime = Date.now();
    var duration = 30000; // 30 segundos

    _skipInterval = setInterval(function () {
      var elapsed = Date.now() - _skipStartTime;
      var pct = Math.min(100, (elapsed / duration) * 100);
      var progressEl = document.getElementById('player-next-progress');
      if (progressEl) progressEl.style.setProperty('--skip-progress', pct + '%');
    }, 100);

    _skipTimer = setTimeout(function () {
      if (_nextCallback) {
        console.log('[Player] Autoplay: Pulando para o próximo...');
        _nextCallback();
      }
      _hideNextCard();
    }, duration);
  }

  function _clearSkipCountdown() {
    if (_skipTimer) clearTimeout(_skipTimer);
    if (_skipInterval) clearInterval(_skipInterval);
    _skipTimer = null;
    _skipInterval = null;
    var progressEl = document.getElementById('player-next-progress');
    if (progressEl) progressEl.style.setProperty('--skip-progress', '0%');
  }

  function setNextItem(item, callback) {
    _nextItem = item;
    _nextCallback = callback;
  }


  /* ══════════════════════════════════════
     Overlay (INALTERADO)
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
     Loading / Error UI (INALTERADO)
  ══════════════════════════════════════ */
  function _showLoading(msg) {
    if (msg === false) { _hideLoading(); return; }
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
    var el = document.getElementById('player-error');
    var txt = document.getElementById('player-error-text');
    if (el) el.classList.remove('hidden');
    if (txt) txt.textContent = msg || 'Erro desconhecido';
  }

  function _hideError() {
    var el = document.getElementById('player-error');
    if (el) el.classList.add('hidden');
  }


  /* ══════════════════════════════════════
     Fullscreen (INALTERADO)
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
     Helpers (INALTERADO)
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
    init: init,
    play: play,
    stop: stop,
    seek: seek,
    setNextItem: setNextItem,
    togglePlayPause: togglePlayPause
  };
})();