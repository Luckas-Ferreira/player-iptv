/**
 * renderer.js — StreamTV v5 (TV-OPTIMIZED, SEM VIRTUAL SCROLL)
 *
 * OTIMIZAÇÕES PARA SMART TV ANTIGA:
 * 1. Sem virtual scroll — renderiza por chunks via app.js (2s entre chunks)
 * 2. IMGMAX = 1 — apenas 1 imagem carrega por vez
 * 3. DocumentFragment para batch de DOM mutations
 * 4. IntersectionObserver para lazy load de imagens
 * 5. Cleanup de observer ao trocar de categoria
 */

var Renderer = (function () {
  'use strict';

  /* ─── CONFIGURAÇÃO ──────────────────────────────────────── */
  var IMGMAX = 1;
  var IMG_DELAY = 80;

  /* ─── FILA DE IMAGENS ───────────────────────────────────── */
  var imgQueue = [];
  var imgLoading = 0;
  var imgTimer = null;
  var globalObserver = null;

  function getObserver() {
    if (globalObserver) return globalObserver;
    if (!('IntersectionObserver' in window)) return null;
    globalObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        globalObserver.unobserve(entries[i].target);
        var el2 = entries[i].target;
        var s = el2.getAttribute('data-src');
        if (s && el2.getAttribute('data-loaded') !== '1') {
          imgQueue.push({ el: el2, src: s });
          scheduleProcess();
        }
      }
    }, { rootMargin: '400px 0px', threshold: 0 });
    return globalObserver;
  }

  function scheduleProcess() {
    if (imgTimer) return;
    imgTimer = setTimeout(function () { imgTimer = null; processImgQueue(); }, IMG_DELAY);
  }

  function processImgQueue() {
    while (imgLoading < IMGMAX && imgQueue.length > 0) {
      var entry = imgQueue.shift();
      var img = entry.el;
      if (!img || !img.parentNode) continue;
      if (img.getAttribute('data-loaded') === '1') continue;
      imgLoading++;
      loadImg(img, entry.src);
    }
  }

  function loadImg(imgEl, src) {
    imgEl.onload = function () {
      imgEl.onload = imgEl.onerror = null;
      imgLoading = Math.max(0, imgLoading - 1);
      imgEl.setAttribute('data-loaded', '1');
      scheduleProcess();
    };
    imgEl.onerror = function () {
      imgEl.onload = imgEl.onerror = null;
      imgLoading = Math.max(0, imgLoading - 1);
      imgEl.style.display = 'none';
      scheduleProcess();
    };
    imgEl.src = src;
  }

  function lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    var obs = getObserver();
    if (obs) {
      obs.observe(imgEl);
    } else {
      imgQueue.push({ el: imgEl, src: src });
      scheduleProcess();
    }
  }

  /* ─── CRIAÇÃO DE CARD ───────────────────────────────────── */
  function createCard(item, options) {
    var id = String(
      item.streamid || item.seriesid || item.vodid ||
      item.id || item.stream_id || item.series_id ||
      item.vod_id || ''
    );
    var name = item.name || 'Sem Nome';
    var type = item._type || item.type || 'live';

    if ((!item.type && !item._type) || type === 'live') {
      if (item.series_id || item.seriesid) type = 'series';
      else if (item.vod_id || item.vodid) type = 'movie';
    }

    var category = item.categoryname || item.group || '';
    var icon = item.stream_icon || item.streamicon || item.cover || item.seriescover || item.series_cover || '';
    var isPortrait = (type === 'movie' || type === 'series');
    var isFav = (typeof Storage !== 'undefined') ? Storage.isFavorite(id) : false;

    var showImages = (typeof Storage !== 'undefined') ? Storage.getSettings().showImages : true;

    var card = el('div', {
      className: 'card' + (!showImages ? ' compact' : ''),
      role: 'listitem',
      tabIndex: 0,
      'aria-label': name
    });

    // Imagem ou placeholder
    var thumb;
    if (showImages) {
      if (icon) {
        thumb = el('img', {
          className: 'card-thumb' + (isPortrait ? ' portrait' : ''),
          alt: name,
          width: isPortrait ? '120' : '160',
          height: isPortrait ? '180' : '90',
          loading: 'lazy'
        });
        lazyLoadImg(thumb, icon);
      } else {
        thumb = createPlaceholder(type, name, isPortrait);
      }
      card.appendChild(thumb);
    }

    // Badge AO VIVO
    if (type === 'live') {
      card.appendChild(el('div', { className: 'card-live-badge', textContent: 'AO VIVO' }));
    }

    // Favorito
    var favBtn = el('div', {
      className: 'card-fav' + (isFav ? ' is-fav' : ''),
      textContent: isFav ? '★' : '☆'
    });
    card.appendChild(favBtn);

    // Progresso
    if (type !== 'live') {
      var prog = (typeof Storage !== 'undefined') ? Storage.getProgress(id) : null;
      if (prog && prog.pct > 1) {
        var pBar = el('div', { className: 'card-progress' });
        var pFill = el('div', { className: 'card-progress-fill' });
        pFill.style.width = Math.min(100, prog.pct) + '%';
        pBar.appendChild(pFill);
        card.appendChild(pBar);
      }
    }

    // Botão remover (watchlist)
    if (options && options.onRemove) {
      var removeBtn = el('div', {
        className: 'card-remove',
        innerHTML: '&times;',
        title: 'Remover da fileira'
      });
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        options.onRemove(item);
      });
      card.appendChild(removeBtn);
    }

    // Corpo
    var body = el('div', { className: 'card-body' });
    var title = el('p', { className: 'card-title', textContent: name });
    var cat = el('p', { className: 'card-category', textContent: category });
    body.appendChild(title);
    body.appendChild(cat);
    card.appendChild(body);

    /* ── Interações ──────────────────────────────────────── */
    var lpTimer = null, lpStart = 0, lpRaf = null;
    var ignorePlay = false, isKeyDown = false;
    /* Flag para evitar dupla chamada click+keyup em TVs antigas */
    var _clickHandled = false;

    function cancelLP() {
      clearTimeout(lpTimer);
      cancelAnimationFrame(lpRaf);
      lpTimer = null;
      card.classList.remove('lp-active');
      card.style.removeProperty('--lp-pct');
    }
    function tickLP() {
      if (!lpTimer) return;
      var pct = Math.min(100, (Date.now() - lpStart) / 3000 * 100);
      card.style.setProperty('--lp-pct', pct);
      if (pct < 100) lpRaf = requestAnimationFrame(tickLP);
    }

    card.addEventListener('click', function (e) {
      if (favBtn.contains(e.target)) return;
      if (ignorePlay) return;
      _clickHandled = true;
      /* Reseta a flag após um frame para não bloquear clicks futuros */
      setTimeout(function () { _clickHandled = false; }, 100);
      if (options && options.onPlay) options.onPlay(item);
    });

    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault();
        /* NÃO usa stopPropagation — navigation.js também precisa receber para chamar .click() em TVs antigas */
        if (isKeyDown) return;
        isKeyDown = true; ignorePlay = false; _clickHandled = false;
        lpStart = Date.now();
        card.classList.add('lp-active');
        lpRaf = requestAnimationFrame(tickLP);
        lpTimer = setTimeout(function () {
          lpTimer = null; ignorePlay = true; cancelLP();
          var nowFav = Storage.toggleFavorite(item);
          favBtn.textContent = nowFav ? '★' : '☆';
          favBtn.className = 'card-fav' + (nowFav ? ' is-fav' : '');
          if (options && options.onFavorite) options.onFavorite(item, nowFav);
          Renderer.showToast(
            nowFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos',
            nowFav ? 'success' : 'info'
          );
          setTimeout(function () { ignorePlay = false; }, 500);
        }, 3000);
      }
    });

    card.addEventListener('keyup', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault();
        isKeyDown = false;
        if (lpTimer) { cancelLP(); }
        /* Só dispara onPlay pelo keyup se o click não já o fez (evita dupla chamada em TV antiga) */
        if (!ignorePlay && !_clickHandled && options && options.onPlay) options.onPlay(item);
        _clickHandled = false;
      }
    });

    card.addEventListener('blur', function () { isKeyDown = false; cancelLP(); });

    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nf = Storage.toggleFavorite(item);
      favBtn.textContent = nf ? '★' : '☆';
      favBtn.className = 'card-fav' + (nf ? ' is-fav' : '');
      if (options && options.onFavorite) options.onFavorite(item, nf);
    });

    return card;
  }

  function createPlaceholder(type, name, portrait) {
    var icons = { live: '📺', movie: '🎬', series: '🎥' };
    var div = el('div', { className: 'card-placeholder' + (portrait ? ' portrait' : '') });
    div.appendChild(el('div', { className: 'card-placeholder-icon', textContent: icons[type] || '▶' }));
    div.appendChild(el('div', { className: 'card-placeholder-text', textContent: truncate(name, 24) }));
    return div;
  }

  /* ─── RENDER GRID ───────────────────────────────────────── */

  /**
   * renderGrid — renderiza itens no container.
   * append=false → limpa e renderiza tudo.
   * append=true  → acrescenta cards ao final (streaming progressivo).
   */
  function renderGrid(container, items, options, append) {
    if (!container || !items || !items.length) return;

    if (!append) {
      container.innerHTML = '';
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      frag.appendChild(createCard(items[i], options));
    }
    container.appendChild(frag);
  }

  /* ─── DESTROY (compatibilidade com app.js) ──────────────── */
  function destroyVirtualScroll() {
    // Sem virtual scroll — apenas limpa fila de imagens e desobserva
    if (globalObserver) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) globalObserver.unobserve(imgs[i]);
    }
    imgQueue = [];
    imgLoading = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }
  }

  /* ─── CATEGORIAS ────────────────────────────────────────── */
  function renderCategoryFilter(container, categories, onSelect) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();
    var allBtn = el('button', { className: 'cat-btn active', textContent: 'Todos', tabIndex: 0 });
    allBtn.dataset.catId = '';
    frag.appendChild(allBtn);
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var cleanName = (cat.categoryname || '').replace(/[^\x20-\x7E\u00C0-\u024F]/g, '').trim();
      var btn = el('button', { className: 'cat-btn', textContent: cleanName, tabIndex: 0 });
      btn.dataset.catId = cat.categoryid;
      frag.appendChild(btn);
    }
    container.appendChild(frag);
    container.addEventListener('click', function (e) {
      if (!e.target.classList.contains('cat-btn')) return;
      var allBtns = container.querySelectorAll('.cat-btn');
      for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
      e.target.classList.add('active');
      if (onSelect) onSelect(e.target.dataset.catId);
    });
  }

  /* ─── BUSCA ─────────────────────────────────────────────── */
  function renderSearchResults(container, items, onPlay) {
    container.innerHTML = '';
    if (!items || !items.length) return;
    var frag = document.createDocumentFragment();
    var labels = { live: 'Ao Vivo', movie: 'Filme', series: 'Série' };
    var cls = { live: 'type-live', movie: 'type-movie', series: 'type-series' };
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var type = item.type || 'live';
        var icon = item.streamicon || item.cover || item.seriescover || '';
        var row = el('div', {
          className: 'search-result-item',
          role: 'listitem',
          tabIndex: 0,
          'aria-label': item.name
        });
        var thumb;
        if (icon) {
          thumb = el('img', { className: 'search-result-thumb', alt: item.name || '', loading: 'lazy' });
          lazyLoadImg(thumb, icon);
        } else {
          thumb = el('div', {
            className: 'search-result-thumb',
            style: 'display:flex;align-items:center;justify-content:center;font-size:28px;background:var(--bg-input);border-radius:8px'
          });
          thumb.textContent = type === 'live' ? '📺' : type === 'movie' ? '🎬' : '🎥';
        }
        var info = el('div', { className: 'search-result-info' });
        var titleEl = el('div', { className: 'search-result-title', textContent: item.name || '' });
        var metaEl = el('div', { className: 'search-result-meta', textContent: item.categoryname || item.group || '' });
        info.appendChild(titleEl);
        info.appendChild(metaEl);
        row.appendChild(thumb);
        row.appendChild(info);
        row.appendChild(el('div', {
          className: 'search-result-type ' + (cls[type] || 'type-live'),
          textContent: labels[type] || 'Live'
        }));
        row.addEventListener('click', function () { if (onPlay) onPlay(item); });
        row.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); if (onPlay) onPlay(item); }
        });
        frag.appendChild(row);
      })(items[i]);
    }
    container.appendChild(frag);
  }

  /* ─── TOAST ─────────────────────────────────────────────── */
  function showToast(message, type, duration) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = el('div', { className: 'toast toast-' + (type || 'info'), textContent: message });
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration || 3000);
  }

  /* ─── ESTADOS ───────────────────────────────────────────── */
  function setLoading(show) {
    var loading = document.getElementById('content-loading');
    var grid = document.getElementById('content-grid');
    if (!loading || !grid) return;
    if (show) { loading.classList.remove('hidden'); grid.style.display = 'none'; }
    else { loading.classList.add('hidden'); grid.style.display = ''; }
  }

  function setEmpty(show) {
    var e = document.getElementById('content-empty');
    if (!e) return;
    if (show) e.classList.remove('hidden'); else e.classList.add('hidden');
  }

  function setLoadingMore(show) {
    var lm = document.getElementById('loading-more');
    if (!lm) {
      lm = el('div', {
        id: 'loading-more',
        style: 'text-align:center;padding:16px;color:var(--text-secondary,#aaa);font-size:14px'
      });
      lm.textContent = 'Carregando mais…';
      var grid = document.getElementById('content-grid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(lm, grid.nextSibling);
    }
    lm.style.display = show ? 'block' : 'none';
  }

  /* ─── UTILITÁRIOS ───────────────────────────────────────── */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'textContent') node.textContent = attrs[k];
        else if (k === 'innerHTML') node.innerHTML = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else if (k === 'style') node.style.cssText = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function truncate(s, max) {
    s = s || '';
    return s.length > max ? s.substring(0, max) + '…' : s;
  }

  /* ─── EXPORTAÇÃO ────────────────────────────────────────── */
  return {
    createCard: createCard,
    createPlaceholder: createPlaceholder,
    renderGrid: renderGrid,
    renderCategoryFilter: renderCategoryFilter,
    renderSearchResults: renderSearchResults,
    showToast: showToast,
    setLoading: setLoading,
    setEmpty: setEmpty,
    setLoadingMore: setLoadingMore,
    el: el,
    lazyLoadImg: lazyLoadImg,
    destroyVirtualScroll: destroyVirtualScroll
  };

})();