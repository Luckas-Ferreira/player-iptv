/**
 * renderer.js – Renderização de cards, grades e componentes visuais
 */

var Renderer = (function () {
  'use strict';

  /* ═══════════════════════ CARD ═══════════════════════ */

  /**
   * Cria um card de canal/filme/série
   * @param {Object} item - item de stream
   * @param {Object} callbacks - { onPlay, onFavorite }
   */
  function createCard(item, callbacks) {
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var name = item.name || 'Sem Nome';
    var type = item._type || 'live';
    var category = item.category_name || item.group || '';
    var icon = item.stream_icon || item.cover || item.series_cover || '';
    var isPortrait = (type === 'movie' || type === 'series');
    var isFav = Storage.isFavorite(id);

    var card = _el('div', {
      className: 'card',
      role: 'listitem',
      tabIndex: 0,
      'aria-label': name
    });

    // Imagem / placeholder
    var thumb;
    if (icon) {
      thumb = _el('img', {
        className: 'card-thumb' + (isPortrait ? ' portrait' : ''),
        alt: name,
        loading: 'lazy'
      });
      // Lazy load manual para TVs antigas
      _lazyLoadImg(thumb, icon);
    } else {
      thumb = createPlaceholder(type, name, isPortrait);
    }
    card.appendChild(thumb);

    // Badge LIVE
    if (type === 'live') {
      var liveBadge = _el('div', { className: 'card-live-badge', textContent: 'AO VIVO' });
      card.appendChild(liveBadge);
    }

    // Botão de favorito
    var favBtn = _el('button', {
      className: 'card-fav' + (isFav ? ' is-fav' : ''),
      textContent: isFav ? '★' : '☆',
      tabIndex: -1,
      'aria-label': isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'
    });
    card.appendChild(favBtn);

    // Corpo do card
    var body = _el('div', { className: 'card-body' });
    var title = _el('p', { className: 'card-title', textContent: name });
    var cat = _el('p', { className: 'card-category', textContent: category });
    body.appendChild(title);
    body.appendChild(cat);
    card.appendChild(body);

    // Eventos
    card.addEventListener('click', function (e) {
      if (e.target === favBtn || favBtn.contains(e.target)) return;
      if (callbacks && callbacks.onPlay) callbacks.onPlay(item);
    });
    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 || e.keyCode === 32) {
        e.preventDefault();
        if (callbacks && callbacks.onPlay) callbacks.onPlay(item);
      }
    });
    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var nowFav = Storage.toggleFavorite(item);
      favBtn.textContent = nowFav ? '★' : '☆';
      favBtn.className = 'card-fav' + (nowFav ? ' is-fav' : '');
      if (callbacks && callbacks.onFavorite) callbacks.onFavorite(item, nowFav);
    });

    return card;
  }

  /**
   * Cria um placeholder elegante sem imagem
   */
  function createPlaceholder(type, name, portrait) {
    var icons = { live: '📺', movie: '🎬', series: '🎭' };
    var icon = icons[type] || '🎞';
    var div = _el('div', {
      className: 'card-placeholder' + (portrait ? ' portrait' : '')
    });
    var iconEl = _el('div', { className: 'card-placeholder-icon', textContent: icon });
    var textEl = _el('div', { className: 'card-placeholder-text', textContent: _truncate(name, 24) });
    div.appendChild(iconEl);
    div.appendChild(textEl);
    return div;
  }

  /* ═══════════════════════ GRADE ═══════════════════════ */

  /**
   * Renderiza lista de itens na grade
   */
  function renderGrid(container, items, callbacks) {
    container.innerHTML = '';
    if (!items || items.length === 0) return;

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      fragment.appendChild(createCard(items[i], callbacks));
    }
    container.appendChild(fragment);
  }

  /* ═══════════════════════ CATEGORIAS ═══════════════════════ */

  /**
   * Renderiza botões de filtro de categoria
   */
  function renderCategoryFilter(container, categories, onSelect) {
    container.innerHTML = '';
    var fragment = document.createDocumentFragment();

    var allBtn = _el('button', {
      className: 'cat-btn active',
      textContent: 'Todos',
      tabIndex: 0
    });
    allBtn.dataset.catId = '';
    fragment.appendChild(allBtn);

    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      var btn = _el('button', {
        className: 'cat-btn',
        textContent: cat.category_name,
        tabIndex: 0
      });
      btn.dataset.catId = cat.category_id;
      fragment.appendChild(btn);
    }

    container.appendChild(fragment);

    container.addEventListener('click', function (e) {
      var target = e.target;
      if (!target.classList.contains('cat-btn')) return;
      var btns = container.querySelectorAll('.cat-btn');
      for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
      target.classList.add('active');
      if (onSelect) onSelect(target.dataset.catId);
    });
  }

  /* ═══════════════════════ SEARCH RESULTS ═══════════════════════ */

  /**
   * Renderiza resultado de busca (lista vertical com thumb)
   */
  function renderSearchResults(container, items, onPlay) {
    container.innerHTML = '';
    if (!items || items.length === 0) return;

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var type = item._type || 'live';
      var typeLabels = { live: 'Ao Vivo', movie: 'Filme', series: 'Série' };
      var typeClasses = { live: 'type-live', movie: 'type-movie', series: 'type-series' };
      var icon = item.stream_icon || item.cover || item.series_cover || '';

      var row = _el('div', {
        className: 'search-result-item',
        role: 'listitem',
        tabIndex: 0,
        'aria-label': item.name
      });

      // Thumb
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

      // Info
      var info = _el('div', { className: 'search-result-info' });
      var titleEl = _el('div', { className: 'search-result-title', textContent: item.name });
      var metaEl = _el('div', { className: 'search-result-meta', textContent: item.category_name || item.group || '' });
      info.appendChild(titleEl);
      info.appendChild(metaEl);
      row.appendChild(info);

      // Type badge
      var typeBadge = _el('div', {
        className: 'search-result-type ' + (typeClasses[type] || 'type-live'),
        textContent: typeLabels[type] || 'Live'
      });
      row.appendChild(typeBadge);

      // Eventos
      (function (i) {
        row.addEventListener('click', function () { if (onPlay) onPlay(i); });
        row.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); if (onPlay) onPlay(i); }
        });
      })(item);

      fragment.appendChild(row);
    }
    container.appendChild(fragment);
  }

  /* ═══════════════════════ TOAST ═══════════════════════ */

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = _el('div', {
      className: 'toast toast-' + type,
      textContent: message
    });
    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, duration);
  }

  /* ═══════════════════════ UTILITÁRIOS ═══════════════════════ */

  /**
   * Cria elemento DOM com atributos
   */
  function _el(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!attrs.hasOwnProperty(key)) continue;
        if (key === 'textContent') {
          el.textContent = attrs[key];
        } else if (key === 'className') {
          el.className = attrs[key];
        } else if (key === 'style') {
          el.style.cssText = attrs[key];
        } else {
          el.setAttribute(key, attrs[key]);
        }
      }
    }
    return el;
  }

  /**
   * Lazy load de imagem com fallback para placeholder
   */
  function _lazyLoadImg(imgEl, src) {
    imgEl.setAttribute('data-src', src);
    // Usa IntersectionObserver se disponível, senão carrega direto
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            img.src = img.getAttribute('data-src');
            img.onerror = function () {
              var parent = img.parentNode;
              if (parent) {
                var ph = createPlaceholder('live', img.alt || '', false);
                parent.replaceChild(ph, img);
              }
            };
            obs.unobserve(img);
          }
        });
      }, { rootMargin: '200px' });
      observer.observe(imgEl);
    } else {
      // Fallback direto para browsers antigos
      imgEl.src = src;
      imgEl.onerror = function () {
        var parent = imgEl.parentNode;
        if (parent) {
          var ph = createPlaceholder('live', imgEl.alt || '', false);
          parent.replaceChild(ph, imgEl);
        }
      };
    }
  }

  function _truncate(str, max) {
    str = str || '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

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
    var empty = document.getElementById('content-empty');
    if (!empty) return;
    if (show) empty.classList.remove('hidden');
    else empty.classList.add('hidden');
  }

  return {
    createCard:             createCard,
    createPlaceholder:      createPlaceholder,
    renderGrid:             renderGrid,
    renderCategoryFilter:   renderCategoryFilter,
    renderSearchResults:    renderSearchResults,
    showToast:              showToast,
    setLoading:             setLoading,
    setEmpty:               setEmpty,
    _el:                    _el,
    _lazyLoadImg:           _lazyLoadImg
  };
})();
