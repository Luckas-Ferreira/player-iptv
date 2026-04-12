/**
 * navigation.js — Navegação por controle remoto (Smart TV)
 * v2 — corrige: scroll topo, z-index header, sem ícones quebrados
 */

var Navigation = (function () {
  'use strict';

  var KEYS = {
    UP: [38, 303],
    DOWN: [40, 304],
    LEFT: [37, 301],
    RIGHT: [39, 302],
    OK: [13, 32, 195],
    BACK: [8, 461, 196, 27],
    PLAY: [415, 179],
    PAUSE: [19, 179],
    PLAY_PAUSE: [415, 179, 80],
    MENU: [457, 36],
    INFO: [457]
  };

  var _history = [];
  var _currentScreen = 'login';
  var _focusableSelector = 'button:not([disabled]), [tabindex="0"], input, select';

  function init() {
    document.addEventListener('keydown', _handleKey, false);
  }

  function _handleKey(e) {
    var code = e.keyCode || e.which;
    var focused = document.activeElement;
    var isInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');

    if (isInput) {
      if (code === 8) return;
      if (code === 37 || code === 39) return;
      if (code === 13 || code === 195) {
        e.preventDefault();
        focused.blur();
        return;
      }
    }

    if (_matchKey(code, KEYS.BACK)) {
      e.preventDefault();
      App.goBack();
      return;
    }

    if (_currentScreen === 'player') {
      if (_matchKey(code, KEYS.PLAY_PAUSE) || _matchKey(code, KEYS.PLAY) || _matchKey(code, KEYS.PAUSE)) {
        e.preventDefault();
        Player.togglePlayPause();
        return;
      }
    }

    if (_matchKey(code, KEYS.UP)) { e.preventDefault(); _moveFocus('up'); return; }
    if (_matchKey(code, KEYS.DOWN)) { e.preventDefault(); _moveFocus('down'); return; }
    if (_matchKey(code, KEYS.LEFT)) { e.preventDefault(); _moveFocus('left'); return; }
    if (_matchKey(code, KEYS.RIGHT)) { e.preventDefault(); _moveFocus('right'); return; }

    if (_matchKey(code, KEYS.OK)) {
      if (focused && (focused.tagName === 'DIV' || focused.tagName === 'LI')) {
        e.preventDefault();
        focused.click();
      }
      return;
    }
  }

  function _matchKey(code, keyCodes) {
    return keyCodes.indexOf(code) !== -1;
  }

  /**
   * Constraints de navegação por zona.
   * FIX: sidebar UP não bloqueia mais — permite chegar ao topo.
   * FIX: grid UP pode subir para category-filter corretamente.
   */
  function _getConstraints(focused, direction) {
    if (!focused) return null;
    var inSidebar = focused.closest && focused.closest('.sidebar');
    var inCategory = focused.closest && focused.closest('.category-filter');
    var inGrid = focused.closest && focused.closest('.content-grid');
    var inSettings = focused.closest && focused.closest('.settings-container');
    var inEpisodes = focused.closest && focused.closest('.episodes-panel');

    if (inSidebar) {
      if (direction === 'right') return ['.main-content'];
      if (direction === 'left') return [];           /* borda esquerda — não sai */
      if (direction === 'up' || direction === 'down') return ['.sidebar']; /* FIX: fica na sidebar */
    }

    if (inCategory) {
      if (direction === 'left') return ['.category-filter', '.sidebar'];
      if (direction === 'right') return ['.category-filter'];
      if (direction === 'down') return ['.content-grid', '.content-empty'];
      if (direction === 'up') return ['.content-header', '.sidebar']; /* FIX: sobe pro header/sidebar */
    }

    if (inGrid) {
      if (direction === 'left') return ['.content-grid', '.sidebar'];
      if (direction === 'right') return ['.content-grid'];
      /* FIX: ao subir do grid, permite chegar ao category-filter ou header */
      if (direction === 'up') return ['.content-grid', '.category-filter', '.content-header'];
      /* sem constraint para baixo — deixa scrollar livremente */
    }

    if (inSettings) {
      return ['.settings-container', '.sidebar'];
    }

    if (inEpisodes) {
      return ['.episodes-panel', '.detail-content'];
    }

    return null;
  }

  function _moveFocus(direction) {
    var focused = document.activeElement;
    var focusables = _getFocusables();

    if (!focusables.length) return;

    if (!focused || !document.contains(focused)) {
      focusables[0].focus();
      return;
    }

    var constraints = _getConstraints(focused, direction);
    var currentRect = focused.getBoundingClientRect();
    var bestEl = null;
    var bestScore = Infinity;

    for (var i = 0; i < focusables.length; i++) {
      var el = focusables[i];
      if (el === focused) continue;

      if (constraints) {
        var allowed = false;
        for (var c = 0; c < constraints.length; c++) {
          if (constraints[c] === '') { allowed = false; break; }
          if (el.closest && el.closest(constraints[c])) { allowed = true; break; }
        }
        if (!allowed) continue;
      }

      var rect = el.getBoundingClientRect();
      var score = _calcDirectionScore(currentRect, rect, direction);

      if (score !== null && score < bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl) {
      bestEl.focus();
      _scrollIntoView(bestEl);
    }
  }

  function _calcDirectionScore(from, to, direction) {
    var fromCX = from.left + from.width / 2;
    var fromCY = from.top + from.height / 2;
    var toCX = to.left + to.width / 2;
    var toCY = to.top + to.height / 2;
    var dx = toCX - fromCX;
    var dy = toCY - fromCY;
    /* Tolerância aumentada para grids onde linhas podem não alinhar perfeitamente */
    var tol = 12;

    switch (direction) {
      case 'up':
        if (dy > -tol) return null;
        return Math.abs(dy) + Math.abs(dx) * 0.5;
      case 'down':
        if (dy < tol) return null;
        return Math.abs(dy) + Math.abs(dx) * 0.5;
      case 'left':
        if (dx > -tol) return null;
        return Math.abs(dx) + Math.abs(dy) * 0.5;
      case 'right':
        if (dx < tol) return null;
        return Math.abs(dx) + Math.abs(dy) * 0.5;
    }
    return null;
  }

  function _getFocusables() {
    var visible = [];

    function _collect(container) {
      if (!container) return;
      var all = container.querySelectorAll(_focusableSelector);
      for (var i = 0; i < all.length; i++) {
        if (_isVisible(all[i])) visible.push(all[i]);
      }
    }

    var mainScreen = document.getElementById('screen-' + _currentScreen) || document.body;
    _collect(mainScreen);
    return visible;
  }

  function _isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * FIX scroll: garante que o elemento focado fique visível,
   * mas respeita o header fixo calculando o offset real.
   */
  function _scrollIntoView(el) {
    try {
      var header = document.querySelector('.content-header');
      var headerH = header ? header.offsetHeight : 0;
      var rect = el.getBoundingClientRect();
      var scrollParent = _getScrollParent(el);

      if (scrollParent) {
        var parentRect = scrollParent.getBoundingClientRect();
        var elTop = rect.top - parentRect.top + scrollParent.scrollTop;
        var elBottom = elTop + rect.height;
        var viewTop = scrollParent.scrollTop + headerH + 8;
        var viewBot = scrollParent.scrollTop + scrollParent.clientHeight - 8;

        if (elTop < viewTop) {
          /* Subindo: posiciona abaixo do header */
          scrollParent.scrollTop = elTop - headerH - 8;
        } else if (elBottom > viewBot) {
          /* Descendo: posiciona com folga inferior */
          scrollParent.scrollTop = elBottom - scrollParent.clientHeight + 8;
        }
        return;
      }
    } catch (err) { }

    /* fallback */
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (e) {
      try { el.scrollIntoView(false); } catch (e2) { }
    }
  }

  function _getScrollParent(el) {
    var node = el.parentNode;
    while (node && node !== document.body) {
      var style = window.getComputedStyle(node);
      var overflow = style.overflow + style.overflowY;
      if (/auto|scroll/.test(overflow) && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  /* --- Gestão de telas --- */

  function setScreen(name) {
    _currentScreen = name;
  }

  function pushHistory(name) {
    if (!_history) _history = [];
    if (_history[_history.length - 1] !== name) {
      _history.push(name);
    }
  }

  function popHistory() {
    if (_history.length > 1) {
      _history.pop();
      return _history[_history.length - 1];
    }
    return _history[0] || 'main';
  }

  function getCurrentHistory() {
    return _history[_history.length - 1];
  }

  function clearHistory() {
    _history = [];
  }

  function focusFirst(screenId) {
    setTimeout(function () {
      var screen = screenId ? document.getElementById('screen-' + screenId) : document.body;
      if (!screen) return;
      var focusables = screen.querySelectorAll(_focusableSelector);
      for (var i = 0; i < focusables.length; i++) {
        if (_isVisible(focusables[i])) {
          try { focusables[i].focus(); } catch (e) { }
          break;
        }
      }
    }, 80);
  }

  return {
    init: init,
    setScreen: setScreen,
    pushHistory: pushHistory,
    popHistory: popHistory,
    getCurrentHistory: getCurrentHistory,
    clearHistory: clearHistory,
    focusFirst: focusFirst,
    moveFocus: _moveFocus
  };
})();
