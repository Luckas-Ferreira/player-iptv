/**
 * navigation.js — Navegação por controle remoto (Smart TV)
 * v3 — adiciona zona .cw-cards (faixa Continuar Assistindo)
 *      corrige scroll horizontal da faixa ao navegar com setas
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

  /* ══════════════════════════════════════
     Init
  ══════════════════════════════════════ */
  function init() {
    document.addEventListener('keydown', _handleKey, false);
  }

  /* ══════════════════════════════════════
     Handler principal de teclas
  ══════════════════════════════════════ */
  function _handleKey(e) {
    var code = e.keyCode || e.which;
    var focused = document.activeElement;
    var isInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA');

    if (isInput) {
      if (code === 8) return;                    // backspace — deixa o input tratar
      if (code === 37 || code === 39) return;    // setas esq/dir — deixa o input tratar
      if (code === 13 || code === 195) {
        // Se for o input de busca, NÃO faz nada — o app.js já capturou no capture phase
        if (focused.id === 'header-search-input') return;
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
      if (_matchKey(code, KEYS.LEFT)) {
        e.preventDefault();
        Player.seek(-30);
        return;
      }
      if (_matchKey(code, KEYS.RIGHT)) {
        e.preventDefault();
        Player.seek(30);
        return;
      }
    }

    if (_matchKey(code, KEYS.UP)) { e.preventDefault(); _moveFocus('up'); return; }
    if (_matchKey(code, KEYS.DOWN)) { e.preventDefault(); _moveFocus('down'); return; }
    if (_matchKey(code, KEYS.LEFT)) { e.preventDefault(); _moveFocus('left'); return; }
    if (_matchKey(code, KEYS.RIGHT)) { e.preventDefault(); _moveFocus('right'); return; }

    if (_matchKey(code, KEYS.OK)) {
      if (focused && (focused.tagName === 'DIV' || focused.tagName === 'LI' || focused.tagName === 'BUTTON')) {
        e.preventDefault();
        focused.click();
      }
      return;
    }
  }

  function _matchKey(code, keyCodes) {
    return keyCodes.indexOf(code) !== -1;
  }

  /* ══════════════════════════════════════
     Constraints de navegação por zona
  ══════════════════════════════════════ */
  function _getConstraints(focused, direction) {
    if (!focused) return null;

    var inCW = focused.closest && focused.closest('.cw-cards');
    var inTopbar = focused.closest && focused.closest('.topbar');
    var inCategory = focused.closest && focused.closest('.category-sidebar');
    var inGrid = focused.closest && focused.closest('.content-grid');
    var inSettings = focused.closest && focused.closest('.settings-container');
    var inEpisodes = focused.closest && focused.closest('.episodes-panel');

    /* ── Faixa Continuar Assistindo ── */
    if (inCW) {
      if (direction === 'left') return ['.cw-cards', '.category-sidebar'];
      if (direction === 'right') return ['.cw-cards'];
      if (direction === 'up') return ['.topbar'];
      if (direction === 'down') return ['.cw-cards', '.content-grid', '.content-empty'];
    }

    /* ── Topbar (Antiga Sidebar) ── */
    if (inTopbar) {
      if (direction === 'left' || direction === 'right') return ['.topbar'];
      if (direction === 'down') return ['.category-sidebar', '.cw-cards', '.content-grid', '.settings-container'];
      if (direction === 'up') return ['.topbar'];
    }

    /* ── Category Sidebar ── */
    if (inCategory) {
      if (direction === 'up' || direction === 'down') return ['.category-sidebar', '.topbar'];
      if (direction === 'right') return ['.cw-cards', '.content-grid', '.content-empty', '.content-header'];
      if (direction === 'left') return ['.category-sidebar'];
    }

    /* ── Grid principal ── */
    if (inGrid) {
      if (direction === 'left') return ['.content-grid', '.category-sidebar'];
      if (direction === 'right') return ['.content-grid'];
      if (direction === 'up') return ['.content-grid', '.cw-cards', '.topbar', '.content-header'];
      /* sem constraint para baixo — scroll livre */
    }

    /* ── Settings ── */
    if (inSettings) {
      if (direction === 'up') return ['.settings-container', '.topbar'];
      return ['.settings-container'];
    }

    /* ── Painel de episódios ── */
    if (inEpisodes) {
      return ['.episodes-panel', '.detail-content'];
    }

    return null;
  }

  /* ══════════════════════════════════════
     Movimento de foco
  ══════════════════════════════════════ */
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

  /* ══════════════════════════════════════
     Score direcional
  ══════════════════════════════════════ */
  function _calcDirectionScore(from, to, direction) {
    var fromCX = from.left + from.width / 2;
    var fromCY = from.top + from.height / 2;
    var toCX = to.left + to.width / 2;
    var toCY = to.top + to.height / 2;
    var dx = toCX - fromCX;
    var dy = toCY - fromCY;
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

  /* ══════════════════════════════════════
     Focusables visíveis
  ══════════════════════════════════════ */
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

  /* ══════════════════════════════════════
     Scroll inteligente ao focar elemento
     — respeita header fixo
     — faz scroll horizontal na faixa CW
  ══════════════════════════════════════ */
  function _scrollIntoView(el) {
    try {
      /* Scroll horizontal para faixa Continuar Assistindo */
      var cwRow = el.closest && el.closest('.cw-cards');
      if (cwRow) {
        var elRect = el.getBoundingClientRect();
        var rowRect = cwRow.getBoundingClientRect();
        var elLeft = elRect.left - rowRect.left + cwRow.scrollLeft;
        var elRight = elLeft + elRect.width;
        var viewLeft = cwRow.scrollLeft;
        var viewRight = cwRow.scrollLeft + cwRow.clientWidth;

        if (elLeft < viewLeft + 8) {
          cwRow.scrollLeft = elLeft - 8;
        } else if (elRight > viewRight - 8) {
          cwRow.scrollLeft = elRight - cwRow.clientWidth + 8;
        }
        /* Também rola verticalmente para garantir que a faixa esteja visível */
      }

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
          scrollParent.scrollTop = elTop - headerH - 8;
        } else if (elBottom > viewBot) {
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

  /* ══════════════════════════════════════
     Gestão de telas / histórico
  ══════════════════════════════════════ */
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