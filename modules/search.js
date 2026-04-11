/**
 * search.js – Busca local com debounce
 * Busca entre todos os itens carregados em memória
 */

var Search = (function () {
  'use strict';

  var _allItems = [];
  var _debounceTimer = null;
  var _debounceDelay = 300;

  /**
   * Define o dataset de busca
   */
  function setData(items) {
    _allItems = items || [];
  }

  /**
   * Adiciona mais itens ao dataset
   */
  function appendData(items) {
    if (!items || !items.length) return;
    _allItems = _allItems.concat(items);
  }

  /**
   * Limpa o dataset
   */
  function clearData() {
    _allItems = [];
  }

  /**
   * Busca imediata por query string
   * Retorna array de resultados (máx. 50)
   */
  function query(q) {
    q = (q || '').toLowerCase().trim();
    if (!q) return [];

    var results = [];
    var max = 60;
    var len = _allItems.length;

    for (var i = 0; i < len && results.length < max; i++) {
      var item = _allItems[i];
      var name = (item.name || '').toLowerCase();
      if (name.indexOf(q) !== -1) {
        results.push(item);
      }
    }

    // Ordena: itens que começam com a query primeiro
    results.sort(function (a, b) {
      var aStart = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      var bStart = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return aStart - bStart;
    });

    return results;
  }

  /**
   * Busca com debounce – chama callback após delay
   */
  function debouncedQuery(q, callback) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      var results = query(q);
      if (callback) callback(results, q);
    }, _debounceDelay);
  }

  /**
   * Inicializa o campo de busca principal
   */
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
      debouncedQuery(q, function (results) {
        Renderer.renderSearchResults(resultsContainer, results, onPlay);
        if (results.length === 0) {
          resultsContainer.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;font-size:18px;">Nenhum resultado para "' + q + '"</p>';
        }
      });
    });

    // Foco automático quando a aba é aberta
    setTimeout(function () { try { input.focus(); } catch(e){} }, 100);
  }

  /**
   * Inicializa busca inline (no header)
   */
  function initInlineSearch(onResults) {
    var input = document.getElementById('inline-search');
    if (!input) return;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (onResults) {
        if (!q) {
          onResults(null); // restaurar listagem normal
        } else {
          debouncedQuery(q, function (results) {
            onResults(results, q);
          });
        }
      }
    });
  }

  return {
    setData:          setData,
    appendData:       appendData,
    clearData:        clearData,
    query:            query,
    debouncedQuery:   debouncedQuery,
    initSearchTab:    initSearchTab,
    initInlineSearch: initInlineSearch
  };
})();
