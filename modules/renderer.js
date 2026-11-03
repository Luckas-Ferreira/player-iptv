/**
 * renderer.js — Cards, paginação e lazy-load de imagens
 *
 * OTIMIZAÇÕES PARA TV ANTIGA:
 *  • Pager: 12 cards por página, sem descartar títulos ao voltar
 *  • IMGMAX 2: até 2 imagens em paralelo
 *  • IntersectionObserver lazy-load + retry via wsrv.nl quando a TV não negocia TLS moderno
 *  • Em falha definitiva, mostra placeholder rico em vez de sumir com o card
 */
var Renderer = (function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────────── */
  var IMGMAX          = 2;
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
  var imgRequests   = {};
  var imgGeneration = 0;

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
      if (!entry.el || !document.documentElement.contains(entry.el)) continue;
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
    var generation = imgGeneration;
    var actualSrc = String(src).trim();

    if (retryCount >= 1) {
      actualSrc = 'http://wsrv.nl/?url=' + encodeURIComponent(actualSrc);
    }

    var _tmp = new Image();
    imgRequests[_imgId] = _tmp;

    function finish(success) {
      if (_done || generation !== imgGeneration) return;
      _done = true;
      if (imgTimeouts[_imgId]) { clearTimeout(imgTimeouts[_imgId]); delete imgTimeouts[_imgId]; }
      _tmp.onload = _tmp.onerror = null;
      delete imgRequests[_imgId];
      imgLoading = Math.max(0, imgLoading - 1);

      if (success && imgEl && document.documentElement.contains(imgEl)) {
        imgEl.src = actualSrc;
        imgEl.setAttribute('data-loaded', '1');
        imgEl.style.display = '';
      } else if (retryCount < 1 && imgEl && document.documentElement.contains(imgEl)) {
        setTimeout(function () {
          if (generation !== imgGeneration || !document.documentElement.contains(imgEl)) return;
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
      var img = _el('img', { className: 'card-thumb', alt: name, decoding: 'async' });
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
      if (e.target !== card) return;
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

  /* ── PAGER ────────────────────────────────────────────── */
  var Pager = (function () {
    var PAGE_SIZE = 12;
    var _grid = null;
    var _items = [];
    var _opts = {};
    var _page = 0;
    var _shown = 0;

    function init(grid, opts) {
      destroy();
      if (!grid) return;
      _grid = grid;
      _opts = opts || {};
      _grid.innerHTML = '';
      var previous = document.getElementById('catalogue-prev');
      var next = document.getElementById('catalogue-next');
      if (previous) previous.onclick = function () { _changePage(-1); };
      if (next) next.onclick = function () { _changePage(1); };
      _updateControls();
    }

    function append(items) {
      if (!_grid || !items || !items.length) return;
      for (var index = 0; index < items.length; index++) _items.push(items[index]);
      if (_shown < Math.min(PAGE_SIZE, _items.length - _page * PAGE_SIZE)) _render(false);
      else _updateControls();
    }

    function _changePage(direction) {
      var page = _page + direction;
      if (!_grid || page < 0 || page * PAGE_SIZE >= _items.length) return;
      _page = page;
      _render(true);
    }

    function _render(focus) {
      if (focus) {
        _resetImages();
        _grid.innerHTML = '';
        _shown = 0;
      }
      var fragment = document.createDocumentFragment();
      var start = _page * PAGE_SIZE;
      var end = Math.min(start + PAGE_SIZE, _items.length);
      for (var index = start + _shown; index < end; index++) {
        fragment.appendChild(createCard(_items[index], _opts));
      }
      _grid.appendChild(fragment);
      _shown = end - start;
      _updateControls();
      if (focus) {
        var body = document.getElementById('content-body');
        if (body) body.scrollTop = 0;
        var first = _grid.querySelector('.card');
        if (first) first.focus();
      }
    }

    function _updateControls() {
      var previous = document.getElementById('catalogue-prev');
      var next = document.getElementById('catalogue-next');
      var label = document.getElementById('catalogue-page');
      if (previous) previous.disabled = _page === 0;
      if (next) next.disabled = (_page + 1) * PAGE_SIZE >= _items.length;
      if (label) label.textContent = 'Página ' + (_page + 1) + ' de ' + Math.max(1, Math.ceil(_items.length / PAGE_SIZE));
    }

    function destroy() {
      _resetImages();
      _grid = null;
      _items = [];
      _opts = {};
      _page = 0;
      _shown = 0;
      var previous = document.getElementById('catalogue-prev');
      var next = document.getElementById('catalogue-next');
      if (previous) previous.onclick = null;
      if (next) next.onclick = null;
      _updateControls();
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
  }

  function _resetImages() {
    imgGeneration++;
    if (globalObserver) globalObserver.disconnect();
    for (var requestId in imgRequests) {
      if (!imgRequests.hasOwnProperty(requestId)) continue;
      imgRequests[requestId].onload = imgRequests[requestId].onerror = null;
      try { imgRequests[requestId].src = ''; } catch (e) {}
    }
    imgRequests = {};
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
