/**
 * renderer.js — Cards, Pager (rolagem progressiva) e lazy-load de imagens
 *
 * OTIMIZAÇÕES PARA TV ANTIGA:
 *  • Pager: máx 80 cards no DOM ao mesmo tempo (com spacer compensando os removidos)
 *  • CHUNK 8: 8 cards por render — TV antiga não trava processando 30 nós de uma vez
 *  • IMGMAX 4: até 4 imagens em paralelo (o navegador já limita a ~6 conexões/host;
 *    com 1, a grade de filmes/séries demorava minutos para preencher)
 *  • Sem retry com proxy de imagem (causava avalanche de conexões)
 *  • Sem long-press (favorito via tela de detalhe / botão visível no card)
 *  • Cards mantêm referência mínima ao item (closures menores)
 */
var Renderer = (function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────────── */
  var IMGMAX       = 4;
  var IMG_DELAY    = 0;
  var IMG_TIMEOUT  = 15000;   /* TV antiga + rede ruim: timeout maior */
  var IMG_RETRY_MS = 1200;    /* 1 retry após esse delay quando falhar */

  /* ── FILA DE IMAGENS ───────────────────────────────────── */
  var imgQueue    = [];
  var imgLoading  = 0;
  var imgTimer    = null;
  /* IntersectionObserver foi removido — em várias TVs antigas o
     objeto existe mas o callback nunca dispara, resultando em
     imagens que nunca carregam. A fila simples carrega tudo
     assim que o card é adicionado ao DOM, com no máximo IMGMAX
     em paralelo, o que já é suficiente pra não sobrecarregar. */

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
      _loadOne(entry.el, entry.src);
    }
  }

  /*
   * Carrega direto no <img> da página (sem new Image() de preload).
   * O preload duplicava a request — em rede de TV antiga isso dobrava
   * a chance de falha por timeout/conexão lenta. Carregando direto:
   *  • 1 request só
   *  • browser usa cache nativo se a mesma URL já foi puxada
   *  • em falha, retry 1x depois de IMG_RETRY_MS antes de desistir
   *  • em falha final, NÃO esconde — deixa o fundo placeholder visível
   */
  function _loadOne(imgEl, src) {
    var done  = false;
    var tried = 0;

    function attempt() {
      tried++;
      if (!imgEl || !imgEl.parentNode) { _finish(false); return; }

      var localTimer = setTimeout(function () { onErr(); }, IMG_TIMEOUT);

      function clear() {
        clearTimeout(localTimer);
        imgEl.onload = null;
        imgEl.onerror = null;
      }
      function onOk() {
        if (done) return;
        clear();
        imgEl.setAttribute('data-loaded', '1');
        _finish(true);
      }
      function onErr() {
        if (done) return;
        clear();
        if (tried < 2) {
          /* limpa o src pra não deixar o ícone broken-image e tenta de novo */
          try { imgEl.removeAttribute('src'); } catch (e) {}
          setTimeout(attempt, IMG_RETRY_MS);
        } else {
          /* desiste — remove src pra não mostrar broken-image, mas
             mantém o elemento visível (fundo placeholder bg-raised) */
          try { imgEl.removeAttribute('src'); } catch (e) {}
          _finish(false);
        }
      }

      imgEl.onload  = onOk;
      imgEl.onerror = onErr;
      imgEl.src = src;
    }

    function _finish() {
      if (done) return;
      done = true;
      imgLoading = Math.max(0, imgLoading - 1);
      _scheduleProcess();
    }

    attempt();
  }

  function lazyLoadImg(imgEl, src) {
    if (!imgEl || !src) return;
    imgEl.setAttribute('data-src', src);
    imgQueue.push({ el: imgEl, src: src });
    _scheduleProcess();
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
    imgQueue   = [];
    imgLoading = 0;
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
