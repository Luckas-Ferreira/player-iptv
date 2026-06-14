/**
 * renderer.js — Cards, Pager (rolagem progressiva) e lazy-load de imagens
 *
 * OTIMIZAÇÕES PARA TV ANTIGA:
 *  • Pager: máx 80 cards no DOM ao mesmo tempo (com spacer compensando os removidos)
 *  • CHUNK 8: 8 cards por render — TV antiga não trava processando 30 nós de uma vez
 *  • IMGMAX 4: até 4 imagens em paralelo (o navegador já limita a ~6 conexões/host)
 *  • IntersectionObserver lazy-load + retry via wsrv.nl quando a TV não negocia TLS moderno
 *  • Em falha definitiva, mostra placeholder rico em vez de sumir com o card
 */
var Renderer = (function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────────── */
  var IMGMAX          = 4;
  var IMG_DELAY       = 100;    /* ms entre tentativas de processar fila */
  var IMG_TIMEOUT     = 10000;  /* 10s — evita 1 imagem travar toda a fila */
  var IMG_RETRY_DELAY = 800;    /* ms antes do retry via proxy wsrv.nl */

  /* ── FILA DE IMAGENS ───────────────────────────────────── */
  var imgQueue      = [];
  var imgLoading    = 0;
  var imgTimer      = null;
  var globalObserver = null;
  var imgTimeouts   = {};
  var imgIdCounter  = 0;

  function _getObserver() {
    if (globalObserver) return globalObserver;
    if (!('IntersectionObserver' in window)) return null;
    try {
      globalObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          try { globalObserver.unobserve(entries[i].target); } catch (e) {}
          var el2 = entries[i].target;
          var s = el2.getAttribute('data-src');
          if (s && el2.getAttribute('data-loaded') !== '1') {
            imgQueue.push({ el: el2, src: s, retry: 0 });
            _scheduleProcess();
          }
        }
      }, { rootMargin: '150px 0px', threshold: 0 });
    } catch (e) {
      globalObserver = null;
      return null;
    }
    return globalObserver;
  }

  function _scheduleProcess() {
    if (imgTimer) return;
    imgTimer = setTimeout(function () {
      imgTimer = null;
      _processQueue();
    }, IMG_DELAY);
  }

  function _processQueue() {
    while (imgLoading < IMGMAX && imgQueue.length > 0) {
      var entry = imgQueue.shift();
      if (!entry.el || !entry.el.parentNode) continue;
      if (entry.el.getAttribute('data-loaded') === '1') continue;
      imgLoading++;
      _loadOne(entry.el, entry.src, entry.retry || 0);
    }
  }

  /*
   * Carrega via new Image() para isolar do <img> da página.
   * Em retry, troca pelo proxy wsrv.nl — TVs antigas (Panasonic Viera,
   * LG NetCast) falham em servidores com TLS moderno, e o wsrv.nl
   * serve sobre HTTP. Em falha final, troca o <img> por placeholder rico.
   */
  function _loadOne(imgEl, src, retryCount) {
    if (!src) { _replaceWithPlaceholder(imgEl); _finish(); return; }

    var _imgId = ++imgIdCounter;
    var _done = false;
    var actualSrc = String(src).trim();

    if (retryCount >= 1) {
      actualSrc = 'http://wsrv.nl/?url=' + encodeURIComponent(actualSrc);
    }

    var _tmp = new Image();

    function finish(success) {
      if (_done) return;
      _done = true;
      if (imgTimeouts[_imgId]) { clearTimeout(imgTimeouts[_imgId]); delete imgTimeouts[_imgId]; }
      _tmp.onload = _tmp.onerror = null;
      imgLoading = Math.max(0, imgLoading - 1);

      if (success && imgEl && imgEl.parentNode) {
        imgEl.src = actualSrc;
        imgEl.setAttribute('data-loaded', '1');
        imgEl.style.display = '';
      } else if (retryCount < 1 && imgEl && imgEl.parentNode) {
        setTimeout(function () {
          if (!imgEl.parentNode) return;
          imgQueue.push({ el: imgEl, src: src, retry: retryCount + 1 });
          _scheduleProcess();
        }, IMG_RETRY_DELAY);
      } else {
        _replaceWithPlaceholder(imgEl);
      }
      _scheduleProcess();
    }

    function _finish() { finish(false); }

    _tmp.onload = function () { finish(true); };
    _tmp.onerror = function () { finish(false); };

    imgTimeouts[_imgId] = setTimeout(function () {
      if (_done) return;
      try { _tmp.src = ''; } catch (e) {}
      finish(false);
    }, IMG_TIMEOUT);

    _tmp.src = actualSrc;
  }

  /**
   * Substitui <img> quebrada por placeholder visual.
   * Em vez de sumir, mostra ícone + nome — card continua focável.
   */
  function _replaceWithPlaceholder(imgEl) {
    if (!imgEl || !imgEl.parentNode) return;
    var card = imgEl.parentNode;
    var name = imgEl.getAttribute('alt') || '';
    var type = 'movie';
    if (card.className && card.className.indexOf('card-live') !== -1) type = 'live';
    else if (card.className && card.className.indexOf('card-series') !== -1) type = 'series';
    var ph = createPlaceholder(type, name);
    try { card.replaceChild(ph, imgEl); } catch (e) {
      imgEl.style.display = 'none';
    }
  }

  function lazyLoadImg(imgEl, src) {
    if (!imgEl || !src) return;
    imgEl.setAttribute('data-src', src);
    var obs = _getObserver();
    if (obs) {
      obs.observe(imgEl);
    } else {
      /* Sem IntersectionObserver — enfileira direto */
      imgQueue.push({ el: imgEl, src: src, retry: 0 });
      _scheduleProcess();
    }
  }

  /* ── CARD ──────────────────────────────────────────────── */
  function createCard(item, options) {
    options = options || {};
    var id   = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var name = item.name || 'Sem nome';
    var type = item._type || item.type || 'live';
    /* Infere tipo se não veio */
    if (type === 'live' && !item._type && !item.type) {
      if (item.series_id) type = 'series';
      else if (item.vod_id) type = 'movie';
    }
    var icon = item.stream_icon || item.cover || item.series_cover || '';

    var card = _el('div', {
      className: 'card card-' + type,
      role:      'listitem',
      tabIndex:  0,
      'aria-label': name
    });

    /* Thumb */
    if (icon) {
      var img = _el('img', { className: 'card-thumb', alt: name });
      lazyLoadImg(img, icon);
      card.appendChild(img);
    } else {
      var ph = _el('div', { className: 'card-thumb card-thumb-empty', textContent: _typeLabel(type) });
      card.appendChild(ph);
    }

    /* Badge tipo (live ou misturados como favoritos) */
    if (type === 'live') {
      card.appendChild(_el('span', { className: 'card-badge card-badge-live', textContent: 'AO VIVO' }));
    } else if (options.showTypeBadge) {
      card.appendChild(_el('span', {
        className: 'card-badge card-badge-' + type,
        textContent: type === 'movie' ? 'FILME' : 'SÉRIE'
      }));
    }

    /* Progresso (VOD) */
    if (type !== 'live' && typeof Storage !== 'undefined') {
      var prog = Storage.getProgress(id);
      if (prog && prog.pct > 1) {
        var bar  = _el('div', { className: 'card-progress' });
        var fill = _el('div', { className: 'card-progress-fill' });
        fill.style.width = Math.min(100, prog.pct) + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
      }
    }

    /* Remover (watchlist) */
    var rmBtn = null;
    if (options.onRemove) {
      rmBtn = _el('button', {
        className: 'card-remove',
        textContent: '×',
        'aria-label': 'Remover',
        type: 'button'
      });
      rmBtn.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        options.onRemove(item);
      });
      card.appendChild(rmBtn);
    }

    /* Título */
    var title = _el('div', { className: 'card-title', textContent: name });
    card.appendChild(title);

    /* Eventos */
    card.addEventListener('click', function (e) {
      if (rmBtn && rmBtn.contains(e.target)) return;
      if (options.onPlay) options.onPlay(item);
    });

    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault();
        if (options.onPlay) options.onPlay(item);
      }
    });

    return card;
  }

  function _typeLabel(type) {
    if (type === 'live') return 'TV';
    if (type === 'movie') return 'FILME';
    if (type === 'series') return 'SÉRIE';
    return '▶';
  }

  function createPlaceholder(type, name) {
    return _el('div', { className: 'card-thumb card-thumb-empty', textContent: _typeLabel(type) });
  }

  /* ── RENDER GRID (uso direto, sem Pager) ───────────────── */
  function renderGrid(container, items, options, append) {
    if (!container || !items) return;
    if (!append) container.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      frag.appendChild(createCard(items[i], options));
    }
    container.appendChild(frag);
  }

  /* ── PAGER (rolagem progressiva + trim de DOM) ─────────── */
  var Pager = (function () {
    var CHUNK   = 8;
    var DOM_MAX = 80;
    var MARGIN  = 400;

    var _grid     = null;
    var _items    = [];
    var _opts     = {};
    var _rStart   = 0;
    var _rEnd     = 0;
    var _busy     = false;
    var _tok      = 0;
    var _spacer   = null;
    var _sentinel = null;
    var _scrollEl = null;
    var _io       = null;
    var _scrollFn = null;
    var _spacerH  = 0;

    function init(grid, opts) {
      destroy();
      if (!grid) return;
      _grid    = grid;
      _opts    = opts || {};
      _items   = [];
      _rStart  = 0;
      _rEnd    = 0;
      _spacerH = 0;
      _tok++;

      while (_grid.firstChild) _grid.removeChild(_grid.firstChild);

      _spacer = document.createElement('div');
      _spacer.className = 'pager-spacer';
      _spacer.style.height = '0';
      _grid.appendChild(_spacer);

      _sentinel = document.createElement('div');
      _sentinel.className = 'pager-sentinel';
      _grid.appendChild(_sentinel);

      _scrollEl = _findScrollParent(_grid);

      if (typeof IntersectionObserver !== 'undefined') {
        try {
          _io = new IntersectionObserver(function (entries) {
            if (entries[0] && entries[0].isIntersecting) _scheduleChunk();
          }, { root: _scrollEl || null, rootMargin: MARGIN + 'px 0px', threshold: 0 });
          _io.observe(_sentinel);
        } catch (e) {
          _io = null;
          _setupScrollFallback();
        }
      } else {
        _setupScrollFallback();
      }
    }

    function append(newItems) {
      if (!_grid || !newItems || !newItems.length) return;
      for (var i = 0; i < newItems.length; i++) _items.push(newItems[i]);
      if (_rEnd < CHUNK * 2 && _items.length > _rEnd) _scheduleChunk();
    }

    function destroy() {
      _tok++;
      if (_io) { try { _io.disconnect(); } catch (e) {} _io = null; }
      if (_scrollFn && _scrollEl) {
        try { _scrollEl.removeEventListener('scroll', _scrollFn, false); } catch (e) {}
      }
      _scrollFn = null;
      _grid     = null;
      _items    = [];
      _sentinel = null;
      _spacer   = null;
      _busy     = false;
      _scrollEl = null;
    }

    function _setupScrollFallback() {
      var target = _scrollEl || window;
      if (!target) return;
      _scrollFn = _throttle(function () {
        var st, ch, sh;
        if (_scrollEl) {
          st = _scrollEl.scrollTop;
          ch = _scrollEl.clientHeight;
          sh = _scrollEl.scrollHeight;
        } else {
          var d = document.documentElement;
          st = d.scrollTop || document.body.scrollTop || 0;
          ch = window.innerHeight || d.clientHeight || 0;
          sh = d.scrollHeight || document.body.scrollHeight || 0;
        }
        if ((sh - st - ch) < MARGIN) _scheduleChunk();
      }, 250);
      target.addEventListener('scroll', _scrollFn, false);
    }

    function _scheduleChunk() {
      if (_busy || !_grid || _rEnd >= _items.length) return;
      _busy = true;
      var tok = _tok;
      setTimeout(function () {
        if (tok !== _tok || !_grid) { _busy = false; return; }
        _renderNext();
        _busy = false;
        if (!_io && _scrollEl && _rEnd < _items.length) {
          var dist = _scrollEl.scrollHeight - _scrollEl.scrollTop - _scrollEl.clientHeight;
          if (dist < MARGIN) _scheduleChunk();
        }
      }, 0);
    }

    function _renderNext() {
      if (!_grid || _rEnd >= _items.length) return;
      var end = Math.min(_rEnd + CHUNK, _items.length);

      if (_sentinel && _sentinel.parentNode === _grid) _grid.removeChild(_sentinel);

      var frag = document.createDocumentFragment();
      for (var i = _rEnd; i < end; i++) {
        frag.appendChild(createCard(_items[i], _opts));
      }
      _grid.appendChild(frag);
      _rEnd = end;

      _trimDOM();

      if (_sentinel) _grid.appendChild(_sentinel);
    }

    function _trimDOM() {
      var inDom = _rEnd - _rStart;
      if (inDom <= DOM_MAX) return;
      var toRemove = inDom - DOM_MAX;

      /* Estima altura média do card pra ajustar o spacer */
      var cardH = 0;
      var node = _spacer ? _spacer.nextSibling : null;
      while (node && node !== _sentinel) {
        if (node.nodeType === 1 && node.className && node.className.indexOf('card') === 0) {
          cardH = node.offsetHeight || cardH;
          break;
        }
        node = node.nextSibling;
      }
      if (!cardH) cardH = 220;

      /* Estima colunas pelo CSS grid */
      var cols  = 4;
      try {
        var gw = _grid.clientWidth || 800;
        cols = Math.max(1, Math.floor(gw / 200));
      } catch (e) {}

      var rows  = Math.ceil(toRemove / cols);
      var addH  = rows * (cardH + 14);

      /* Remove os primeiros `toRemove` cards */
      var cur = _spacer ? _spacer.nextSibling : null;
      var removed = 0;
      var buf = [];
      while (cur && removed < toRemove) {
        var nxt = cur.nextSibling;
        if (cur !== _sentinel && cur !== _spacer) {
          buf.push(cur);
          removed++;
        }
        cur = nxt;
      }
      for (var i = 0; i < buf.length; i++) _grid.removeChild(buf[i]);
      _rStart += removed;
      _spacerH += addH;
      if (_spacer) _spacer.style.height = _spacerH + 'px';
    }

    function _findScrollParent(el) {
      var node = el ? el.parentNode : null;
      while (node && node !== document.body && node !== document.documentElement) {
        try {
          var s = window.getComputedStyle(node);
          var ov = s.overflowY || s.overflow || '';
          if (ov === 'auto' || ov === 'scroll') return node;
        } catch (e) {}
        node = node.parentNode;
      }
      return null;
    }

    function _throttle(fn, ms) {
      var last = 0, timer = null;
      return function () {
        var now = Date.now();
        var rem = ms - (now - last);
        if (rem <= 0) {
          last = now;
          try { fn(); } catch (e) {}
        } else if (!timer) {
          timer = setTimeout(function () {
            last = Date.now(); timer = null;
            try { fn(); } catch (e) {}
          }, rem);
        }
      };
    }

    return { init: init, append: append, destroy: destroy };
  })();

  /* ── TOAST ─────────────────────────────────────────────── */
  function showToast(message, type, duration) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = _el('div', { className: 'toast toast-' + (type || 'info'), textContent: message });
    container.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration || 2500);
  }

  /* ── ESTADOS ───────────────────────────────────────────── */
  function setLoading(show) {
    var el = document.getElementById('content-loading');
    var grid = document.getElementById('content-grid');
    if (!el || !grid) return;
    if (show) { el.classList.remove('hidden'); grid.style.display = 'none'; }
    else      { el.classList.add('hidden');    grid.style.display = ''; }
  }

  function setEmpty(show) {
    var el = document.getElementById('content-empty');
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else      el.classList.add('hidden');
  }

  function destroyVirtualScroll() {
    Pager.destroy();
    /* Para de observar imagens pendentes pra não disparar carregamento de
       categoria antiga ao rolar a nova. */
    if (globalObserver) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) {
        try { globalObserver.unobserve(imgs[i]); } catch (e) {}
      }
    }
    for (var tid in imgTimeouts) {
      if (imgTimeouts.hasOwnProperty(tid)) clearTimeout(imgTimeouts[tid]);
    }
    imgTimeouts = {};
    imgQueue    = [];
    imgLoading  = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }
  }

  /* ── HELPERS ───────────────────────────────────────────── */
  function _el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if      (k === 'textContent') node.textContent = attrs[k];
        else if (k === 'className')   node.className   = attrs[k];
        /* tabIndex precisa virar property direta — TVs antigas não normalizam o atributo */
        else if (k === 'tabIndex' || k === 'tabindex') node.tabIndex = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  return {
    createCard:           createCard,
    createPlaceholder:    createPlaceholder,
    renderGrid:           renderGrid,
    showToast:            showToast,
    setLoading:           setLoading,
    setEmpty:             setEmpty,
    el:                   _el,
    lazyLoadImg:          lazyLoadImg,
    destroyVirtualScroll: destroyVirtualScroll,
    Pager:                Pager
  };
})();
