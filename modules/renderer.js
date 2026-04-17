/**
 * StreamTV renderer.js — Virtual Scroll v6 (TV-SAFE)
 *
 * Estratégia:
 *  • Listas pequenas (≤ SMALL_LIST): render direto, sem virtual scroll.
 *  • Listas grandes: virtual scroll por LINHAS.
 *     - Render de um "probe card" invisível para medir colunas e altura REAIS.
 *     - Espaçadores top/bot controlam o scroll total sem manter todos os nós.
 *     - Só OVERSCAN_ROWS linhas acima/abaixo da viewport ficam no DOM.
 *     - Uma única instância de IntersectionObserver para lazy-load de imagens.
 *     - Scroll handler com requestAnimationFrame (sem thrashing de layout).
 */

var Renderer = (function () {
  'use strict';

  /* ─── TUNÁVEIS ──────────────────────────────────────────────── */
  var SMALL_LIST = 40;   // listas abaixo disso: render direto
  var OVERSCAN = 2;    // linhas extras visíveis acima e abaixo
  var IMG_MAX = 1;    // imagens carregando ao mesmo tempo (TV lenta)
  var IMG_DELAY = 120;  // ms entre despachos de imagem
  var FALLBACK_H = 240;  // px: altura de linha usada se probe falhar
  var FALLBACK_C = 4;    // colunas usadas se probe falhar

  /* ─── ESTADO DO VIRTUAL SCROLL ──────────────────────────────── */
  var vs = _emptyVS();
  function _emptyVS() {
    return {
      items: [],
      options: null,
      container: null,
      scrollEl: null,
      rendered: {},       // rowIndex → [card, ...]
      spacerTop: null,
      spacerBot: null,
      totalRows: 0,
      rowH: FALLBACK_H,
      cols: FALLBACK_C,
      rafId: null,
      onScroll: null
    };
  }

  /* ─── FILA DE IMAGENS ───────────────────────────────────────── */
  var imgQueue = [];
  var imgLoading = 0;
  var imgTimer = null;
  var observer = null;

  function _getObserver() {
    if (observer) return observer;
    if (!('IntersectionObserver' in window)) return null;
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        observer.unobserve(el);
        var src = el.getAttribute('data-src');
        if (src && el.getAttribute('data-loaded') !== '1') {
          imgQueue.push({ el: el, src: src });
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
      _loadImg(entry.el, entry.src);
    }
  }

  function _loadImg(imgEl, src) {
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
  }

  function lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    var obs = _getObserver();
    if (obs) {
      obs.observe(imgEl);
    } else {
      imgQueue.push({ el: imgEl, src: src });
      _scheduleImg();
    }
  }

  /* ─── HELPERS DOM ───────────────────────────────────────────── */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'textContent') { node.textContent = attrs[k]; }
        else if (k === 'innerHTML') { node.innerHTML = attrs[k]; }
        else if (k === 'className') { node.className = attrs[k]; }
        else if (k === 'style') { node.style.cssText = attrs[k]; }
        else { node.setAttribute(k, attrs[k]); }
      }
    }
    return node;
  }

  function truncate(s, max) {
    if (!s) return '';
    return s.length > max ? s.substring(0, max) + '…' : s;
  }

  /* ─── PROBE: mede altura de linha e nº de colunas ───────────── */
  /**
   * Injeta um card invisível no container, mede offsetWidth/offsetHeight
   * e descobre quantas colunas cabem. Remove o probe logo depois.
   * Fallback seguro se o container ainda não tiver largura.
   */
  function _probe(container, item, options) {
    var probeWrap = el('div', { style: 'position:absolute;top:-9999px;left:0;width:100%;visibility:hidden;pointer-events:none' });
    container.appendChild(probeWrap);

    var probeCard = createCard(item, options);
    probeWrap.appendChild(probeCard);

    // Força reflow
    var cardW = probeCard.offsetWidth;
    var cardH = probeCard.offsetHeight;
    var contW = container.offsetWidth || probeWrap.offsetWidth || 0;

    container.removeChild(probeWrap);

    var cols = FALLBACK_C;
    var rowH = FALLBACK_H;

    if (cardW > 0 && contW > 0) {
      // gap estimado: mesmo do CSS (.content-grid gap:14px)
      var gap = 14;
      cols = Math.max(1, Math.floor((contW + gap) / (cardW + gap)));
    }
    if (cardH > 10) {
      // Adiciona gap vertical para a linha toda
      rowH = cardH + 14;
    }

    return { cols: cols, rowH: rowH };
  }

  /* ─── CRIAÇÃO DE CARD ───────────────────────────────────────── */
  function createCard(item, options) {
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var name = item.name || 'Sem Nome';
    var type = item.type || 'live';
    var category = item.category_name || item.group || '';
    var icon = item.stream_icon || item.cover || item.series_cover || '';

    var isPortrait = (type === 'movie' || type === 'series');
    var isFav = (typeof Storage !== 'undefined') ? Storage.isFavorite(id) : false;

    var card = el('div', { className: 'card', role: 'listitem', tabindex: '0', 'aria-label': name });

    // Thumb ou placeholder
    if (icon) {
      var thumb = el('img', {
        className: 'card-thumb' + (isPortrait ? ' portrait' : ''),
        alt: name,
        width: isPortrait ? '120' : '160',
        height: isPortrait ? '180' : '90',
        loading: 'lazy'
      });
      lazyLoadImg(thumb, icon);
      card.appendChild(thumb);
    } else {
      card.appendChild(_createPlaceholder(type, name, isPortrait));
    }

    // Badge AO VIVO
    if (type === 'live') {
      card.appendChild(el('div', { className: 'card-live-badge', textContent: 'AO VIVO' }));
    }

    // Botão favorito
    var favBtn = el('div', { className: 'card-fav' + (isFav ? ' is-fav' : ''), textContent: isFav ? '★' : '☆' });
    card.appendChild(favBtn);

    // Barra de progresso (VOD/Séries)
    if (type !== 'live' && typeof Storage !== 'undefined') {
      var prog = Storage.getProgress(id);
      if (prog && prog.pct > 1) {
        var pBar = el('div', { className: 'card-progress' });
        var pFill = el('div', { className: 'card-progress-fill' });
        pFill.style.width = Math.min(100, prog.pct) + '%';
        pBar.appendChild(pFill);
        card.appendChild(pBar);
      }
    }

    // Botão remover (watchlist)
    if (options && options.onRemove && type !== 'live') {
      var removeBtn = el('div', { className: 'card-remove', innerHTML: '&times;', title: 'Remover' });
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (options.onRemove) options.onRemove(item);
      });
      card.appendChild(removeBtn);
    }

    // Corpo do card
    var body = el('div', { className: 'card-body' });
    body.appendChild(el('p', { className: 'card-title', textContent: name }));
    body.appendChild(el('p', { className: 'card-category', textContent: category }));
    card.appendChild(body);

    /* ── Long-press para favoritar ── */
    var lpTimer = null, lpStart = 0, lpRaf = null, ignorePlay = false, isKeyDown = false;

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
      card.style.setProperty('--lp-pct', pct + '%');
      if (pct < 100) { lpRaf = requestAnimationFrame(tickLP); }
    }

    card.addEventListener('click', function (e) {
      if (favBtn.contains(e.target)) return;
      if (ignorePlay) return;
      if (options && options.onPlay) options.onPlay(item);
    });

    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault();
        e.stopPropagation();
        if (isKeyDown) return;
        isKeyDown = true;
        ignorePlay = false;
        lpStart = Date.now();
        card.classList.add('lp-active');
        lpRaf = requestAnimationFrame(tickLP);
        lpTimer = setTimeout(function () {
          lpTimer = null;
          ignorePlay = true;
          cancelLP();
          var nowFav = Storage.toggleFavorite(item);
          favBtn.textContent = nowFav ? '★' : '☆';
          favBtn.className = 'card-fav' + (nowFav ? ' is-fav' : '');
          if (options && options.onFavorite) options.onFavorite(item, nowFav);
          Renderer.showToast(nowFav ? 'Adicionado aos favoritos' : 'Removido dos favoritos', nowFav ? 'success' : 'info');
          setTimeout(function () { ignorePlay = false; }, 500);
        }, 3000);
      }
    });

    card.addEventListener('keyup', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault();
        isKeyDown = false;
        if (lpTimer) { cancelLP(); return; }
        if (!ignorePlay && options && options.onPlay) options.onPlay(item);
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

  function _createPlaceholder(type, name, portrait) {
    var icons = { live: '📺', movie: '🎬', series: '🎞' };
    var div = el('div', { className: 'card-placeholder' + (portrait ? ' portrait' : '') });
    div.appendChild(el('div', { className: 'card-placeholder-icon', textContent: icons[type] || '▶' }));
    div.appendChild(el('div', { className: 'card-placeholder-text', textContent: truncate(name, 24) }));
    return div;
  }

  /* ─── VIRTUAL SCROLL: LINHA ─────────────────────────────────── */

  function _addRow(rowIndex) {
    if (vs.rendered[rowIndex]) return; // já renderizada
    var start = rowIndex * vs.cols;
    var end = Math.min(start + vs.cols, vs.items.length);
    if (start >= vs.items.length) return;

    var frag = document.createDocumentFragment();
    var cards = [];
    for (var i = start; i < end; i++) {
      var c = createCard(vs.items[i], vs.options);
      c.setAttribute('data-vs-row', String(rowIndex));
      frag.appendChild(c);
      cards.push(c);
    }
    if (vs.spacerBot && vs.spacerBot.parentNode === vs.container) {
      vs.container.insertBefore(frag, vs.spacerBot);
    } else {
      vs.container.appendChild(frag);
    }
    vs.rendered[rowIndex] = cards;
  }

  function _removeRow(rowIndex) {
    var cards = vs.rendered[rowIndex];
    if (!cards) return;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      // Desobserva imagens antes de remover
      if (observer) {
        var imgs = c.querySelectorAll('img[data-src]');
        for (var j = 0; j < imgs.length; j++) { observer.unobserve(imgs[j]); }
      }
      if (c.parentNode) c.parentNode.removeChild(c);
    }
    delete vs.rendered[rowIndex];
  }

  function _renderVisibleRows(scrollTop) {
    if (!vs.container || !vs.items.length) return;

    var viewH = vs.scrollEl ? vs.scrollEl.clientHeight : (window.innerHeight || 600);
    // offsetTop relativo ao scrollEl
    var contTop = 0;
    try { contTop = vs.container.getBoundingClientRect().top - vs.scrollEl.getBoundingClientRect().top + scrollTop; }
    catch (e) { contTop = vs.container.offsetTop || 0; }

    var visTop = Math.max(0, scrollTop - contTop);
    var visBot = visTop + viewH;

    var firstRow = Math.max(0, Math.floor(visTop / vs.rowH) - OVERSCAN);
    var lastRow = Math.min(vs.totalRows - 1, Math.ceil(visBot / vs.rowH) + OVERSCAN);

    // Remove linhas fora da janela
    for (var rk in vs.rendered) {
      var rkN = parseInt(rk, 10);
      if (rkN < firstRow || rkN > lastRow) _removeRow(rkN);
    }
    // Adiciona linhas dentro da janela
    for (var r = firstRow; r <= lastRow; r++) {
      if (!vs.rendered[r]) _addRow(r);
    }

    // Atualiza espaçadores
    var topH = firstRow * vs.rowH;
    var botH = Math.max(0, (vs.totalRows - lastRow - 1) * vs.rowH);
    if (vs.spacerTop) vs.spacerTop.style.height = topH + 'px';
    if (vs.spacerBot) vs.spacerBot.style.height = botH + 'px';
  }

  function _initVirtualScroll(container, items, options) {
    // Garantia: limpa qualquer estado anterior
    destroyVirtualScroll();

    vs.items = items;
    vs.options = options;
    vs.container = container;
    vs.rendered = {};

    // Elemento de scroll: main-content ou pai do container
    vs.scrollEl = document.getElementById('main-content') || container.parentElement;

    if (items.length <= SMALL_LIST) {
      _renderAllDirect(container, items, options);
      return;
    }

    // Prepara container para posicionamento absoluto dos espaçadores
    container.innerHTML = '';
    container.style.position = 'relative';

    // ─── PROBE: mede altura real DEPOIS de limpar o container ───
    var measured = _probe(container, items[0], options);
    vs.cols = measured.cols;
    vs.rowH = measured.rowH;

    vs.totalRows = Math.ceil(items.length / vs.cols);

    // Cria espaçadores
    vs.spacerTop = el('div', { className: 'vs-spacer', style: 'width:100%;flex-shrink:0;height:0px' });
    vs.spacerBot = el('div', { className: 'vs-spacer', style: 'width:100%;flex-shrink:0;height:' + (vs.totalRows * vs.rowH) + 'px' });
    container.appendChild(vs.spacerTop);
    container.appendChild(vs.spacerBot);

    // Render inicial
    var scrollTop = vs.scrollEl ? vs.scrollEl.scrollTop : 0;
    _renderVisibleRows(scrollTop);

    // Listener de scroll com rAF (sem throttle externo, só 1 rAF por frame)
    var ticking = false;
    vs.onScroll = function () {
      if (!ticking) {
        ticking = true;
        vs.rafId = requestAnimationFrame(function () {
          ticking = false;
          _renderVisibleRows(vs.scrollEl ? vs.scrollEl.scrollTop : 0);
        });
      }
    };
    if (vs.scrollEl) vs.scrollEl.addEventListener('scroll', vs.onScroll, { passive: true });
  }

  function _renderAllDirect(container, items, options) {
    container.innerHTML = '';
    container.style.position = '';
    if (!items || !items.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      frag.appendChild(createCard(items[i], options));
    }
    container.appendChild(frag);
  }

  /* ─── API PÚBLICA: renderGrid ───────────────────────────────── */
  /**
   * append=false → nova lista: destrói estado anterior e inicializa do zero.
   * append=true  → chunk de streaming: acrescenta itens ao virtual scroll ativo.
   */
  function renderGrid(container, items, options, append) {
    if (!container || !items) return;

    if (append && vs.container === container && vs.items.length > 0) {
      // ── Modo append: acrescenta itens e recalcula espaçador ──
      vs.items = vs.items.concat(items);
      vs.totalRows = Math.ceil(vs.items.length / vs.cols);

      if (vs.spacerBot) {
        // Atualiza altura do espaçador bot para refletir novos itens
        var scrollTop = vs.scrollEl ? vs.scrollEl.scrollTop : 0;
        _renderVisibleRows(scrollTop);
      } else {
        // Ainda em modo direto (lista pequena) — adicionar cards diretos
        var frag = document.createDocumentFragment();
        for (var i = 0; i < items.length; i++) {
          frag.appendChild(createCard(items[i], options));
        }
        container.appendChild(frag);
      }
    } else {
      // ── Modo normal: inicializa do zero ──
      _initVirtualScroll(container, items, options);
    }
  }

  /* ─── API PÚBLICA: destroyVirtualScroll ─────────────────────── */
  function destroyVirtualScroll() {
    if (vs.scrollEl && vs.onScroll) {
      vs.scrollEl.removeEventListener('scroll', vs.onScroll);
    }
    if (vs.rafId) { cancelAnimationFrame(vs.rafId); }

    if (vs.container) {
      vs.container.innerHTML = '';
      vs.container.style.position = '';
    }

    // Limpa fila de imagens
    if (observer) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) { observer.unobserve(imgs[i]); }
    }
    imgQueue = [];
    imgLoading = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }

    vs = _emptyVS();
  }

  /* ─── CATEGORIA FILTER ──────────────────────────────────────── */
  function renderCategoryFilter(container, categories, onSelect) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();

    var allBtn = el('button', { className: 'cat-btn active', textContent: 'Todos', tabindex: '0' });
    allBtn.dataset.catId = '';
    frag.appendChild(allBtn);

    for (var i = 0; i < categories.length; i++) {
      (function (cat) {
        var cleanName = (cat.category_name || '').replace(/[^\x20-\x7E\u00C0-\u024F\u0400-\u04FF]/g, '').trim();
        var btn = el('button', { className: 'cat-btn', textContent: cleanName, tabindex: '0' });
        btn.dataset.catId = cat.category_id;
        frag.appendChild(btn);
      })(categories[i]);
    }
    container.appendChild(frag);

    container.addEventListener('click', function (e) {
      if (!e.target.classList.contains('cat-btn')) return;
      var btns = container.querySelectorAll('.cat-btn');
      for (var j = 0; j < btns.length; j++) { btns[j].classList.remove('active'); }
      e.target.classList.add('active');
      if (onSelect) onSelect(e.target.dataset.catId);
    });
  }

  /* ─── BUSCA ─────────────────────────────────────────────────── */
  function renderSearchResults(container, items, onPlay) {
    container.innerHTML = '';
    if (!items || !items.length) return;

    var frag = document.createDocumentFragment();
    var labels = { live: 'Ao Vivo', movie: 'Filme', series: 'Série' };
    var cls = { live: 'type-live', movie: 'type-movie', series: 'type-series' };

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var type = item.type || 'live';
        var icon = item.stream_icon || item.cover || item.series_cover || '';

        var row = el('div', { className: 'search-result-item', role: 'listitem', tabindex: '0', 'aria-label': item.name });
        var thumb;
        if (icon) {
          thumb = el('img', { className: 'search-result-thumb', alt: item.name, loading: 'lazy' });
          lazyLoadImg(thumb, icon);
        } else {
          thumb = el('div', { className: 'search-result-thumb', style: 'display:flex;align-items:center;justify-content:center;font-size:28px;background:var(--bg-input);border-radius:8px' });
          thumb.textContent = type === 'live' ? '📺' : (type === 'movie' ? '🎬' : '🎞');
        }
        var info = el('div', { className: 'search-result-info' });
        info.appendChild(el('div', { className: 'search-result-title', textContent: item.name }));
        info.appendChild(el('div', { className: 'search-result-meta', textContent: item.category_name || item.group || '' }));

        row.appendChild(thumb);
        row.appendChild(info);
        row.appendChild(el('div', { className: 'search-result-type ' + (cls[type] || 'type-live'), textContent: labels[type] || 'Live' }));

        row.addEventListener('click', function () { if (onPlay) onPlay(item); });
        row.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); if (onPlay) onPlay(item); } });

        frag.appendChild(row);
      })(items[i]);
    }
    container.appendChild(frag);
  }

  /* ─── ESTADOS DE UI ─────────────────────────────────────────── */
  function setLoading(show) {
    var loading = document.getElementById('content-loading');
    var grid = document.getElementById('content-grid');
    if (!loading || !grid) return;
    if (show) {
      loading.classList.remove('hidden');
      grid.style.display = 'none';
    } else {
      loading.classList.add('hidden');
      grid.style.display = '';
    }
  }

  function setEmpty(show) {
    var e = document.getElementById('content-empty');
    if (!e) return;
    if (show) e.classList.remove('hidden'); else e.classList.add('hidden');
  }

  function setLoadingMore(show) {
    var lm = document.getElementById('loading-more');
    if (!lm) {
      lm = el('div', { id: 'loading-more', style: 'text-align:center;padding:16px;color:var(--text-secondary,#aaa);font-size:14px' });
      lm.textContent = 'Carregando mais…';
      var grid = document.getElementById('content-grid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(lm, grid.nextSibling);
    }
    lm.style.display = show ? 'block' : 'none';
  }

  /* ─── TOAST ─────────────────────────────────────────────────── */
  function showToast(message, type, duration) {
    var c = document.getElementById('toast-container');
    if (!c) return;
    var toast = el('div', { className: 'toast toast-' + (type || 'info'), textContent: message });
    c.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration || 3000);
  }

  /* ─── EXPORTS ───────────────────────────────────────────────── */
  return {
    createCard: createCard,
    createPlaceholder: _createPlaceholder,
    renderGrid: renderGrid,
    renderCategoryFilter: renderCategoryFilter,
    renderSearchResults: renderSearchResults,
    showToast: showToast,
    setLoading: setLoading,
    setEmpty: setEmpty,
    setLoadingMore: setLoadingMore,
    lazyLoadImg: lazyLoadImg,
    destroyVirtualScroll: destroyVirtualScroll,
    el: el
  };

})();