/**
 * app.js – v5 — TV-OPTIMIZED
 * FIXES:
 * - Watchlist: _renderWatchlistRow com UI redesenhada (horizontal scroll, capa + progresso)
 * - Detail: skeleton loading + fallback de texto enquanto API carrega
 * - _openDetail: proteção quando vod_id é nulo/undefined
 * - _fillDetailUI: usa _type corretamente para montar o botão de play
 * - createCard compatível com item._type (watchlist usa _type, não type)
 */

var App = (function () {
  'use strict';

  var MAXITEMS = 100;

  var _state = {
    mode: 'xtream',
    activeTab: 'live',
    activeCategory: '',
    isSearching: false,
    lastSearchQuery: '',
    allItems: [],
    demoData: null,
    miniActive: false,
    miniItem: null,
    loadToken: 0,
    isLoggingIn: false,
    currentEpisodes: [],
    originalItems: []
  };

  /* ══════════════════════════════════════
     Inicialização
  ══════════════════════════════════════ */
  function init() {
    _applySettings();
    _updateSettingsDisplay();
    Player.init();
    Navigation.init();
    _bindLoginEvents();
    _bindMainEvents();
    _bindDetailEvents();
    _bindSettingsEvents();
    _bindSearchEvents();

    if (Auth.restoreSession()) {
      var saved = Auth.getCredentials();
      _state.mode = saved.type || 'xtream';
      _enterMain();
      return;
    }

    Navigation.pushHistory('login');
    Navigation.setScreen('login');
    Navigation.focusFirst('login');
  }

  /* ══════════════════════════════════════
     LOGIN
  ══════════════════════════════════════ */
  function _bindLoginEvents() {
    var tabX = document.getElementById('tab-xtream');
    var tabM = document.getElementById('tab-m3u');
    if (tabX) tabX.addEventListener('click', function () { _switchLoginTab('xtream'); });
    if (tabM) tabM.addEventListener('click', function () { _switchLoginTab('m3u'); });

    var btnC = document.getElementById('btn-connect');
    if (btnC) btnC.addEventListener('click', _handleLogin);

    var inputs = document.querySelectorAll('.login-form input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('keydown', function (e) { if (e.keyCode === 13) _handleLogin(); });
    }
  }

  function _switchLoginTab(type) {
    var tX = document.getElementById('tab-xtream'), tM = document.getElementById('tab-m3u');
    var fX = document.getElementById('form-xtream'), fM = document.getElementById('form-m3u');
    if (type === 'xtream') {
      tX.classList.add('active'); tX.setAttribute('aria-selected', 'true');
      tM.classList.remove('active'); tM.setAttribute('aria-selected', 'false');
      fX.classList.remove('hidden'); fM.classList.add('hidden');
    } else {
      tM.classList.add('active'); tM.setAttribute('aria-selected', 'true');
      tX.classList.remove('active'); tX.setAttribute('aria-selected', 'false');
      fM.classList.remove('hidden'); fX.classList.add('hidden');
    }
  }

  function _handleLogin() {
    if (_state.isLoggingIn) return;
    var isX = document.getElementById('tab-xtream');
    isX = isX && isX.classList.contains('active');

    _state.isLoggingIn = true;
    _setLoginStatus('Conectando…', 'loading');

    var p;
    if (isX) {
      var srv = (document.getElementById('xtream-server') || {}).value || '';
      var usr = (document.getElementById('xtream-user') || {}).value || '';
      var pwd = (document.getElementById('xtream-pass') || {}).value || '';
      if (!srv || !usr || !pwd) {
        _state.isLoggingIn = false;
        _setLoginStatus('Preencha todos os campos', 'error');
        return;
      }
      p = Auth.loginXtream(srv, usr, pwd);
    } else {
      var url = (document.getElementById('m3u-url') || {}).value || '';
      if (!url) {
        _state.isLoggingIn = false;
        _setLoginStatus('Insira uma URL M3U', 'error');
        return;
      }
      p = Auth.loginM3U(url);
    }

    p.then(function (r) {
      if (r.success) {
        _state.mode = isX ? 'xtream' : 'm3u';
        _setLoginStatus('Conectado!', 'success');
        setTimeout(function () {
          _state.isLoggingIn = false;
          _enterMain();
        }, 600);
      } else {
        _state.isLoggingIn = false;
        _setLoginStatus(r.error || 'Falha na conexão', 'error');
      }
    }).catch(function (err) {
      _state.isLoggingIn = false;
      _setLoginStatus('Erro inesperado', 'error');
      console.error('[Login]', err);
    });
  }

  function _setLoginStatus(msg, type) {
    var el = document.getElementById('login-status');
    if (!el) return;
    el.className = 'login-status' + (type ? ' ' + type : '');
    if (type === 'loading') {
      el.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></div>' + msg;
    } else { el.textContent = msg; }
  }

  /* ══════════════════════════════════════
     TELA PRINCIPAL
  ══════════════════════════════════════ */
  function _enterMain() {
    _showScreen('main');
    Navigation.pushHistory('main');

    var nameEl = document.getElementById('user-display-name');
    if (nameEl) {
      var c = Auth.getCredentials() || {};
      nameEl.textContent = c.username || 'Conectado';
    }

    _activateTab('live');
    Navigation.focusFirst('main');
  }

  function _bindMainEvents() {
    var menuItems = document.querySelectorAll('.menu-item');
    for (var i = 0; i < menuItems.length; i++) {
      (function (item) {
        item.addEventListener('click', function () { _activateTab(item.dataset.tab); });
        item.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); _activateTab(item.dataset.tab); }
        });
      })(menuItems[i]);
    }

    var exitBtns = [document.getElementById('btn-logout'), document.getElementById('settings-logout')];
    for (var j = 0; j < exitBtns.length; j++) {
      var btn = exitBtns[j];
      if (btn) btn.addEventListener('click', function () { Storage.clearAuth(); _handleLogout(); });
    }
  }

  function _handleManualRefresh() {
    if (API && API.clearCache) {
      API.clearCache();
      Renderer.showToast('Limpando cache e atualizando listas...', 'info');
      
      // Pequeno delay para garantir que o cache limpou antes de recarregar
      setTimeout(function() {
        _activateTab(_state.activeTab);
      }, 300);
    }
  }

  function _activateTab(tabName) {

    Renderer.destroyVirtualScroll();
    if (typeof Renderer !== 'undefined' && Renderer.destroyVirtualScroll) {
      Renderer.destroyVirtualScroll();
    }

    if (_state.miniActive && tabName !== 'live') _deactivateMiniPlayer(true);
    _state.activeTab = tabName;
    _state.activeCategory = '';

    var menuItems = document.querySelectorAll('.menu-item');
    for (var i = 0; i < menuItems.length; i++) {
      var m = menuItems[i];
      if (m.dataset.tab === tabName) m.classList.add('active');
      else m.classList.remove('active');
    }

    var grid = document.getElementById('content-grid');
    var catFilter = document.getElementById('category-filter');
    if (grid) grid.innerHTML = '';
    if (catFilter) catFilter.innerHTML = '';

    // Removido API.clearCache() daqui para permitir cache entre abas.
    // O cache agora é limpo apenas pelo botão "Atualizar Lista".

    var header = document.querySelector('.content-header');
    var stpanel = document.getElementById('tab-settings');
    var searchBar = document.getElementById('header-search-form');
    var searchInput = document.getElementById('header-search-input');
    var loading = document.getElementById('content-loading');
    var empty = document.getElementById('content-empty');

    if (searchBar) {
      if (tabName === 'movies' || tabName === 'series') searchBar.classList.remove('hidden');
      else searchBar.classList.add('hidden');
    }

    if (searchInput) {
      searchInput.value = '';
      _state.isSearching = false;
      _state.lastSearchQuery = '';
    }
    _state.originalItems = [];

    if (stpanel) stpanel.classList.add('hidden');

    if (tabName === 'settings') {
      if (grid) grid.style.display = 'none';
      if (loading) loading.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      if (stpanel) stpanel.classList.remove('hidden');
      /* Mostra o header com o título "Configurações" — consistência visual com outras abas */
      if (header) header.style.display = '';
      var titleEl2 = document.getElementById('content-title');
      if (titleEl2) titleEl2.textContent = 'Configurações';
      /* Esconde filtro de categoria e busca (não fazem sentido em configurações) */
      var cf2 = document.getElementById('category-filter');
      if (cf2) cf2.innerHTML = '';
      /* Esconde a faixa "Continuar Assistindo" */
      var cwRow = document.getElementById('continue-watching-row');
      if (cwRow) cwRow.classList.add('hidden');
      _updateSettingsDisplay();
      return;
    }

    if (grid) grid.style.display = '';
    if (header) header.style.display = '';
    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = {
      live: 'TV ao Vivo', movies: 'Filmes', series: 'Séries',
      favorites: 'Favoritos', watchlist: 'Continuar Assistindo'
    }[tabName] || tabName;

    _loadCurrentTab();
  }



  function _renderContinueWatchingRow(filterType) {
    var row = document.getElementById('continue-watching-row');
    var container = document.getElementById('cw-cards-container');
    var seeAll = document.getElementById('cw-see-all-btn');
    if (!row || !container) return;

    // Esconde a faixa se estivermos na própria página de continuar assistindo ou em abas que não precisam dela
    if (filterType === 'watchlist' || filterType === 'favorites' || filterType === 'settings') {
      row.classList.add('hidden');
      return;
    }

    var items = Storage.getProgressArray();

    // Filtra só pelo tipo da aba atual
    if (filterType && filterType !== 'all') {
      var typeMap = { live: 'live', movies: 'movie', series: 'series' };
      var t = typeMap[filterType];
      if (t) items = items.filter(function (i) { return i._type === t; });
    }

    if (!items || items.length === 0) {
      row.classList.add('hidden');
      return;
    }

    row.classList.remove('hidden');
    container.innerHTML = '';

    // Máximo de 10 na faixa
    var shown = items.slice(0, 10);

    for (var i = 0; i < shown.length; i++) {
      var item = shown[i];
      container.appendChild(Renderer.createCard(item, {
        showTypeBadge: true,
        onPlay: _playItem,
        onRemove: function (targetItem) {
          var id = String(targetItem._episodeId || targetItem.vod_id || targetItem.stream_id || targetItem.id || '');
          Storage.removeProgress(id);
          _renderContinueWatchingRow(_state.activeTab);
        }
      }));
    }

    if (seeAll) {
      seeAll.onclick = function () { _activateTab('watchlist'); };
    }
  }

  /* ══════════════════════════════════════
     LOAD TABS
  ══════════════════════════════════════ */
  function _loadCurrentTab() {
    var tab = _state.activeTab;
    // Sem chamada de watchlist row aqui — não existe no app atual

    if (tab === 'favorites') { _renderFavorites(); return; }
    if (tab === 'watchlist') { _renderWatchlist(); return; }
    Renderer.setLoading(true);
    Renderer.setEmpty(false);
    if (_state.mode === 'xtream') _loadXtreamTab(tab);
    else if (_state.mode === 'm3u') _loadM3UTab(tab);
  }

  function _loadXtreamTab(tab) {
    // Renderiza faixa de continuar assistindo no topo
    _renderContinueWatchingRow(tab);

    var getCats, getStreams;
    if (tab === 'live') { getCats = API.getLiveCategories; getStreams = API.getLiveStreams; }
    else if (tab === 'movies') { getCats = API.getVodCategories; getStreams = API.getVodStreams; }
    else if (tab === 'series') { getCats = API.getSeriesCategories; getStreams = API.getSeriesList; }
    else { Renderer.setLoading(false); return; }

    getCats().then(function (cats) {
      _renderCategoriesLazy(cats, getStreams);
      if (cats && cats.length > 0) {
        _state.activeCategory = cats[0].category_id;
        _startStreamingLoad(getStreams, cats[0].category_id);
      } else {
        Renderer.setLoading(false);
        Renderer.setEmpty(true);
      }
    }).catch(_handleLoadError);
  }
  function _startStreamingLoad(getStreams, categoryId, search) {
    var token = ++_state.loadToken;
    var grid = document.getElementById('content-grid');
    var opts = { onPlay: _playItem, onFavorite: _onFavoriteToggle };

    _state.allItems = [];
    _state.originalItems = [];
    var firstChunkReceived = false;
    var fullItems = [];
    Renderer.setEmpty(false);

    /* Inicia o pager (limpa o grid internamente) */
    Renderer.Pager.init(grid, opts);

    getStreams(categoryId, function (chunk) {
      if (token !== _state.loadToken) return;

      var filteredChunk = [];
      for (var i = 0; i < chunk.length; i++) {
        var item = chunk[i];
        if (item && item.name && item.name.trim() !== '') filteredChunk.push(item);
      }
      if (filteredChunk.length === 0) return;

      var validItems = filteredChunk;
      if (search) {
        var query = search.toLowerCase();
        validItems = [];
        for (var k = 0; k < filteredChunk.length; k++) {
          if (filteredChunk[k].name && filteredChunk[k].name.toLowerCase().indexOf(query) !== -1) {
            validItems.push(filteredChunk[k]);
          }
        }
      }

      var limit = search ? 15000 : MAXITEMS;
      if (fullItems.length >= limit) return;
      if (fullItems.length + validItems.length > limit) {
        validItems = validItems.slice(0, limit - fullItems.length);
      }

      fullItems = fullItems.concat(validItems);
      if (validItems.length === 0) return;

      if (!firstChunkReceived) {
        firstChunkReceived = true;
        Renderer.setLoading(false);
        if (grid) grid.style.display = '';
      }

      _state.allItems = _state.allItems.concat(validItems);

      /* Entrega ao pager — ele decide quando renderizar */
      Renderer.Pager.append(validItems);

    }, search).then(function (allItems) {
      if (token !== _state.loadToken) return;

      if (fullItems.length === 0 && allItems && allItems.length) {
        /* Sem streaming — recebeu tudo de uma vez */
        var q = search ? search.toLowerCase() : '';
        var lim = search ? 15000 : MAXITEMS;
        for (var i = 0; i < allItems.length; i++) {
          var it = allItems[i];
          if (it && it.name && it.name.trim() !== '') {
            if (q) { if (it.name.toLowerCase().indexOf(q) !== -1) fullItems.push(it); }
            else fullItems.push(it);
          }
          if (fullItems.length >= lim) break;
        }
        _state.allItems = fullItems;
        if (!firstChunkReceived) {
          Renderer.setLoading(false);
          if (grid) grid.style.display = '';
        }
        Renderer.Pager.append(fullItems);
      }
      _state.originalItems = fullItems.length ? fullItems : _state.allItems;
      Renderer.setEmpty(_state.allItems.length === 0);

    }).catch(function (e) {
      if (token !== _state.loadToken) return;
      _handleLoadError(e);
    });
  }

  function _renderCategoriesLazy(categories, getStreams) {
    var container = document.getElementById('category-filter');
    if (!container) return;
    container.innerHTML = '';
    if (!categories || !categories.length) return;

    for (var i = 0; i < categories.length; i++) {
      (function (idx) {
        var cat = categories[idx];
        var btn = document.createElement('button');
        btn.className = 'cat-btn' + (idx === 0 ? ' active' : '');
        btn.textContent = cat.category_name;
        btn.dataset.catId = cat.category_id;
        btn.tabIndex = 0;

        btn.addEventListener('click', function () {
          if (_state.activeCategory === cat.category_id) return;
          _state.activeCategory = cat.category_id;
          var allBtns = container.querySelectorAll('.cat-btn');
          for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
          btn.classList.add('active');
          var searchInput = document.getElementById('header-search-input');
          if (searchInput) searchInput.value = '';
          _state.isSearching = false;
          if (Renderer.destroyVirtualScroll) Renderer.destroyVirtualScroll();
          Renderer.setLoading(true);
          _startStreamingLoad(getStreams, cat.category_id);
        });

        btn.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); btn.click(); }
        });

        container.appendChild(btn);
      })(i);
    }
  }

  function _loadM3UTab(tab) {

    _renderContinueWatchingRow(tab);  // ← adicione esta linha
    API.loadM3U().then(function (all) {
      var tf = { live: 'live', movies: 'movie', series: 'series' }[tab];
      var filtered = [];
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        if (it && it.name && it.name.trim() !== '' && (!tf || it._type === tf)) filtered.push(it);
      }

      var groups = {};
      for (var i = 0; i < filtered.length; i++) {
        var item = filtered[i];
        var g = item.category_name || item.group || 'Outros';
        if (!groups[g]) groups[g] = { category_id: g, category_name: g };
      }
      var cats = Object.keys(groups).map(function (k) { return groups[k]; });

      _renderCategoriesLazy(cats, function (catId) {
        return Promise.resolve(filtered.filter(function (i) {
          return (i.category_name || i.group) === catId;
        }));
      });

      _state.allItems = cats.length > 0
        ? filtered.filter(function (i) { return (i.category_name || i.group) === cats[0].category_id; })
        : filtered;

      Renderer.setLoading(false);
      _renderGrid(_state.allItems);
      _state.originalItems = _state.allItems;
      Renderer.setEmpty(_state.allItems.length === 0);
    }).catch(_handleLoadError);
  }

  function _handleLoadError(err) {
    Renderer.setLoading(false);
    Renderer.setEmpty(true);
    var msg = (err && err.message ? err.message : 'falha de conexão');
    if (msg.indexOf('timeout') !== -1) msg = 'O servidor demorou demais para responder';
    if (msg.indexOf('JSON') !== -1 || msg.indexOf('Memória') !== -1) msg = 'Lista muito grande para esta TV';
    Renderer.showToast('Erro: ' + msg, 'error', 5000);
    console.error('[App] Erro de carregamento:', err);
  }

  function _renderGrid(items, customOptions) {
    var grid = document.getElementById('content-grid');
    if (!grid) return;
    _state.allItems = items || [];
    var opts = customOptions || { onPlay: _playItem, onFavorite: _onFavoriteToggle };
    Renderer.Pager.init(grid, opts);
    Renderer.Pager.append(_state.allItems);
    Renderer.setEmpty(_state.allItems.length === 0);
  }

  function _onFavoriteToggle(item, isFav) {
    Renderer.showToast(isFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos', isFav ? 'success' : 'info');
    if (_state.activeTab === 'favorites') _renderFavorites();
  }

  function _renderFavorites() {
    Renderer.setLoading(false);
    /* Esconde a faixa CW — aqui o conteúdo é misturado, o badge de tipo já supre */
    var cwRow = document.getElementById('continue-watching-row');
    if (cwRow) cwRow.classList.add('hidden');
    var items = Storage.getFavoritesArray().map(function (f) {
      return {
        stream_id: f.type === 'live' ? f.id : null,
        vod_id: f.type === 'movie' ? f.id : null,
        series_id: f.type === 'series' ? f.id : null,
        name: f.name, _type: f.type,
        stream_icon: f.icon, cover: f.icon, series_cover: f.icon,
        category_name: f.category
      };
    });
    document.getElementById('category-filter').innerHTML = '';
    /* showTypeBadge: true — favoritos têm conteúdo misto, badge ajuda a distinguir */
    _renderGrid(items, { onPlay: _playItem, onFavorite: _onFavoriteToggle, showTypeBadge: true });
  }

  function _renderWatchlist() {
    Renderer.setLoading(false);
    /* Esconde a faixa "Continuar Assistindo" que viria da aba anterior */
    var cwRow = document.getElementById('continue-watching-row');
    if (cwRow) cwRow.classList.add('hidden');

    var items = Storage.getProgressArray();
    document.getElementById('category-filter').innerHTML = '';

    _renderGrid(items, {
      onPlay: _playItem,
      onFavorite: _onFavoriteToggle,
      showTypeBadge: true,
      onRemove: function (targetItem) {
        var id = String(targetItem._episodeId || targetItem.vod_id || targetItem.stream_id || targetItem.id || '');
        Storage.removeProgress(id);
        _renderWatchlist();
      }
    });
  }

  /* ══════════════════════════════════════
     PLAY / DETALHE
  ══════════════════════════════════════ */
  function _playItem(item) {
    if (_state.miniActive) _deactivateMiniPlayer(false);

    var type = item._type || 'live';



    if (type === 'live') _openPlayer(item);
    else if (type === 'movie') _openDetail(item);
    else if (type === 'series') _openSeriesDetail(item);
  }

  function _openPlayer(item) {
    _deactivateMiniPlayer(false);
    Navigation.pushHistory('player');
    _showScreen('player');
    Player.play(item);
    _state.miniItem = item;

    var next = _findNextItem(item);
    if (next) Player.setNextItem(next, function () { _openPlayer(next); });
    else Player.setNextItem(null);
  }

  function _findNextItem(item) {
    if (!item) return null;
    var list = (item._type === 'series') ? _state.currentEpisodes : _state.allItems;
    if (!list || !list.length) return null;
    var id = item._episodeId || item.stream_id || item.vod_id || item.series_id;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var itId = it._episodeId || it.stream_id || it.vod_id || it.series_id;
      if (itId === id && i < list.length - 1) return list[i + 1];
    }
    return null;
  }

  /* ── FIX: _openDetail com skeleton + proteção vod_id nulo ── */
  function _openDetail(item) {
    _showScreen('detail');
    Navigation.pushHistory('detail');
    Navigation.setScreen('detail');

    /* Preenche com o que já temos (dados básicos da grade) */
    _fillDetailUI(item);

    var epPanel = document.getElementById('series-episodes-panel');
    if (epPanel) epPanel.classList.add('hidden');

    var playBtn = document.getElementById('detail-play');
    if (playBtn) playBtn.onclick = function () { _openPlayer(item); };
    _bindDetailFavorite(item);

    /* FIX: só busca getVodInfo se tiver vod_id válido */
    var vodId = item.vod_id || item.stream_id || item.id;
    if (_state.mode === 'xtream' && vodId) {

      /* Skeleton: mostra "Carregando detalhes…" enquanto aguarda */
      var plotEl = document.getElementById('detail-plot');
      if (plotEl && !plotEl.textContent.trim()) {
        plotEl.textContent = 'Carregando detalhes…';
        plotEl.style.color = 'var(--text-3)';
      }

      API.getVodInfo(vodId).then(function (info) {
        if (!info) return;
        var data = info.info || info; /* alguns servidores retornam direto sem .info */

        /* Restaura cor normal */
        if (plotEl) plotEl.style.color = '';

        if (plotEl && data.plot) plotEl.textContent = data.plot;
        else if (plotEl && plotEl.textContent === 'Carregando detalhes…') plotEl.textContent = '';

        /* Diretor */
        var dirRow = document.getElementById('detail-director-row');
        var dirEl = document.getElementById('detail-director');
        if (dirRow && dirEl) {
          if (data.director && data.director.trim() !== '' && data.director !== 'N/A') {
            dirEl.textContent = data.director;
            dirRow.classList.remove('hidden');
          } else { dirRow.classList.add('hidden'); }
        }

        /* Elenco */
        var castRow = document.getElementById('detail-cast-row');
        var castEl = document.getElementById('detail-cast');
        if (castRow && castEl) {
          if (data.cast && data.cast.trim() !== '' && data.cast !== 'N/A') {
            castEl.textContent = data.cast;
            castRow.classList.remove('hidden');
          } else { castRow.classList.add('hidden'); }
        }

        /* Badges com dados reais da API */
        var badgesEl = document.getElementById('detail-badges');
        if (badgesEl) {
          badgesEl.innerHTML = '';
          if (data.releasedate) badgesEl.appendChild(_badge(data.releasedate.substring(0, 4), 'badge-year'));
          else if (item.year) badgesEl.appendChild(_badge(item.year, 'badge-year'));

          if (data.duration_secs) {
            var mins = Math.floor(data.duration_secs / 60);
            var hours = Math.floor(mins / 60);
            var m = mins % 60;
            badgesEl.appendChild(_badge((hours > 0 ? hours + 'h ' : '') + m + 'min', 'badge-duration'));
          } else if (data.duration) {
            badgesEl.appendChild(_badge(data.duration, 'badge-duration'));
          }

          if (data.rating) badgesEl.appendChild(_badge('⭐ ' + data.rating, 'badge-rating'));
          else if (item.rating) badgesEl.appendChild(_badge('⭐ ' + item.rating, 'badge-rating'));

          if (data.genre) {
            var gs = data.genre.split(',');
            for (var g = 0; g < Math.min(3, gs.length); g++) {
              badgesEl.appendChild(_badge(gs[g].trim(), 'badge-genre'));
            }
          } else if (item.category_name) {
            badgesEl.appendChild(_badge(item.category_name, 'badge-genre'));
          }
        }

        /* Atualiza capa se vier URL melhor da API */
        if (data.movie_image || data.cover_big) {
          var betterCover = data.movie_image || data.cover_big;
          var coverEl = document.getElementById('detail-cover');
          var bdEl = document.getElementById('detail-backdrop');
          if (coverEl) { coverEl.src = betterCover; coverEl.style.display = ''; }
          if (bdEl) bdEl.style.backgroundImage = 'url(' + betterCover + ')';
        }

      }).catch(function (e) {
        /* Silencioso — já temos os dados básicos da grade */
        if (plotEl && plotEl.textContent === 'Carregando detalhes…') plotEl.textContent = '';
        console.warn('[App] getVodInfo falhou:', e);
      });
    }

    setTimeout(function () {
      var pb = document.getElementById('detail-play');
      if (pb) pb.focus();
    }, 150);
  }

  function _openSeriesDetail(item) {
    _showScreen('detail');
    Navigation.pushHistory('detail');
    Navigation.setScreen('detail');
    _fillDetailUI(item);
    var epPanel = document.getElementById('series-episodes-panel');
    if (epPanel) epPanel.classList.remove('hidden');
    _bindDetailFavorite(item);
    if (_state.mode === 'xtream' && item.series_id) _loadXtreamSeriesEpisodes(item);
    setTimeout(function () {
      var pb = document.getElementById('detail-play');
      if (pb) pb.focus();
    }, 150);
  }

  function _loadXtreamSeriesEpisodes(series) {
    API.getSeriesInfo(series.series_id).then(function (info) {
      if (!info || !info.episodes) return;
      var seasonsRow = document.getElementById('seasons-row');
      var episodesGrid = document.getElementById('episodes-grid');
      seasonsRow.innerHTML = ''; episodesGrid.innerHTML = '';
      var snums = Object.keys(info.episodes || {});
      if (!snums.length) return;

      /* Preenche info da série se vier na API */
      var si = info.info || {};
      var plotEl = document.getElementById('detail-plot');
      if (plotEl && si.plot) { plotEl.textContent = si.plot; plotEl.style.color = ''; }
      var badgesEl = document.getElementById('detail-badges');
      if (badgesEl && (si.releaseDate || si.rating || si.genre)) {
        badgesEl.innerHTML = '';
        if (si.releaseDate) badgesEl.appendChild(_badge(si.releaseDate.substring(0, 4), 'badge-year'));
        if (si.rating) badgesEl.appendChild(_badge('⭐ ' + si.rating, 'badge-rating'));
        if (si.genre) {
          var gs = si.genre.split(',');
          for (var g = 0; g < Math.min(3, gs.length); g++) badgesEl.appendChild(_badge(gs[g].trim(), 'badge-genre'));
        }
      }

      for (var i = 0; i < snums.length; i++) {
        (function (idx) {
          var sNum = snums[idx];
          var btn = document.createElement('button');
          btn.className = 'season-btn' + (idx === 0 ? ' active' : '');
          btn.textContent = 'Temporada ' + sNum;
          btn.addEventListener('click', function () {
            var allBtns = document.querySelectorAll('.season-btn');
            for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
            btn.classList.add('active');
            _renderXtreamEps(info.episodes[sNum], series, episodesGrid);
          });
          seasonsRow.appendChild(btn);
        })(i);
      }

      _renderXtreamEps(info.episodes[snums[0]], series, episodesGrid);

      var allEps = [];
      for (var k = 0; k < snums.length; k++) {
        var seasonEps = info.episodes[snums[k]] || [];
        for (var m2 = 0; m2 < seasonEps.length; m2++) {
          var ep = seasonEps[m2];
          allEps.push(Object.assign({}, series, {
            _type: 'series',
            _episodeId: ep.id || ep.stream_id,
            _episodeExt: ep.container_extension || 'mkv',
            name: series.name + ' – S' + (ep.season || snums[k]) + ' E' + (ep.episode_num || (m2 + 1))
          }));
        }
      }
      _state.currentEpisodes = allEps;

      var playBtn = document.getElementById('detail-play');
      if (playBtn) {
        var seriesProg = Storage.getSeriesProgress(series.series_id);
        if (seriesProg) {
          playBtn.onclick = function () {
            _openPlayer(Object.assign({}, series, {
              _type: 'series',
              _episodeId: seriesProg.id,
              _episodeExt: seriesProg.episodeExt || 'mkv',
              name: seriesProg.name
            }));
          };
        } else if (info.episodes[snums[0]] && info.episodes[snums[0]][0]) {
          var ep0 = info.episodes[snums[0]][0];
          playBtn.onclick = function () {
            _openPlayer(Object.assign({}, series, {
              _type: 'series',
              _episodeId: ep0.id || ep0.stream_id,
              _episodeExt: ep0.container_extension || 'mkv',
              name: series.name + ' – S1 E' + (ep0.episode_num || 1)
            }));
          };
        }
      }
    }).catch(function (e) { console.warn('[App] Episódios:', e); });
  }

  function _renderXtreamEps(episodes, series, container) {
    container.innerHTML = '';
    if (!episodes) return;
    for (var i = 0; i < episodes.length; i++) container.appendChild(_createEpisodeCard(episodes[i], series));
  }

  function _createEpisodeCard(ep, series) {
    var card = document.createElement('div');
    card.className = 'episode-card';
    card.tabIndex = 0;

    var thumb = document.createElement('div');
    thumb.className = 'episode-thumb';
    thumb.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:28px;';
    thumb.textContent = '🎬';

    if (ep.info && ep.info.movie_image) {
      var img = document.createElement('img');
      img.className = 'episode-thumb'; img.alt = ep.title || '';
      /* Usa a fila de imagens do Renderer (com timeout + retry) em vez de carregar direto */
      Renderer.lazyLoadImg(img, ep.info.movie_image);
      card.appendChild(img);
    } else { card.appendChild(thumb); }

    var info = document.createElement('div'); info.className = 'episode-info';
    var num = document.createElement('div'); num.className = 'episode-num';
    num.textContent = 'S' + (ep.season || 1) + ' E' + (ep.episode_num || '');
    var titleEl = document.createElement('div'); titleEl.className = 'episode-title';
    titleEl.textContent = ep.title || ep.name || ('Episódio ' + ep.episode_num);
    var rt = document.createElement('div'); rt.className = 'episode-runtime';
    rt.textContent = (ep.info && ep.info.duration) ? ep.info.duration : (series.episode_run_time ? series.episode_run_time + ' min' : '');
    info.appendChild(num); info.appendChild(titleEl); info.appendChild(rt);
    card.appendChild(info);

    var progId = ep.id || ep.stream_id;
    var prog = Storage.getProgress(progId);
    if (prog && prog.pct > 1) {
      var pBar = document.createElement('div'); pBar.className = 'card-progress';
      var pFill = document.createElement('div'); pFill.className = 'card-progress-fill';
      pFill.style.width = Math.min(100, prog.pct) + '%';
      pBar.appendChild(pFill); card.appendChild(pBar);
    }

    card.addEventListener('click', function () {
      _openPlayer(Object.assign({}, series, {
        _type: 'series',
        _episodeId: ep.id || ep.stream_id,
        _episodeExt: ep.container_extension || 'mkv',
        name: series.name + ' – ' + titleEl.textContent
      }));
    });
    card.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); card.click(); } });
    return card;
  }

  /* ── FIX: _fillDetailUI usa _type corretamente ── */
  function _fillDetailUI(item) {
    var icon = item.stream_icon || item.cover || item.series_cover || '';
    var t = document.getElementById('detail-title'); if (t) t.textContent = item.name || '';

    var c = document.getElementById('detail-cover');
    if (c) {
      if (icon) { c.src = icon; c.style.display = ''; c.onerror = function () { this.style.display = 'none'; }; }
      else c.style.display = 'none';
    }

    var bd = document.getElementById('detail-backdrop');
    if (bd && icon) bd.style.backgroundImage = 'url(' + icon + ')';

    var p = document.getElementById('detail-plot');
    if (p) {
      /* FIX: usa campos alternativos que podem vir do watchlist/favoritos */
      p.textContent = item.plot || item.description || item.overview || '';
      p.style.color = '';
    }

    /* Esconde diretor/elenco até API responder */
    var dirRow = document.getElementById('detail-director-row');
    var castRow = document.getElementById('detail-cast-row');
    if (dirRow) dirRow.classList.add('hidden');
    if (castRow) castRow.classList.add('hidden');

    var bx = document.getElementById('detail-badges');
    if (bx) {
      bx.innerHTML = '';
      if (item.year) bx.appendChild(_badge(item.year, 'badge-year'));
      if (item.rating) bx.appendChild(_badge('⭐ ' + item.rating, 'badge-rating'));
      if (item.category_name) bx.appendChild(_badge(item.category_name, 'badge-genre'));
    }

    var playBtn = document.getElementById('detail-play');
    if (playBtn) {
      /* FIX: lê _type (padrão watchlist/favoritos) e type (padrão grade) */
      var itemType = item._type || item.type || 'movie';
      var id = String(item.stream_id || item.vod_id || item.series_id || item.id || item._episodeId || '');
      var prog = Storage.getProgress(id);
      if (!prog && (itemType === 'series') && (item.series_id || item.id)) {
        prog = Storage.getSeriesProgress(item.series_id || item.id);
      }
      playBtn.innerHTML = '&#9654;&nbsp;&nbsp;' + (prog ? 'Continuar Assistindo' : 'Assistir');
      /* Salva referência ao item para que goBack() possa re-checar o progresso */
      playBtn._detailItem = item;
    }
  }

  function _bindDetailFavorite(item) {
    var btn = document.getElementById('detail-favorite');
    var ico = document.getElementById('detail-fav-icon');
    if (!btn || !ico) return;
    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    ico.textContent = Storage.isFavorite(id) ? '★' : '☆';
    btn.onclick = function () {
      var nf = Storage.toggleFavorite(item);
      ico.textContent = nf ? '★' : '☆';
      Renderer.showToast(nf ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos', nf ? 'success' : 'info');
    };
  }

  function _bindDetailEvents() {
    var back = document.getElementById('detail-back');
    if (back) back.addEventListener('click', goBack);
  }

  function _badge(txt, cls) {
    var el = document.createElement('span');
    el.className = 'badge ' + (cls || '');
    el.textContent = txt;
    return el;
  }

  /* ══════════════════════════════════════
     CONFIGURAÇÕES
  ══════════════════════════════════════ */
  function _bindSettingsEvents() {
    var cf = document.getElementById('clear-favorites'), cr = document.getElementById('clear-recents');
    var ca = document.getElementById('clear-all'), ti = document.getElementById('toggle-images');
    if (ti) ti.addEventListener('click', function () {
      var s = Storage.getSettings();
      var newVal = !s.showImages;
      Storage.setSetting('showImages', newVal);
      _updateSettingsDisplay();
      _applySettings();
      // Força recarregamento da aba atual para aplicar na grade
      _loadCurrentTab();
    });
    if (cf) cf.addEventListener('click', function () { Storage.clearFavorites(); Renderer.showToast('Favoritos removidos', 'info'); });
    if (cr) cr.addEventListener('click', function () { Storage.clearRecents(); Renderer.showToast('Histórico limpo', 'info'); });
    if (ca) ca.addEventListener('click', function () {
      Storage.clearAll(); API.clearCache();
      Renderer.showToast('Todos os dados removidos', 'info');
    });

    var sr = document.getElementById('settings-refresh');
    if (sr) {
      sr.addEventListener('click', _handleManualRefresh);
    }
  }

  function _applySettings() {
    var s = Storage.getSettings();

    var grid = document.getElementById('content-grid');
    if (grid) {
      if (s.showImages === false) grid.classList.add('no-images');
      else grid.classList.remove('no-images');
    }
  }

  function _updateSettingsDisplay() {
    var s = Storage.getSettings();
    var ti = document.getElementById('toggle-images');
    if (ti) {
      ti.textContent = s.showImages ? 'Ativado' : 'Desativado';
      ti.className = 'btn-toggle ' + (s.showImages ? 'active' : '');
    }
    var a = document.getElementById('settings-account');
    if (a) {
      var c = Auth.getCredentials();
      if (c && c.type === 'xtream') a.textContent = c.username + ' @ ' + c.server;
      else if (c && c.type === 'm3u') a.textContent = 'M3U: ' + (c.url || '').substring(0, 40);
      else a.textContent = '—';
    }
  }

  /* ══════════════════════════════════════
     TELAS / MINI-PLAYER
  ══════════════════════════════════════ */
  function _showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
      screens[i].classList.add('hidden');
    }
    var t = document.getElementById('screen-' + name);
    if (t) { t.classList.remove('hidden'); t.classList.add('active'); }
    Navigation.setScreen(name);
  }

  function _deactivateMiniPlayer(stopPlayer) {
    if (!_state.miniActive) return;
    _state.miniActive = false; _state.miniItem = null;
    var ps = document.getElementById('screen-player');
    var ms = document.getElementById('screen-main');
    if (ps) {
      ps.classList.remove('channel-picker-preview');
      if (stopPlayer) { ps.classList.add('hidden'); ps.classList.remove('active'); Player.stop(); }
    }
    if (ms) ms.classList.remove('channel-picker-main');
  }

  /* ══════════════════════════════════════
     BUSCA
  ══════════════════════════════════════ */
  var _searchTimeout = null;
  function _handleSearch() {
    var input = document.getElementById('header-search-input');
    if (!input) return;
    var query = (input.value || input._tvValue || '').trim();

    var tab = _state.activeTab;

    if (!query) {
      if (_state.isSearching) {
        _state.isSearching = false;
        _state.lastSearchQuery = '';
        _loadCurrentTab();
      }
      return;
    }

    _state.isSearching = true;
    _state.lastSearchQuery = query;

    var getStreams;
    if (tab === 'live') getStreams = API.getLiveStreams;
    else if (tab === 'movies') getStreams = API.getVodStreams;
    else if (tab === 'series') getStreams = API.getSeriesList;
    else { _state.isSearching = false; return; }

    if (Renderer.destroyVirtualScroll) Renderer.destroyVirtualScroll();
    Renderer.setLoading(true);
    _startStreamingLoad(getStreams, null, query);

    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = 'Busca: ' + query;
  }

  function _bindSearchEvents() {
    var form = document.getElementById('header-search-form');
    var input = document.getElementById('header-search-input');
    var btn = document.getElementById('header-search-btn');

    if (!form || !input || !btn) return;

    // Salva valor continuamente — TVs antigas às vezes limpam o .value no blur
    input._tvValue = '';
    input.addEventListener('input', function () {
      input._tvValue = input.value;
    });

    // Quando a TV fecha o teclado virtual, dispara blur antes do Enter
    // Restaura o valor caso tenha sido limpo
    input.addEventListener('blur', function () {
      if (input.value) {
        input._tvValue = input.value;
      } else if (input._tvValue) {
        // Restaura na próxima microtask (após o browser limpar)
        var saved = input._tvValue;
        setTimeout(function () {
          if (!input.value) input.value = saved;
        }, 0);
      }
    });

    // Submit normal — desktop e mobile
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      _handleSearch();
    });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      _handleSearch();
    });

    // TV: captura Enter na fase capture para rodar ANTES do navigation.js
    input.addEventListener('keydown', function (e) {
      var code = e.keyCode || e.which;
      if (code === 13 || code === 195) {
        e.preventDefault();
        e.stopPropagation(); // bloqueia navigation.js de chamar blur
        if (input.value) input._tvValue = input.value;
        _handleSearch();
      }
    }, true); // fase capture = roda antes dos listeners do document
  }

  function _handleSearch() {
    var input = document.getElementById('header-search-input');
    if (!input) return;
    var query = input.value.trim();
    var tab = _state.activeTab;

    if (!query) {
      if (_state.isSearching) {
        _state.isSearching = false;
        _state.lastSearchQuery = '';
        _loadCurrentTab();
      }
      return;
    }

    _state.isSearching = true;
    var getStreams;
    if (tab === 'live') getStreams = API.getLiveStreams;
    else if (tab === 'movies') getStreams = API.getVodStreams;
    else if (tab === 'series') getStreams = API.getSeriesList;
    else { _state.isSearching = false; return; }

    if (Renderer.destroyVirtualScroll) Renderer.destroyVirtualScroll();
    Renderer.setLoading(true);
    _startStreamingLoad(getStreams, null, query);

    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = 'Busca: ' + query;
  }

  function goBack() {
    var screen = document.querySelector('.screen.active');
    var sid = screen ? screen.id.replace('screen-', '') : '';

    if (sid === 'player' && !_state.miniActive) { Player.stop(); _state.miniItem = null; }

    var prev = Navigation.popHistory();
    if (prev) {
      _showScreen(prev);
      if (prev === 'main') Navigation.focusFirst('main');
      else if (prev === 'detail') setTimeout(function () {
        /* Atualiza o botão de play com o progresso atual (pode ter mudado no player) */
        var btn = document.getElementById('detail-play');
        if (btn) {
          /* Pega o item atual do botão para saber seu ID */
          var curItem = btn._detailItem;
          if (curItem) {
            var itemType = curItem._type || curItem.type || 'movie';
            var id = String(curItem.stream_id || curItem.vod_id || curItem.series_id || curItem.id || curItem._episodeId || '');
            var prog = Storage.getProgress(id);
            if (!prog && itemType === 'series' && (curItem.series_id || curItem.id)) {
              prog = Storage.getSeriesProgress(curItem.series_id || curItem.id);
            }
            btn.innerHTML = '&#9654;&nbsp;&nbsp;' + (prog ? 'Continuar Assistindo' : 'Assistir');
          }
          btn.focus();
        }
      }, 100);
    } else {
      _showScreen('main');
      Navigation.focusFirst('main');
    }
  }

  function _handleLogout() {
    Player.stop(); Auth.logout(); API.clearCache();
    Navigation.clearHistory(); Navigation.pushHistory('login');
    _showScreen('login'); Navigation.setScreen('login'); Navigation.focusFirst('login');
    Renderer.showToast('Desconectado com sucesso', 'info');
  }

  return { init: init, goBack: goBack };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}