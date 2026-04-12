/**
 * renderer.js – Renderização de cards, grades e componentes visuais
 *
 * MUDANÇAS:
 * 1. renderGrid(container, items, callbacks, append?)
 *    append=true → acrescenta ao grid existente sem limpar (usado no streaming).
 * 2. setLoadingMore(show) — spinner de "carregando mais" no rodapé da grade.
 * 3. _lazyLoadImg usa IntersectionObserver com rootMargin generoso (400px)
 *    para pré-carregar imagens antes de entrar na tela.
 */

var Renderer = (function () {
  'use strict';

  /* ═══════════════════════ CARD ═══════════════════════ */

  function createCard(item, callbacks) {
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var name = item.name || 'Sem Nome';
    var type = item._type || 'live';
    var category = item.category_name || item.group || '';
    var icon = item.stream_icon || item.cover || item.series_cover || '';
    var isPortrait = (type === 'movie' || type === 'series');
    var isFav = Storage.isFavorite(id);

    var card = _el('div', { className: 'card', role: 'listitem', tabIndex: 0, 'aria-label': name });

    /* Imagem ou placeholder */
    var thumb;
    if (icon) {
      thumb = _el('img', {
        className: 'card-thumb' + (isPortrait ? ' portrait' : ''),
        alt: name,
        width: isPortrait ? '120' : '160',
        height: isPortrait ? '180' : '90',
        loading: 'lazy'
      });
      _lazyLoadImg(thumb, icon);
    } else {
      thumb = createPlaceholder(type, name, isPortrait);
    }
    card.appendChild(thumb);

    /* Badge AO VIVO */
    if (type === 'live') {
      card.appendChild(_el('div', { className: 'card-live-badge', textContent: 'AO VIVO' }));
    }

    /* Indicador favorito */
    var favBtn = _el('div', {
      className: 'card-fav' + (isFav ? ' is-fav' : ''),
      textContent: isFav ? '\u2605' : '\u2606'
    });
    card.appendChild(favBtn);

    /* Corpo */
    var body = _el('div', { className: 'card-body' });
    var title = _el('p', { className: 'card-title', textContent: name });
    var cat = _el('p', { className: 'card-category', textContent: category });
    body.appendChild(title); body.appendChild(cat);
    card.appendChild(body);

    /* Long-press (3s) → favoritar */
    var _lpTimer = null, _lpStart = 0, _lpRaf = null, _ignorePlay = false, _isKeyDown = false;

    card.addEventListener('click', function (e) {
      if (e.target === favBtn || favBtn.contains(e.target)) return;
      if (_ignorePlay) return;
      if (callbacks && callbacks.onPlay) callbacks.onPlay(item);
    });

    function _cancelLP() {
      clearTimeout(_lpTimer); cancelAnimationFrame(_lpRaf);
      _lpTimer = null; card.classList.remove('lp-active'); card.style.removeProperty('--lp-pct');
    }
    function _tickLP() {
      if (!_lpTimer) return;
      var pct = Math.min(100, ((Date.now() - _lpStart) / 3000) * 100);
      card.style.setProperty('--lp-pct', pct + '%');
      if (pct < 100) _lpRaf = requestAnimationFrame(_tickLP);
    }

    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault(); e.stopPropagation();
        if (_isKeyDown) return;
        _isKeyDown = true; _ignorePlay = false;
        _lpStart = Date.now(); card.classList.add('lp-active');
        _lpRaf = requestAnimationFrame(_tickLP);
        _lpTimer = setTimeout(function () {
          _lpTimer = null; _ignorePlay = true; _cancelLP();
          var nowFav = Storage.toggleFavorite(item);
          favBtn.textContent = nowFav ? '\u2605' : '\u2606';
          favBtn.className = 'card-fav' + (nowFav ? ' is-fav' : '');
          if (callbacks && callbacks.onFavorite) callbacks.onFavorite(item, nowFav);
          Renderer.showToast(nowFav ? '\u2605 Adicionado aos favoritos' : '\u2606 Removido dos favoritos', nowFav ? 'success' : 'info');
          setTimeout(function () { _ignorePlay = false; }, 500);
        }, 3000);
      }
    });

    card.addEventListener('keyup', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32 || e.keyCode === 195) {
        e.preventDefault(); _isKeyDown = false;
        if (_lpTimer) {
          _cancelLP();
          if (!_ignorePlay && callbacks && callbacks.onPlay) callbacks.onPlay(item);
        }
      }
    });

    card.addEventListener('blur', function () { _isKeyDown = false; _cancelLP(); });

    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nf = Storage.toggleFavorite(item);
      favBtn.textContent = nf ? '\u2605' : '\u2606';
      favBtn.className = 'card-fav' + (nf ? ' is-fav' : '');
      if (callbacks && callbacks.onFavorite) callbacks.onFavorite(item, nf);
    });

    return card;
  }

  function createPlaceholder(type, name, portrait) {
    var icons = { live: '📺', movie: '🎬', series: '🎭' };
    var div = _el('div', { className: 'card-placeholder' + (portrait ? ' portrait' : '') });
    div.appendChild(_el('div', { className: 'card-placeholder-icon', textContent: icons[type] || '🎞' }));
    div.appendChild(_el('div', { className: 'card-placeholder-text', textContent: _truncate(name, 24) }));
    return div;
  }

  /* ═══════════════════════ GRADE ═══════════════════════
     append=true → adiciona ao container sem limpar o HTML existente.
     Usado pelo streaming progressivo para acrescentar lotes.           */

  function renderGrid(container, items, callbacks, append) {
    if (!append) container.innerHTML = '';
    if (!items || items.length === 0) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) frag.appendChild(createCard(items[i], callbacks));
    container.appendChild(frag);
  }

  /* ═══════════════════════ CATEGORIAS ═══════════════════════ */

  function renderCategoryFilter(container, categories, onSelect) {
    container.innerHTML = '';
    var frag = document.createDocumentFragment();
    var allBtn = _el('button', { className: 'cat-btn active', textContent: 'Todos', tabIndex: 0 });
    allBtn.dataset.catId = '';
    frag.appendChild(allBtn);
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var btn = _el('button', { className: 'cat-btn', textContent: cat.category_name, tabIndex: 0 });
      btn.dataset.catId = cat.category_id;
      frag.appendChild(btn);
    }
    container.appendChild(frag);
    container.addEventListener('click', function (e) {
      if (!e.target.classList.contains('cat-btn')) return;
      var allBtns = container.querySelectorAll('.cat-btn');
      for (var j = 0; j < allBtns.length; j++) {
        allBtns[j].classList.remove('active');
      }
      e.target.classList.add('active');
      if (onSelect) onSelect(e.target.dataset.catId);
    });
  }

  /* ═══════════════════════ BUSCA ═══════════════════════ */

  function renderSearchResults(container, items, onPlay) {
    container.innerHTML = '';
    if (!items || !items.length) return;
    var frag = document.createDocumentFragment();
    var labels = { live: 'Ao Vivo', movie: 'Filme', series: 'Série' };
    var cls = { live: 'type-live', movie: 'type-movie', series: 'type-series' };
    for (var i = 0; i < items.length; i++) {
        (function(item) {
          var type = item._type || 'live';
          var icon = item.stream_icon || item.cover || item.series_cover || '';
          var row = _el('div', { className: 'search-result-item', role: 'listitem', tabIndex: 0, 'aria-label': item.name });
          var thumb;
          if (icon) {
            thumb = _el('img', { className: 'search-result-thumb', alt: item.name, loading: 'lazy' });
            _lazyLoadImg(thumb, icon);
          } else {
            thumb = _el('div', {
              className: 'search-result-thumb',
              style: 'display:flex;align-items:center;justify-content:center;font-size:28px;background:var(--bg-input);border-radius:8px;'
            });
            thumb.textContent = type === 'live' ? '📺' : type === 'movie' ? '🎬' : '🎭';
          }
          row.appendChild(thumb);
          var info = _el('div', { className: 'search-result-info' });
          var titleEl = _el('div', { className: 'search-result-title', textContent: item.name });
          var metaEl = _el('div', { className: 'search-result-meta', textContent: item.category_name || item.group || '' });
          info.appendChild(titleEl); info.appendChild(metaEl);
          row.appendChild(info);
          row.appendChild(_el('div', { className: 'search-result-type ' + (cls[type] || 'type-live'), textContent: labels[type] || 'Live' }));
          
          row.addEventListener('click', function () { if (onPlay) onPlay(item); });
          row.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); if (onPlay) onPlay(item); } });
          
          frag.appendChild(row);
        })(items[i]);
    }
    container.appendChild(frag);
  }

  /* ═══════════════════════ TOAST ═══════════════════════ */

  function showToast(message, type, duration) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = _el('div', { className: 'toast toast-' + (type || 'info'), textContent: message });
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, duration || 3000);
  }

  /* ═══════════════════════ ESTADO ═══════════════════════ */

  function setLoading(show) {
    var loading = document.getElementById('content-loading');
    var grid = document.getElementById('content-grid');
    if (!loading || !grid) return;
    if (show) { loading.classList.remove('hidden'); grid.style.display = 'none'; }
    else { loading.classList.add('hidden'); grid.style.display = ''; }
  }

  function setEmpty(show) {
    var el = document.getElementById('content-empty');
    if (!el) return;
    if (show) el.classList.remove('hidden'); else el.classList.add('hidden');
  }

  /* Spinner de "carregando mais" no rodapé da grade */
  function setLoadingMore(show) {
    var el = document.getElementById('loading-more');
    if (!el) {
      /* Cria o elemento se não existir */
      el = document.createElement('div');
      el.id = 'loading-more';
      el.style.cssText = 'text-align:center;padding:16px;color:var(--text-secondary,#aaa);font-size:14px;';
      el.textContent = 'Carregando mais…';
      var grid = document.getElementById('content-grid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid.nextSibling);
    }
    el.style.display = show ? 'block' : 'none';
  }

  /* ═══════════════════════ UTILITÁRIOS ═══════════════════════ */

  function _el(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'textContent') el.textContent = attrs[k];
        else if (k === 'className') el.className = attrs[k];
        else if (k === 'style') el.style.cssText = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    return el;
  }

  /* Lazy load com IntersectionObserver (rootMargin 400px = pré-carrega antes de entrar na tela) */
  function _lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries, o) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var img = entry.target;
          img.src = img.getAttribute('data-src') || '';
          img.onerror = function () {
            var parent = img.parentNode;
            if (parent) parent.replaceChild(createPlaceholder('live', img.alt || '', false), img);
          };
          o.unobserve(img);
        }
      }, { rootMargin: '400px 0px' });
      obs.observe(imgEl);
    } else {
      /* Fallback para browsers antigos sem IntersectionObserver */
      imgEl.src = src;
      imgEl.onerror = function () {
        var parent = imgEl.parentNode;
        if (parent) parent.replaceChild(createPlaceholder('live', imgEl.alt || '', false), imgEl);
      };
    }
  }

  function _truncate(s, max) {
    s = s || ''; return s.length > max ? s.substring(0, max) + '\u2026' : s;
  }

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
    _el: _el,
    _lazyLoadImg: _lazyLoadImg
  };
})();
