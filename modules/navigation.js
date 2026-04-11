/**
 * navigation.js – Navegação por controle remoto
 * Gerencia foco entre elementos e troca de telas com setas + OK + Voltar
 */

var Navigation = (function () {
  'use strict';

  /* Mapeamento de teclas do controle remoto de Smart TV */
  var KEYS = {
    UP:       [38, 303],  // Arrow Up
    DOWN:     [40, 304],  // Arrow Down
    LEFT:     [37, 301],  // Arrow Left
    RIGHT:    [39, 302],  // Arrow Right
    OK:       [13, 32, 195],  // Enter, Space, OK
    BACK:     [8, 461, 196, 27],  // Backspace, Back, Escape
    PLAY:     [415, 179],
    PAUSE:    [19, 179],
    PLAY_PAUSE:[415, 179, 80],
    MENU:     [457, 36],
    INFO:     [457]
  };

  var _history = [];  // Histórico de telas para o "voltar"
  var _currentScreen = 'login';
  var _focusableSelector = 'button:not([disabled]), [tabindex="0"], input, select';
  var _lastFocus = {};  // Mapa: screenId -> último elemento focado

  function init() {
    document.addEventListener('keydown', _handleKey, false);
  }

  function _handleKey(e) {
    var code = e.keyCode || e.which;

    // --- Voltar ---
    if (_matchKey(code, KEYS.BACK)) {
      e.preventDefault();
      App.goBack();
      return;
    }

    // --- Player: controles especiais ---
    if (_currentScreen === 'player') {
      if (_matchKey(code, KEYS.PLAY_PAUSE) || _matchKey(code, KEYS.PLAY) || _matchKey(code, KEYS.PAUSE)) {
        e.preventDefault();
        Player.togglePlayPause();
        return;
      }
    }

    // --- Navegação por setas ---
    if (_matchKey(code, KEYS.UP))    { e.preventDefault(); _moveFocus('up');    return; }
    if (_matchKey(code, KEYS.DOWN))  { e.preventDefault(); _moveFocus('down');  return; }
    if (_matchKey(code, KEYS.LEFT))  { e.preventDefault(); _moveFocus('left');  return; }
    if (_matchKey(code, KEYS.RIGHT)) { e.preventDefault(); _moveFocus('right'); return; }

    // --- OK / Enter: já tratado nativamente pelo browser, mas garante foco visível ---
    if (_matchKey(code, KEYS.OK)) {
      var focused = document.activeElement;
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
   * Move o foco na direção indicada
   * Algoritmo: encontra o elemento focalizável mais próximo na direção
   */
  function _moveFocus(direction) {
    var focused = document.activeElement;
    var focusables = _getFocusables();

    if (!focusables.length) return;

    if (!focused || !document.contains(focused)) {
      focusables[0].focus();
      return;
    }

    var currentRect = focused.getBoundingClientRect();
    var bestEl = null;
    var bestScore = Infinity;

    for (var i = 0; i < focusables.length; i++) {
      var el = focusables[i];
      if (el === focused) continue;

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

  /**
   * Calcula score de proximidade direcional
   * Retorna null se o elemento não está na direção correta
   */
  function _calcDirectionScore(from, to, direction) {
    var fromCX = from.left + from.width / 2;
    var fromCY = from.top + from.height / 2;
    var toCX   = to.left + to.width / 2;
    var toCY   = to.top + to.height / 2;

    var dx = toCX - fromCX;
    var dy = toCY - fromCY;

    var threshold = 20; // px de tolerância

    switch (direction) {
      case 'up':
        if (to.bottom > from.top + threshold) return null;
        return Math.abs(dy) + Math.abs(dx) * 0.3;
      case 'down':
        if (to.top < from.bottom - threshold) return null;
        return Math.abs(dy) + Math.abs(dx) * 0.3;
      case 'left':
        if (to.right > from.left + threshold) return null;
        return Math.abs(dx) + Math.abs(dy) * 0.3;
      case 'right':
        if (to.left < from.right - threshold) return null;
        return Math.abs(dx) + Math.abs(dy) * 0.3;
    }
    return null;
  }

  /**
   * Retorna todos os elementos focalizáveis na tela ativa
   */
  function _getFocusables() {
    var screenId = 'screen-' + _currentScreen;
    var screen = document.getElementById(screenId);
    if (!screen) screen = document.body;

    var all = screen.querySelectorAll(_focusableSelector);
    var visible = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (_isVisible(el)) visible.push(el);
    }
    return visible;
  }

  function _isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function _scrollIntoView(el) {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (e) {
      try { el.scrollIntoView(false); } catch (e2) {}
    }
  }

  /* --- Gestão de telas --- */

  function setScreen(name) {
    _currentScreen = name;
  }

  function pushHistory(name) {
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

  /**
   * Aplica foco inicial ao abrir uma tela
   */
  function focusFirst(screenId) {
    setTimeout(function () {
      var screen = screenId ? document.getElementById('screen-' + screenId) : document.body;
      if (!screen) return;
      var focusables = screen.querySelectorAll(_focusableSelector);
      for (var i = 0; i < focusables.length; i++) {
        if (_isVisible(focusables[i])) {
          try { focusables[i].focus(); } catch(e){}
          break;
        }
      }
    }, 80);
  }

  return {
    init:               init,
    setScreen:          setScreen,
    pushHistory:        pushHistory,
    popHistory:         popHistory,
    getCurrentHistory:  getCurrentHistory,
    clearHistory:       clearHistory,
    focusFirst:         focusFirst,
    moveFocus:          _moveFocus
  };
})();
