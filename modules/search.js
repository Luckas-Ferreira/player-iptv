/**
 * search.js – Busca local com debounce
 * Busca entre todos os itens carregados em memória
 */

var Search = (function () {
  'use strict';

  var _tabItems = [];
  var _globalItems = [];
  var _debounceTimer = null;
  var _debounceDelay = 300;

  function setTabData(items) {
    _tabItems = items || [];
  }

  function setGlobalData(items) {
    _globalItems = items || [];
  }

  function _doSearch(q, dataset) {
    q = (q || '').toLowerCase().trim();
    if (!q) return [];

    var results = [];
    var max = 150; /* Limitado para não travar a TV */
    var len = dataset.length;

    for (var i = 0; i < len && results.length < max; i++) {
      var item = dataset[i];
      var name = (item.name || '').toLowerCase();
      if (name.indexOf(q) !== -1) {
        results.push(item);
      }
    }

    results.sort(function (a, b) {
      var aStart = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      var bStart = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return aStart - bStart;
    });

    return results;
  }

  function debouncedTabQuery(q, callback) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      if (callback) callback(_doSearch(q, _tabItems), q);
    }, _debounceDelay);
  }

  function debouncedGlobalQuery(q, callback) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      if (callback) callback(_doSearch(q, _globalItems), q);
    }, _debounceDelay);
  }

  function initSearchTab(onPlay) {
    var input = document.getElementById('search-input');
    var resultsContainer = document.getElementById('search-results');
    var emptyEl = document.getElementById('search-empty');

    if (!input || !resultsContainer) return;

    emptyEl.classList.remove('hidden');

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (!q) {
        resultsContainer.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      debouncedGlobalQuery(q, function (results) {
        Renderer.renderSearchResults(resultsContainer, results, onPlay);
        if (results.length === 0) {
          resultsContainer.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;font-size:18px;">Nenhum resultado para "' + q + '"</p>';
        }
      });
    });

    setTimeout(function () { try { input.focus(); } catch(e){} }, 100);
  }

  function initInlineSearch(onResults) {
    var input = document.getElementById('inline-search');
    if (!input) return;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (onResults) {
        if (!q) {
          onResults(null); 
        } else {
          debouncedTabQuery(q, function (results) {
            onResults(results, q);
          });
        }
      }
    });
  }

  return {
    setTabData:       setTabData,
    setGlobalData:    setGlobalData,
    initSearchTab:    initSearchTab,
    initInlineSearch: initInlineSearch
  };
})();
