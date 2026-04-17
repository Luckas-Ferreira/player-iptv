/**
 * StreamTV renderer.js — Chunked Append v9 (TV-SAFE)
 *
 * Estratégia: sem virtual scroll, sem listeners de scroll.
 * Renderiza cards em pequenos lotes com setTimeout, mantendo
 * a UI responsiva mesmo em TVs antigas com pouca RAM.
 */

var Renderer = (function () {
  'use strict';

  var CHUNK_SIZE = 24;   // cards por lote
  var CHUNK_DELAY = 1000;  // ms entre lotes (dá tempo à TV respirar)
  var IMG_MAX = 1;    // imagens carregando ao mesmo tempo
  var IMG_DELAY = 200;  // ms entre despachos de imagem

  /* ── ESTADO ── */
  var _chunkTimer = null;
  var _chunkItems = [];
  var _chunkIndex = 0;
  var _chunkGrid = null;
  var _chunkOptions = null;
  var _chunkToken = 0;    // cancela lote anterior se nova lista chegar

  /* ── FILA DE IMAGENS ── */
  var imgQueue = [], imgLoading = 0, imgTimer = null, observer = null;

  function _getObserver() {
    if (observer) return observer;
    if (!('IntersectionObserver' in window)) return null;
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var img = entries[i].target;
        observer.unobserve(img);
        var src = img.getAttribute('data-src');
        if (src && img.getAttribute('data-loaded') !== '1') {
          imgQueue.push({ el: img, src: src });
          _scheduleImg();
        }
      }
    }, { rootMargin: '600px 0px', threshold: 0 });
    return observer;
  }

  function _scheduleImg() {
    if (imgTimer) return;
    imgTimer = setTimeout(function () { imgTimer = null; _processImgQueue(); }, IMG_DELAY);
  }

  function _processImgQueue() {
    while (imgLoading < IMG_MAX && imgQueue.length > 0) {
      var entry = imgQueue.shift();
      if (!entry.el || !entry.el.parentNode) continue;
      if (entry.el.getAttribute('data-loaded') === '1') continue;
      imgLoading++;
      (function (imgEl, src) {
        imgEl.onload = function () {
          imgEl.onload = imgEl.onerror = null;
          imgEl.setAttribute('data-loaded', '1');
          imgLoading = Math.max(0, imgLoading - 1);
          _scheduleImg();
        };
        imgEl.onerror = function () {
          imgEl.onload = imgEl.onerror = null;
          imgLoading = Math.max(0, imgLoading - 1);
          imgEl.style.display = 'none';
          _scheduleImg();
        };
        imgEl.src = src;
      })(entry.el, entry.src);
    }
  }

  function lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    var obs = _getObserver();
    if (obs) obs.observe(imgEl);
    else { imgQueue.push({ el: imgEl, src: src }); _scheduleImg(); }
  }

  /* ── HELPERS ── */
  function _el(tag, attrs) {
    var node = document.createElement(tag);
    if (!attrs) return node;
    for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      if (k === 'textContent') node.textContent = attrs[k];
      else if (k === 'innerHTML') node.innerHTML = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  /* ── CARD ── */
  function createCard(item, options) {
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var name = item.name || 'Sem Nome';
    var type = item.type || 'live';
    var category = item.category_name || item.group || '';
    var icon = item.stream_icon || item.cover || item.series_cover || '';
    var portrait = (type === 'movie' || type === 'series');
    var isFav = (typeof Storage !== 'undefined') ? Storage.isFavorite(id) : false;

    var card = _el('div', { className: 'card', role: 'listitem', tabindex: '0', 'aria-label': name });

    if (icon) {
      var thumb = _el('img', {
        className: 'card-thumb' + (portrait ? ' portrait' : ''),
        alt: name, loading: 'lazy'
      });
      lazyLoadImg(thumb, icon);
      card.appendChild(thumb);
    } else {
      card.appendChild(_mkPlaceholder(type, name, portrait));
    }

    if (type === 'live') {
      card.appendChild(_el('div', { className: 'card-live-badge', textContent: 'AO VIVO' }));
    }

    var favBtn = _el('div', {
      className: 'card-fav' + (isFav ? ' is-fav' : ''),
      textContent: isFav ? '\u2605' : '\u2606'
    });
    card.appendChild(favBtn);

    if (type !== 'live' && typeof Storage !== 'undefined') {
      var prog = Storage.getProgress(id);
      if (prog && prog.pct > 1) {
        var pBar = _el('div', { className: 'card-progress' });
        var pFill = _el('div', { className: 'card-progress-fill' });
        pFill.style.width = Math.min(100, prog.pct) + '%';
        pBar.appendChild(pFill);
        card.appendChild(pBar);
      }
    }

    if (options && options.onRemove) {
      var rm = _el('div', { className: 'card-remove', innerHTML: '&times;', title: 'Remover' });
      rm.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault(); options.onRemove(item);
      });
      card.appendChild(rm);
    }

    var body = _el('div', { className: 'card-body' });
    body.appendChild(_el('p', { className: 'card-title', textContent: name }));
    body.appendChild(_el('p', { className: 'card-category', textContent: category }));
    card.appendChild(body);

    /* Long-press favoritar */
    var lpTimer = null, lpRaf = null, lpStart = 0, ignorePlay = false, keyDown = false;

    function cancelLP() {
      clearTimeout(lpTimer); cancelAnimationFrame(lpRaf);
      lpTimer = null;
      card.classList.remove('lp-active');
      card.style.removeProperty('--lp-pct');
    }
    function tickLP() {
      if (!lpTimer) return;
      var pct = Math.min(100, (Date.now() - lpStart) / 3000 * 100);
      card.style.setProperty('--lp-pct', pct + '%');
      if (pct < 100) lpRaf = requestAnimationFrame(tickLP);
    }
    function doFav() {
      var nf = Storage.toggleFavorite(item);
      favBtn.textContent = nf ? '\u2605' : '\u2606';
      favBtn.className = 'card-fav' + (nf ? ' is-fav' : '');
      if (options && options.onFavorite) options.onFavorite(item, nf);
      Renderer.showToast(
        nf ? 'Adicionado aos favoritos' : 'Removido dos favoritos',
        nf ? 'success' : 'info'
      );
    }

    card.addEventListener('click', function (e) {
      if (favBtn.contains(e.target)) return;
      if (e.target.classList && e.target.classList.contains('card-remove')) return;
      if (ignorePlay) return;
      if (options && options.onPlay) options.onPlay(item);
    });
    card.addEventListener('keydown', function (e) {
      if (e.keyCode !== 13 && e.keyCode !== 32 && e.keyCode !== 195) return;
      e.preventDefault();
      if (keyDown) return;
      keyDown = true; ignorePlay = false;
      lpStart = Date.now();
      card.classList.add('lp-active');
      lpRaf = requestAnimationFrame(tickLP);
      lpTimer = setTimeout(function () {
        lpTimer = null; ignorePlay = true; cancelLP(); doFav();
        setTimeout(function () { ignorePlay = false; }, 500);
      }, 3000);
    });
    card.addEventListener('keyup', function (e) {
      if (e.keyCode !== 13 && e.keyCode !== 32 && e.keyCode !== 195) return;
      e.preventDefault();
      keyDown = false;
      if (lpTimer) { cancelLP(); return; }
      if (!ignorePlay && options && options.onPlay) options.onPlay(item);
    });
    card.addEventListener('blur', function () { keyDown = false; cancelLP(); });
    favBtn.addEventListener('click', function (e) { e.stopPropagation(); doFav(); });

    return card;
  }

  function _mkPlaceholder(type, name, portrait) {
    var icons = { live: '\uD83D\uDCFA', movie: '\uD83C\uDFAC', series: '\uD83C\uDF9E' };
    var div = _el('div', { className: 'card-placeholder' + (portrait ? ' portrait' : '') });
    div.appendChild(_el('div', { className: 'card-placeholder-icon', textContent: icons[type] || '\u25B6' }));
    div.appendChild(_el('div', {
      className: 'card-placeholder-text',
      textContent: name.length > 24 ? name.substring(0, 24) + '\u2026' : name
    }));
    return div;
  }

  /* ── CHUNKED APPEND ── */

  function _cancelChunks() {
    if (_chunkTimer) { clearTimeout(_chunkTimer); _chunkTimer = null; }
    _chunkToken++;   // invalida qualquer lote em voo
    _chunkItems = [];
    _chunkIndex = 0;
    _chunkGrid = null;
    _chunkOptions = null;
  }

  function _appendChunk(token) {
    // Token diferente = nova lista chegou, para tudo
    if (token !== _chunkToken) return;
    if (!_chunkGrid || _chunkIndex >= _chunkItems.length) return;

    var end = Math.min(_chunkIndex + CHUNK_SIZE, _chunkItems.length);
    var frag = document.createDocumentFragment();
    for (var i = _chunkIndex; i < end; i++) {
      frag.appendChild(createCard(_chunkItems[i], _chunkOptions));
    }
    _chunkGrid.appendChild(frag);
    _chunkIndex = end;

    if (_chunkIndex < _chunkItems.length) {
      _chunkTimer = setTimeout(function () { _appendChunk(token); }, CHUNK_DELAY);
    }
  }

  /* ── API PÚBLICA: renderGrid ── */

  function renderGrid(container, items, options, append) {
    if (!container || !items || !items.length) return;

    if (append && _chunkGrid === container && _chunkItems.length > 0) {
      // Streaming progressivo: acrescenta itens à lista e continua o timer
      var prevLen = _chunkItems.length;
      _chunkItems = _chunkItems.concat(items);

      // Se o timer já acabou (todos renderizados), inicia novo lote
      if (_chunkIndex >= prevLen && !_chunkTimer) {
        _chunkToken++;
        var token = _chunkToken;
        _chunkTimer = setTimeout(function () { _appendChunk(token); }, CHUNK_DELAY);
      }
    } else {
      // Nova lista: cancela lotes anteriores e começa do zero
      _cancelChunks();

      container.innerHTML = '';
      _chunkGrid = container;
      _chunkItems = items.slice(); // cópia para não mutar o array original
      _chunkOptions = options;
      _chunkIndex = 0;
      _chunkToken++;

      var tk = _chunkToken;

      // Primeiro lote: síncrono para aparecer imediatamente
      var firstEnd = Math.min(CHUNK_SIZE, _chunkItems.length);
      var frag = document.createDocumentFragment();
      for (var i = 0; i < firstEnd; i++) {
        frag.appendChild(createCard(_chunkItems[i], _chunkOptions));
      }
      container.appendChild(frag);
      _chunkIndex = firstEnd;

      // Lotes seguintes: assíncronos
      if (_chunkIndex < _chunkItems.length) {
        _chunkTimer = setTimeout(function () { _appendChunk(tk); }, CHUNK_DELAY);
      }
    }
  }

  /* ── destroyVirtualScroll: chamado pelo app.js ao trocar de aba ── */
  function destroyVirtualScroll() {
    _cancelChunks();

    // Limpa fila de imagens
    if (observer) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) observer.unobserve(imgs[i]);
    }
    imgQueue = []; imgLoading = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }
  }

  /* ── ESTADOS DE UI ── */
  function setLoading(show) {
    var l = document.getElementById('content-loading');
    var g = document.getElementById('content-grid');
    if (!l || !g) return;
    if (show) { l.classList.remove('hidden'); g.style.display = 'none'; }
    else { l.classList.add('hidden'); g.style.display = ''; }
  }

  function setEmpty(show) {
    var e = document.getElementById('content-empty');
    if (!e) return;
    if (show) e.classList.remove('hidden'); else e.classList.add('hidden');
  }

  function setLoadingMore(show) {
    var lm = document.getElementById('loading-more');
    if (!lm) {
      lm = _el('div', {
        id: 'loading-more',
        style: 'text-align:center;padding:16px;color:var(--text-3,#aaa);font-size:14px'
      });
      lm.textContent = 'Carregando mais\u2026';
      var g = document.getElementById('content-grid');
      if (g && g.parentNode) g.parentNode.insertBefore(lm, g.nextSibling);
    }
    lm.style.display = show ? 'block' : 'none';
  }

  function showToast(message, type, duration) {
    var c = document.getElementById('toast-container');
    if (!c) return;
    var t = _el('div', { className: 'toast toast-' + (type || 'info'), textContent: message });
    c.appendChild(t);
    setTimeout(function () {
      t.classList.add('removing');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, duration || 3000);
  }

  return {
    createCard: createCard,
    renderGrid: renderGrid,
    showToast: showToast,
    setLoading: setLoading,
    setEmpty: setEmpty,
    setLoadingMore: setLoadingMore,
    lazyLoadImg: lazyLoadImg,
    destroyVirtualScroll: destroyVirtualScroll,
    el: _el
  };

})();