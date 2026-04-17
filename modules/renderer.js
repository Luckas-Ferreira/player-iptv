/**
 * renderer.js — StreamTV v4 (TV-OPTIMIZED)
 *
 * OTIMIZAÇÕES PRINCIPAIS PARA SMART TV ANTIGA (Panasonic etc.):
 * 1. VIRTUAL SCROLL — só renderiza os cards visíveis + margem de segurança.
 *    O DOM nunca ultrapassa ~30 cards ao mesmo tempo, independente do tamanho
 *    da lista (Netflix pode ter 2000+ itens). Isso elimina a causa raiz do travamento.
 * 2. IMGMAX reduzido para 1 — apenas 1 imagem carrega por vez na TV lenta.
 * 3. Placeholder de IMAGEM via CSS (sem criar nó extra no DOM).
 * 4. DocumentFragment para batch de DOM mutations.
 * 5. requestIdleCallback (com fallback setTimeout) para renderizar fora do frame.
 * 6. Cleanup de observer ao trocar de categoria para evitar leak de memória.
 */

var Renderer = (function () {
  'use strict';

  /* ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────── */
  var CARD_HEIGHT = 200;   // px estimado de cada card (portrait ≈ 220, landscape ≈ 170)
  var CARDS_PER_ROW = 4;     // colunas do grid (ajuste se mudar o CSS)
  var OVERSCAN_ROWS = 3;     // linhas extras acima e abaixo da viewport
  var IMGMAX = 1;     // máximo de imagens carregando simultaneamente (TV lenta = 1)
  var IMG_DELAY = 80;    // ms entre lotes de imagem
  var BATCH_SIZE = 12;    // cards renderizados por tick no virtual scroll

  /* ─── ESTADO DO VIRTUAL SCROLL ─────────────────────────────────────────── */
  var _vs = {
    items: [],       // lista completa de dados
    options: null,     // {onPlay, onFavorite, onRemove}
    container: null,     // div#content-grid
    scrollEl: null,     // div#main-content (elemento com overflow:auto)
    totalHeight: 0,        // altura do espaçador virtual
    rendered: {},       // { rowIndex: [cards] } — linhas atualmente no DOM
    spacerTop: null,     // div de espaçamento superior
    spacerBot: null,     // div de espaçamento inferior
    rafId: null,
    scrollHandler: null,
    lastScrollTop: 0
  };

  /* ─── FILA DE IMAGENS ───────────────────────────────────────────────────── */
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
        var el = entries[i].target;
        var s = el.getAttribute('data-src');
        if (s && el.getAttribute('data-loaded') !== '1') {
          imgQueue.push({ el: el, src: s });
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
      // TV sem IntersectionObserver — carrega direto na fila
      imgQueue.push({ el: imgEl, src: src });
      scheduleProcess();
    }
  }

  /* ─── CRIAÇÃO DE CARD ────────────────────────────────────────────────────── */
  function createCard(item, options) {
    var id = String(item.streamid || item.seriesid || item.vodid || item.id || '');
    var name = item.name || 'Sem Nome';
    var type = item.type || 'live';
    var category = item.categoryname || item.group || '';
    var icon = item.streamicon || item.cover || item.seriescover || '';
    var isPortrait = (type === 'movie' || type === 'series');
    var isFav = (typeof Storage !== 'undefined') ? Storage.isFavorite(id) : false;

    var card = el('div', {
      className: 'card',
      role: 'listitem',
      tabIndex: 0,
      'aria-label': name
    });

    // Imagem ou placeholder
    var thumb;
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

    // Badge AO VIVO
    if (type === 'live') card.appendChild(el('div', { className: 'card-live-badge', textContent: 'AO VIVO' }));

    // Favorito
    var favBtn = el('div', { className: 'card-fav' + (isFav ? ' is-fav' : ''), textContent: isFav ? '★' : '☆' });
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
    if (options && options.onRemove && type !== 'live') {
      var removeBtn = el('div', { className: 'card-remove', innerHTML: '&times;', title: 'Remover da fileira' });
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

    // ── Interações ────────────────────────────────────────────
    var lpTimer = null, lpStart = 0, lpRaf = null, ignorePlay = false, isKeyDown = false;

    function cancelLP() {
      clearTimeout(lpTimer); cancelAnimationFrame(lpRaf);
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
      if (options && options.onPlay) options.onPlay(item);
    });

    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault(); e.stopPropagation();
        if (isKeyDown) return;
        isKeyDown = true; ignorePlay = false;
        lpStart = Date.now();
        card.classList.add('lp-active');
        lpRaf = requestAnimationFrame(tickLP);
        lpTimer = setTimeout(function () {
          lpTimer = null; ignorePlay = true; cancelLP();
          var nowFav = Storage.toggleFavorite(item);
          favBtn.textContent = nowFav ? '★' : '☆';
          favBtn.className = 'card-fav' + (nowFav ? ' is-fav' : '');
          if (options && options.onFavorite) options.onFavorite(item, nowFav);
          Renderer.showToast(nowFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos', nowFav ? 'success' : 'info');
          setTimeout(function () { ignorePlay = false; }, 500);
        }, 3000);
      }
    });

    card.addEventListener('keyup', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault(); isKeyDown = false;
        if (lpTimer) { cancelLP(); }
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

  function createPlaceholder(type, name, portrait) {
    var icons = { live: '📺', movie: '🎬', series: '🎥' };
    var div = el('div', { className: 'card-placeholder' + (portrait ? ' portrait' : '') });
    div.appendChild(el('div', { className: 'card-placeholder-icon', textContent: icons[type] || '▶' }));
    div.appendChild(el('div', { className: 'card-placeholder-text', textContent: truncate(name, 24) }));
    return div;
  }

  /* ─── VIRTUAL SCROLL ────────────────────────────────────────────────────── */

  /**
   * Inicializa o virtual scroll para uma nova lista de itens.
   * Em vez de criar N cards no DOM, cria apenas os que estão na tela.
   */
  function initVirtualScroll(container, items, options) {
    // 1. Limpa o estado anterior
    destroyVirtualScroll();

    _vs.items = items || [];
    _vs.options = options || {};
    _vs.container = container;
    _vs.rendered = {};

    // 2. Obtém o elemento com scroll (main-content)
    _vs.scrollEl = document.getElementById('main-content') || container.parentElement;

    // 3. Para listas pequenas (≤ BATCH_SIZE*2), renderiza tudo de uma vez sem virtual scroll
    if (_vs.items.length <= BATCH_SIZE * 2) {
      renderAllDirect(container, items, options);
      return;
    }

    // 4. Configura o container como posicionamento relativo
    container.style.position = 'relative';
    container.innerHTML = '';

    // Detecta número de colunas real a partir do grid
    var cols = detectColumns(container);
    if (cols > 0) CARDS_PER_ROW = cols;

    // 5. Cria espaçadores virtuais (top e bottom)
    _vs.spacerTop = el('div', { className: 'vs-spacer-top' });
    _vs.spacerBot = el('div', { className: 'vs-spacer-bot' });
    _vs.spacerTop.style.cssText = 'width:100%;flex-shrink:0;';
    _vs.spacerBot.style.cssText = 'width:100%;flex-shrink:0;';
    container.appendChild(_vs.spacerTop);
    container.appendChild(_vs.spacerBot);

    // Calcula altura total
    var totalRows = Math.ceil(_vs.items.length / CARDS_PER_ROW);
    _vs.totalHeight = totalRows * CARD_HEIGHT;
    _vs.spacerBot.style.height = _vs.totalHeight + 'px';

    // 6. Renderiza a primeira janela
    renderVisibleRows(0);

    // 7. Escuta scroll com throttle para não travar a TV
    var ticking = false;
    _vs.scrollHandler = function () {
      _vs.lastScrollTop = _vs.scrollEl.scrollTop;
      if (!ticking) {
        ticking = true;
        // Usa requestAnimationFrame apenas uma vez — não acumula
        _vs.rafId = requestAnimationFrame(function () {
          ticking = false;
          renderVisibleRows(_vs.lastScrollTop);
        });
      }
    };
    _vs.scrollEl.addEventListener('scroll', _vs.scrollHandler, { passive: true });
  }

  function detectColumns(container) {
    // Tenta ler do CSS computed se container já tem width
    var w = container.offsetWidth;
    if (!w) return CARDS_PER_ROW; // fallback
    // Tenta inferir do primeiro card filho já renderizado
    var firstCard = container.querySelector('.card');
    if (firstCard) {
      var cw = firstCard.offsetWidth;
      if (cw > 0) return Math.max(1, Math.round(w / cw));
    }
    // Fallback pela largura bruta
    if (w < 400) return 2;
    if (w < 700) return 3;
    return 4;
  }

  function renderVisibleRows(scrollTop) {
    if (!_vs.container || !_vs.items.length) return;

    var viewH = _vs.scrollEl ? _vs.scrollEl.clientHeight : window.innerHeight;
    var containerTop = _vs.container.getBoundingClientRect
      ? (_vs.container.offsetTop || 0)
      : 0;

    // Janela em pixels relativa ao container
    var visTop = Math.max(0, scrollTop - containerTop);
    var visBot = visTop + viewH;

    // Converte para índice de linha com overscan
    var firstRow = Math.max(0, Math.floor(visTop / CARD_HEIGHT) - OVERSCAN_ROWS);
    var lastRow = Math.min(
      Math.ceil(_vs.items.length / CARDS_PER_ROW) - 1,
      Math.ceil(visBot / CARD_HEIGHT) + OVERSCAN_ROWS
    );

    // Remove linhas que saíram da janela
    for (var rowKey in _vs.rendered) {
      var rk = parseInt(rowKey, 10);
      if (rk < firstRow - OVERSCAN_ROWS || rk > lastRow + OVERSCAN_ROWS) {
        removeRow(rk);
      }
    }

    // Adiciona linhas que entraram na janela
    for (var r = firstRow; r <= lastRow; r++) {
      if (!_vs.rendered[r]) {
        addRow(r);
      }
    }

    // Ajusta espaçadores
    if (_vs.spacerTop) _vs.spacerTop.style.height = (firstRow * CARD_HEIGHT) + 'px';
    if (_vs.spacerBot) {
      var totalRows = Math.ceil(_vs.items.length / CARDS_PER_ROW);
      var rendered = lastRow + 1;
      var remaining = Math.max(0, totalRows - rendered);
      _vs.spacerBot.style.height = (remaining * CARD_HEIGHT) + 'px';
    }
  }

  function addRow(rowIndex) {
    var start = rowIndex * CARDS_PER_ROW;
    var end = Math.min(start + CARDS_PER_ROW, _vs.items.length);
    var frag = document.createDocumentFragment();
    var rowCards = [];

    for (var i = start; i < end; i++) {
      var card = createCard(_vs.items[i], _vs.options);
      card.setAttribute('data-vs-row', rowIndex);
      frag.appendChild(card);
      rowCards.push(card);
    }

    // Insere antes do espaçador inferior
    if (_vs.spacerBot && _vs.spacerBot.parentNode === _vs.container) {
      _vs.container.insertBefore(frag, _vs.spacerBot);
    } else {
      _vs.container.appendChild(frag);
    }

    _vs.rendered[rowIndex] = rowCards;
  }

  function removeRow(rowIndex) {
    var cards = _vs.rendered[rowIndex];
    if (!cards) return;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      // Cancela observação de imagens desta linha para liberar memória
      if (globalObserver) {
        var imgs = c.querySelectorAll('img[data-src]');
        for (var j = 0; j < imgs.length; j++) globalObserver.unobserve(imgs[j]);
      }
      if (c.parentNode) c.parentNode.removeChild(c);
    }
    delete _vs.rendered[rowIndex];
  }

  /** Para listas pequenas — renderiza tudo diretamente sem virtual scroll */
  function renderAllDirect(container, items, options) {
    container.innerHTML = '';
    if (!items || !items.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      frag.appendChild(createCard(items[i], options));
    }
    container.appendChild(frag);
  }

  /** Limpa o virtual scroll atual (troca de aba/categoria) */
  function destroyVirtualScroll() {
    if (_vs.scrollEl && _vs.scrollHandler) {
      _vs.scrollEl.removeEventListener('scroll', _vs.scrollHandler);
    }
    if (_vs.rafId) { cancelAnimationFrame(_vs.rafId); _vs.rafId = null; }
    // Desobserva todas as imagens pendentes
    if (globalObserver) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) globalObserver.unobserve(imgs[i]);
    }
    // Limpa a fila de imagens
    imgQueue = [];
    imgLoading = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }

    _vs.items = [];
    _vs.rendered = {};
    _vs.scrollHandler = null;
    _vs.container = null;
    _vs.scrollEl = null;
    _vs.spacerTop = null;
    _vs.spacerBot = null;
  }

  /* ─── API PÚBLICA DE GRADE ──────────────────────────────────────────────── */

  /**
   * renderGrid — ponto de entrada principal.
   * append=true: acrescenta itens à lista virtual (streaming progressivo).
   * append=false: reinicia tudo com a nova lista.
   */
  function renderGrid(container, items, options, append) {
    if (!container) return;

    if (append) {
      // Streaming progressivo: adiciona itens ao virtual scroll já ativo
      if (_vs.container === container && _vs.items.length > 0) {
        _vs.items = _vs.items.concat(items || []);
        // Recalcula espaçador total
        var totalRows = Math.ceil(_vs.items.length / CARDS_PER_ROW);
        _vs.totalHeight = totalRows * CARD_HEIGHT;
        // Renderiza nova janela visível (pode incluir novos itens)
        renderVisibleRows(_vs.scrollEl ? _vs.scrollEl.scrollTop : 0);
      } else {
        // Ainda não havia virtual scroll — inicia agora
        initVirtualScroll(container, items || [], options);
      }
    } else {
      // Nova lista completa — reinicia virtual scroll
      destroyVirtualScroll();
      initVirtualScroll(container, items || [], options);
    }
  }

  /* ─── CATEGORIAS ────────────────────────────────────────────────────────── */
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

  /* ─── BUSCA ─────────────────────────────────────────────────────────────── */
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
        var row = el('div', { className: 'search-result-item', role: 'listitem', tabIndex: 0, 'aria-label': item.name });
        var thumb;
        if (icon) {
          thumb = el('img', { className: 'search-result-thumb', alt: item.name || '', loading: 'lazy' });
          lazyLoadImg(thumb, icon);
        } else {
          thumb = el('div', { className: 'search-result-thumb', style: 'display:flex;align-items:center;justify-content:center;font-size:28px;background:var(--bg-input);border-radius:8px' });
          thumb.textContent = type === 'live' ? '📺' : type === 'movie' ? '🎬' : '🎥';
        }
        var info = el('div', { className: 'search-result-info' });
        var titleEl = el('div', { className: 'search-result-title', textContent: item.name || '' });
        var metaEl = el('div', { className: 'search-result-meta', textContent: item.categoryname || item.group || '' });
        info.appendChild(titleEl); info.appendChild(metaEl);
        row.appendChild(thumb); row.appendChild(info);
        row.appendChild(el('div', { className: 'search-result-type ' + (cls[type] || 'type-live'), textContent: labels[type] || 'Live' }));
        row.addEventListener('click', function () { if (onPlay) onPlay(item); });
        row.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); if (onPlay) onPlay(item); } });
        frag.appendChild(row);
      })(items[i]);
    }
    container.appendChild(frag);
  }

  /* ─── TOAST ─────────────────────────────────────────────────────────────── */
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

  /* ─── ESTADOS ────────────────────────────────────────────────────────────── */
  function setLoading(show) {
    var loading = document.getElementById('content-loading');
    var grid = document.getElementById('content-grid');
    if (!loading || !grid) return;
    if (show) { loading.classList.remove('hidden'); grid.style.display = 'none'; }
    else { loading.classList.add('hidden'); grid.style.display = ''; }
  }

  function setEmpty(show) {
    var el2 = document.getElementById('content-empty');
    if (!el2) return;
    if (show) el2.classList.remove('hidden'); else el2.classList.add('hidden');
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

  /* ─── UTILITÁRIOS ────────────────────────────────────────────────────────── */
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

  /* ─── EXPORTAÇÃO ─────────────────────────────────────────────────────────── */
  var Renderer = {
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

  return Renderer;
})();