/**
 * renderer.js — StreamTV v5 (TV-OPTIMIZED, SEM VIRTUAL SCROLL)
 *
 * OTIMIZAÇÕES PARA SMART TV ANTIGA:
 * 1. Sem virtual scroll — renderiza por chunks via app.js (2s entre chunks)
 * 2. IMGMAX = 2 — 2 imagens por vez (evita bloqueio por 1 travada)
 * 3. DocumentFragment para batch de DOM mutations
 * 4. IntersectionObserver para lazy load de imagens
 * 5. Cleanup de observer ao trocar de categoria
 * 6. Timeout de 10s por imagem — evita travar a fila
 * 7. Retry único com delay — rede instável de TV antiga
 * 8. Placeholder em vez de esconder — nunca fica "vazio"
 */

var Renderer = (function () {
  'use strict';

  /* ─── CONFIGURAÇÃO ──────────────────────────────────────── */
  var IMGMAX = 4;          /* 4 simultâneas — rápido o suficiente, não trava */
  var IMG_DELAY = 100;     /* ms entre tentativas de processar fila */
  var IMG_TIMEOUT = 10000; /* 10s timeout por imagem */
  var IMG_RETRY_DELAY = 800; /* ms mais curto antes do retry proxy */

  /* ─── FILA DE IMAGENS ───────────────────────────────────── */
  var imgQueue = [];
  var imgLoading = 0;
  var imgTimer = null;
  var globalObserver = null;
  var imgTimeouts = {};    /* timerId → imgEl — rastreia timeouts ativos */
  var imgIdCounter = 0;

  function getObserver() {
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
            scheduleProcess();
          }
        }
      }, { rootMargin: '150px 0px', threshold: 0 }); /* 150px — menor preload, menos pressão de memória */
    } catch (e) {
      /* IntersectionObserver pode falhar em TVs muito antigas */
      globalObserver = null;
      return null;
    }
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
      loadImg(img, entry.src, entry.retry || 0);
    }
  }

  function loadImg(imgEl, src, retryCount) {
    if (!src) { _replaceWithPlaceholder(imgEl); return; }

    var _imgId = ++imgIdCounter;
    var _done = false;
    var actualSrc = src.trim();

    if (retryCount >= 1) {
      /* Mesmo em formato JPG (ex: capas do TMDB), TVs antigas falham instantaneamente
         porque não suportam o certificado de segurança moderno (TLS 1.2/1.3) dos servidores.
         Usamos http://wsrv.nl para contornar protocolos HTTPS estritos que a TV não entende. */
      actualSrc = 'http://wsrv.nl/?url=' + encodeURIComponent(actualSrc);
    }

    /* Em TVs antigas usar novo Image() em memória funciona melhor para 
       prevenir erros de renderização dupla e loops infinitos */
    var _tmp = new Image();

    function finish(success) {
      if (_done) return;
      _done = true;
      /* Limpa timeout */
      if (imgTimeouts[_imgId]) { clearTimeout(imgTimeouts[_imgId]); delete imgTimeouts[_imgId]; }
      
      _tmp.onload = _tmp.onerror = null;
      imgLoading = Math.max(0, imgLoading - 1);

      if (success && imgEl && imgEl.parentNode) {
        imgEl.src = actualSrc;
        imgEl.setAttribute('data-loaded', '1');
        imgEl.style.display = '';
      } else if (retryCount < 1 && imgEl && imgEl.parentNode) {
        /* Retry usando o proxy após pequeno delay */
        setTimeout(function () {
          if (!imgEl.parentNode) return;
          imgQueue.push({ el: imgEl, src: src, retry: retryCount + 1 });
          scheduleProcess();
        }, IMG_RETRY_DELAY);
      } else {
        /* Falhou definitivamente — mostra placeholder em vez de esconder */
        _replaceWithPlaceholder(imgEl);
      }
      scheduleProcess();
    }

    _tmp.onload = function () { finish(true); };
    _tmp.onerror = function () { finish(false); };

    /* Timeout de segurança — evita 1 imagem travar toda a fila */
    imgTimeouts[_imgId] = setTimeout(function () {
      if (_done) return;
      try { _tmp.src = ''; } catch (e) {}
      finish(false);
    }, IMG_TIMEOUT);

    _tmp.src = actualSrc;
  }

  /**
   * Substitui <img> quebrada por placeholder visual.
   * Em vez de display:none (que some com o card), mostra ícone + nome.
   */
  function _replaceWithPlaceholder(imgEl) {
    if (!imgEl || !imgEl.parentNode) return;
    var card = imgEl.parentNode;
    var name = imgEl.getAttribute('alt') || '';
    var isPortrait = imgEl.className && imgEl.className.indexOf('portrait') !== -1;
    var type = 'movie';
    /* Infere tipo pelo contexto do card */
    if (card.querySelector('.card-live-badge')) type = 'live';

    var ph = createPlaceholder(type, name, isPortrait);
    try { card.replaceChild(ph, imgEl); } catch (e) {
      /* Fallback: esconde a imagem */
      imgEl.style.display = 'none';
    }
  }

  function lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    var obs = getObserver();
    if (obs) {
      obs.observe(imgEl);
    } else {
      /* Sem IntersectionObserver — enfileira direto (TV muito antiga) */
      imgQueue.push({ el: imgEl, src: src, retry: 0 });
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

    var showImages = true;

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
          height: isPortrait ? '180' : '90'
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

    // Badge de tipo (FILME/SÉRIE) — só em contextos mistos (watchlist, favoritos)
    if (!showImages && (type === 'movie' || type === 'series') && options && options.showTypeBadge) {
      var typeBadge = el('div', {
        className: 'card-live-badge card-type-badge card-type-' + type,
        textContent: type === 'movie' ? 'FILME' : 'SÉRIE'
      });
      card.appendChild(typeBadge);
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
        title: 'Remover da fileira',
        tabIndex: 0,
        'aria-label': 'Remover ' + name
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
      if (typeof removeBtn !== 'undefined' && removeBtn && removeBtn.contains(e.target)) return;
      if (ignorePlay) return;
      _clickHandled = true;
      /* Reseta a flag após um frame para não bloquear clicks futuros */
      setTimeout(function () { _clickHandled = false; }, 100);
      if (options && options.onPlay) options.onPlay(item);
    });

    card.addEventListener('keydown', function (e) {
      if (favBtn.contains(e.target)) return;
      if (typeof removeBtn !== 'undefined' && removeBtn && removeBtn.contains(e.target)) return;
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

  /* ─── DESTROY ───────────────────────────────────────── */
  function destroyVirtualScroll() {
    Pager.destroy();
    if (globalObserver) {
      var imgs = document.querySelectorAll('img[data-src]:not([data-loaded="1"])');
      for (var i = 0; i < imgs.length; i++) {
        try { globalObserver.unobserve(imgs[i]); } catch (e) {}
      }
    }
    /* Cancela todos os timeouts de imagens pendentes */
    for (var tid in imgTimeouts) {
      if (imgTimeouts.hasOwnProperty(tid)) {
        clearTimeout(imgTimeouts[tid]);
      }
    }
    imgTimeouts = {};
    imgQueue = [];
    imgLoading = 0;
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }
  }

  /* ─── PAGER (Progressive Sentinel) ───────────────────────── */
  /*
   * Renderiza listas grandes de forma progressiva:
   * - Apenas CHUNK itens no DOM inicialmente
   * - IntersectionObserver (com fallback scroll) adiciona mais ao rolar
   * - DOM_MAX limita nós no DOM; excedente é removido e compensado com spacer
   */
  var Pager = (function () {
    var CHUNK    = 20;   /* itens por render */
    var DOM_MAX  = 400;  /* máx cards no DOM ao mesmo tempo */
    var MARGIN   = 500;  /* px antes do fim para carregar próximo chunk */

    var _grid        = null;
    var _items       = [];
    var _opts        = {};
    var _rStart      = 0;   /* índice do 1º item ainda no DOM */
    var _rEnd        = 0;   /* índice após o último item no DOM */
    var _busy        = false;
    var _tok         = 0;
    var _sentinel    = null;
    var _spacer      = null;
    var _spacerH     = 0;
    var _observer    = null;
    var _scrollEl    = null;
    var _scrollFn    = null;

    /* ---- API Pública ---------------------------------------- */
    function init(grid, opts) {
      destroy();
      if (!grid) return;
      _grid    = grid;
      _opts    = opts || {};
      _items   = [];
      _rStart  = 0;
      _rEnd    = 0;
      _busy    = false;
      _spacerH = 0;
      _tok++;

      /* Limpa o grid de forma compatível com TVs antigas */
      while (_grid.firstChild) _grid.removeChild(_grid.firstChild);

      /* Spacer topo — compensa cards removidos pelo trimDOM */
      _spacer = document.createElement('div');
      _spacer.className = 'pager-spacer';
      _spacer.style.cssText = 'height:0;';
      _grid.appendChild(_spacer);

      /* Sentinel — div sináfora no final; acionado pelo IO ou scroll */
      _sentinel = document.createElement('div');
      _sentinel.className = 'pager-sentinel';
      _grid.appendChild(_sentinel);

      /* Container de scroll */
      _scrollEl = _findScrollParent(_grid);

      /* IO com fallback scroll */
      if (typeof IntersectionObserver !== 'undefined') {
        try {
          _observer = new IntersectionObserver(function (entries) {
            if (entries[0] && entries[0].isIntersecting) _scheduleChunk();
          }, { root: _scrollEl || null, rootMargin: MARGIN + 'px 0px', threshold: 0 });
          _observer.observe(_sentinel);
        } catch (e) { _setupScrollFallback(); }
      } else {
        _setupScrollFallback();
      }
    }

    /* Adiciona itens ao pool; dispara render se ainda não preencheu a tela */
    function append(newItems) {
      if (!_grid || !newItems || !newItems.length) return;
      for (var i = 0; i < newItems.length; i++) _items.push(newItems[i]);
      if (_rEnd < CHUNK * 2 && _items.length > _rEnd) _scheduleChunk();
    }

    function destroy() {
      _tok++;
      if (_observer) {
        try { _observer.disconnect(); } catch (e) {}
        _observer = null;
      }
      if (_scrollFn) {
        var t = _scrollEl || (typeof window !== 'undefined' ? window : null);
        if (t) try { t.removeEventListener('scroll', _scrollFn, false); } catch (e) {}
        _scrollFn = null;
      }
      _grid     = null;
      _items    = [];
      _sentinel = null;
      _spacer   = null;
      _busy     = false;
      _scrollEl = null;
    }

    /* ---- Internos ------------------------------------------ */
    function _setupScrollFallback() {
      var target = _scrollEl || (typeof window !== 'undefined' ? window : null);
      if (!target) return;
      _scrollFn = _throttle(function () {
        var scrollTop, clientH, scrollH;
        if (_scrollEl) {
          scrollTop = _scrollEl.scrollTop;
          clientH   = _scrollEl.clientHeight;
          scrollH   = _scrollEl.scrollHeight;
        } else {
          var d = document.documentElement;
          scrollTop = d.scrollTop || document.body.scrollTop || 0;
          clientH   = window.innerHeight || d.clientHeight || 0;
          scrollH   = d.scrollHeight   || document.body.scrollHeight || 0;
        }
        if ((scrollH - scrollTop - clientH) < MARGIN) _scheduleChunk();
      }, 200);
      target.addEventListener('scroll', _scrollFn, false);
    }

    function _scheduleChunk() {
      if (_busy || !_grid) return;
      if (_rEnd >= _items.length) return;
      _busy = true;
      var tok = _tok;
      setTimeout(function () {
        if (tok !== _tok || !_grid) { _busy = false; return; }
        _renderNext();
        _busy = false;
        /* Verifica se o scrollEl ainda tem espaço livre (sem IO) */
        if (!_observer && _rEnd < _items.length && _scrollEl) {
          var dist = _scrollEl.scrollHeight - _scrollEl.scrollTop - _scrollEl.clientHeight;
          if (dist < MARGIN) _scheduleChunk();
        }
      }, 0);
    }

    function _renderNext() {
      if (!_grid || _rEnd >= _items.length) return;
      var start = _rEnd;
      var end   = Math.min(start + CHUNK, _items.length);

      /* Remove sentinel temporariamente */
      if (_sentinel && _sentinel.parentNode === _grid) _grid.removeChild(_sentinel);

      /* Renderiza chunk via DocumentFragment */
      var frag = document.createDocumentFragment();
      for (var i = start; i < end; i++) {
        frag.appendChild(createCard(_items[i], _opts));
      }
      _grid.appendChild(frag);
      _rEnd = end;

      /* Remove cards antigos se o DOM estiver muito grande */
      _trimDOM();

      /* Recoloca sentinel no final */
      if (_sentinel) _grid.appendChild(_sentinel);
    }

    function _trimDOM() {
      var inDom = _rEnd - _rStart;
      if (inDom <= DOM_MAX) return;
      var toRemove = inDom - DOM_MAX;

      /* Lê altura do 1º card antes de remover */
      var cardH = 80;
      var gap   = 14;
      var node  = _spacer ? _spacer.nextSibling : (_grid ? _grid.firstChild : null);
      while (node && node !== _sentinel) {
        if (node.nodeType === 1 && node.className &&
            node.className.indexOf('card') !== -1 &&
            node.className.indexOf('pager') === -1) {
          try { cardH = node.offsetHeight || cardH; } catch(e) {}
          break;
        }
        node = node.nextSibling;
      }

      /* Estima colunas */
      var gridW    = 900;
      try { gridW = (_grid.clientWidth || _grid.offsetWidth || 900) - 56; } catch(e) {}
      var isCompact = _grid.className && _grid.className.indexOf('no-images') !== -1;
      var minW     = isCompact ? 140 : 170;
      var cols     = Math.max(1, Math.floor((gridW + gap) / (minW + gap)));
      var rows     = Math.ceil(toRemove / cols);
      var addH     = rows * (cardH + gap);

      /* Remove cards do topo */
      var cur = _spacer ? _spacer.nextSibling : (_grid ? _grid.firstChild : null);
      var removed = 0;
      var buf = [];
      while (cur && removed < toRemove) {
        var nxt = cur.nextSibling;
        if (cur !== _sentinel && cur !== _spacer) { buf.push(cur); removed++; }
        cur = nxt;
      }
      for (var d = 0; d < buf.length; d++) _grid.removeChild(buf[d]);
      _rStart += removed;

      /* Atualiza spacer */
      _spacerH += addH;
      if (_spacer) _spacer.style.height = _spacerH + 'px';
    }

    function _findScrollParent(el) {
      var node = el ? el.parentNode : null;
      while (node && node !== document.body && node !== document.documentElement) {
        try {
          var s = window.getComputedStyle ? window.getComputedStyle(node) :
                  (node.currentStyle || {});
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
        var now = (Date.now ? Date.now() : new Date().getTime());
        var rem = ms - (now - last);
        if (rem <= 0) {
          last = now;
          try { fn(); } catch(e) {}
        } else if (!timer) {
          timer = setTimeout(function () {
            last = (Date.now ? Date.now() : new Date().getTime());
            timer = null;
            try { fn(); } catch(e) {}
          }, rem);
        }
      };
    }

    return { init: init, append: append, destroy: destroy };
  })();


  /* ─── CATEGORIAS ────────────────────────────────────────── */
  function renderCategoryFilter(container, categories, onSelect) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();
    var allBtn = el('div', { className: 'cat-btn active', textContent: 'Todos', tabIndex: 0, role: 'button' });
    allBtn.dataset.catId = '';
    frag.appendChild(allBtn);
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var cleanName = (cat.categoryname || '').replace(/[^\x20-\x7E\u00C0-\u024F]/g, '').trim();
      var btn = el('div', { className: 'cat-btn', textContent: cleanName, tabIndex: 0, role: 'button' });
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
          thumb = el('img', { className: 'search-result-thumb', alt: item.name || '' });
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
    destroyVirtualScroll: destroyVirtualScroll,
    Pager: Pager
  };

})();