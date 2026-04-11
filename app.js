/**
 * app.js – Orquestrador principal do StreamTV
 * Coordena todas as telas, módulos e fluxo da aplicação
 */

var App = (function () {
  'use strict';

  /* ══════════════════════════════════════
     Estado global
  ══════════════════════════════════════ */
  var _state = {
    mode:           'xtream',
    activeTab:      'live',
    activeCategory: '',
    allItems:       [],
    demoData:       null,
    uiScale:        100,
    miniActive:     false,   // split-screen ativo?
    miniItem:       null,    // item tocando no preview
    loadToken:      0        // token anti-race-condition
  };

  /* ══════════════════════════════════════
     Inicialização
  ══════════════════════════════════════ */
  function init() {
    _applySettings();
    Player.init();
    Navigation.init();
    _bindLoginEvents();
    _bindMainEvents();
    _bindDetailEvents();
    _bindSettingsEvents();

    // Tenta restaurar sessão salva — auto-login se houver credenciais
    var saved = Storage.getAuth();
    if (saved) {
      if (saved.type === 'xtream') {
        // Pré-preenche os campos (caso auto-login falhe, o usuário vê os dados)
        var srvEl = document.getElementById('xtream-server');
        var usrEl = document.getElementById('xtream-user');
        var pwdEl = document.getElementById('xtream-pass');
        if (srvEl) srvEl.value = saved.server   || '';
        if (usrEl) usrEl.value = saved.username || '';
        if (pwdEl) pwdEl.value = saved.password || '';

        // Tenta auto-login silencioso
        _setLoginStatus('Reconectando...', 'loading');
        Auth.loginXtream(saved.server, saved.username, saved.password).then(function (result) {
          if (result.success) {
            _state.mode = 'xtream';
            _enterMain();
          } else {
            // Credenciais inválidas — mostra tela de login
            Storage.clearAuth();
            _setLoginStatus('Sessão expirada. Faça login novamente.', 'error');
            Navigation.pushHistory('login');
            Navigation.setScreen('login');
            Navigation.focusFirst('login');
          }
        });
        return; // não executa o focusFirst padrão abaixo

      } else if (saved.type === 'm3u') {
        _switchLoginTab('m3u');
        var m3uEl = document.getElementById('m3u-url');
        if (m3uEl) m3uEl.value = saved.url || '';

        _setLoginStatus('Reconectando...', 'loading');
        Auth.loginM3U(saved.url).then(function (result) {
          if (result.success) {
            _state.mode = 'm3u';
            _enterMain();
          } else {
            Storage.clearAuth();
            _setLoginStatus('Sessão expirada. Faça login novamente.', 'error');
            Navigation.pushHistory('login');
            Navigation.setScreen('login');
            Navigation.focusFirst('login');
          }
        });
        return;
      }
    }

    Navigation.pushHistory('login');
    Navigation.setScreen('login');
    Navigation.focusFirst('login');
  }

  /* ══════════════════════════════════════
     TELA DE LOGIN
  ══════════════════════════════════════ */
  function _bindLoginEvents() {
    // Tabs de tipo de conexão
    var tabXtream = document.getElementById('tab-xtream');
    var tabM3U = document.getElementById('tab-m3u');

    if (tabXtream) tabXtream.addEventListener('click', function () { _switchLoginTab('xtream'); });
    if (tabM3U)    tabM3U.addEventListener('click',    function () { _switchLoginTab('m3u'); });

    // Botão conectar
    var btnConnect = document.getElementById('btn-connect');
    if (btnConnect) btnConnect.addEventListener('click', _handleLogin);

    // Enter nos inputs dispara login
    var inputs = document.querySelectorAll('.login-form input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('keydown', function (e) {
        if (e.keyCode === 13) _handleLogin();
      });
    }
  }

  function _switchLoginTab(type) {
    var tabXtream = document.getElementById('tab-xtream');
    var tabM3U    = document.getElementById('tab-m3u');
    var formXtream = document.getElementById('form-xtream');
    var formM3U    = document.getElementById('form-m3u');

    if (type === 'xtream') {
      tabXtream.classList.add('active');
      tabXtream.setAttribute('aria-selected', 'true');
      tabM3U.classList.remove('active');
      tabM3U.setAttribute('aria-selected', 'false');
      formXtream.classList.remove('hidden');
      formM3U.classList.add('hidden');
    } else {
      tabM3U.classList.add('active');
      tabM3U.setAttribute('aria-selected', 'true');
      tabXtream.classList.remove('active');
      tabXtream.setAttribute('aria-selected', 'false');
      formM3U.classList.remove('hidden');
      formXtream.classList.add('hidden');
    }
  }

  function _handleLogin() {
    var tabXtream = document.getElementById('tab-xtream');
    var isXtream = tabXtream && tabXtream.classList.contains('active');

    _setLoginStatus('Conectando...', 'loading');

    if (isXtream) {
      var server = (document.getElementById('xtream-server') || {}).value || '';
      var user   = (document.getElementById('xtream-user')   || {}).value || '';
      var pass   = (document.getElementById('xtream-pass')   || {}).value || '';

      if (!server || !user || !pass) {
        _setLoginStatus('Preencha todos os campos', 'error');
        return;
      }

      Auth.loginXtream(server, user, pass).then(function (result) {
        if (result.success) {
          _state.mode = 'xtream';
          // Salva credenciais para auto-login futuro
          Storage.saveAuth({ type: 'xtream', server: server, username: user, password: pass });
          _setLoginStatus('Conectado!', 'success');
          setTimeout(function () { _enterMain(); }, 800);
        } else {
          _setLoginStatus(result.error || 'Falha na conexão', 'error');
        }
      });
    } else {
      var m3uUrl = (document.getElementById('m3u-url') || {}).value || '';

      if (!m3uUrl) {
        _setLoginStatus('Insira uma URL M3U', 'error');
        return;
      }

      Auth.loginM3U(m3uUrl).then(function (result) {
        if (result.success) {
          _state.mode = 'm3u';
          // Salva URL para auto-login futuro
          Storage.saveAuth({ type: 'm3u', url: m3uUrl });
          _setLoginStatus('Lista carregada!', 'success');
          setTimeout(function () { _enterMain(); }, 800);
        } else {
          _setLoginStatus(result.error || 'Falha ao carregar lista', 'error');
        }
      });
    }
  }

  function _setLoginStatus(msg, type) {
    var el = document.getElementById('login-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'login-status' + (type ? ' ' + type : '');
    if (type === 'loading') {
      el.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px;"></div>' + msg;
    }
  }

  /* ══════════════════════════════════════
     TELA PRINCIPAL
  ══════════════════════════════════════ */
  function _enterMain() {
    _showScreen('main');
    Navigation.pushHistory('main');

    // Atualiza nome do usuário na sidebar
    var nameEl = document.getElementById('user-display-name');
    if (nameEl) {
      var creds = Auth.getCredentials();
      if (creds && creds.username) nameEl.textContent = creds.username;
      else if (_state.mode === 'demo') nameEl.textContent = 'Demo';
      else nameEl.textContent = 'Conectado';
    }

    _activateTab('live');
    Navigation.focusFirst('main');
  }

  function _bindMainEvents() {
    // Menu lateral
    var menuItems = document.querySelectorAll('.menu-item');
    for (var i = 0; i < menuItems.length; i++) {
      (function (item) {
        item.addEventListener('click', function () {
          _activateTab(item.dataset.tab);
        });
        item.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); _activateTab(item.dataset.tab); }
        });
      })(menuItems[i]);
    }

    // Logout
    var logoutBtns = [
      document.getElementById('btn-logout'),
      document.getElementById('settings-logout')
    ];
    logoutBtns.forEach(function (btn) {
      if (btn) btn.addEventListener('click', function () {
        Storage.clearAuth(); // Limpa sessão salva
        _handleLogout();
      });
    });

    // Busca inline
    Search.initInlineSearch(function (results, q) {
      if (results === null) {
        // Restaura grid current
        _loadCurrentTab();
      } else {
        _renderGrid(results);
      }
    });
  }

  function _activateTab(tabName) {
    /* Se o split-screen estiver ativo e o usuário sair da aba de TV ao Vivo, fecha o preview */
    if (_state.miniActive && tabName !== 'live') {
      _deactivateMiniPlayer(true);
    }

    _state.activeTab = tabName;
    _state.activeCategory = '';


    // Atualiza menu ativo
    var menuItems = document.querySelectorAll('.menu-item');
    for (var i = 0; i < menuItems.length; i++) {
      if (menuItems[i].dataset.tab === tabName) menuItems[i].classList.add('active');
      else menuItems[i].classList.remove('active');
    }

    // Exibe/oculta painéis especiais
    var grid = document.getElementById('content-grid');
    var header = document.querySelector('.content-header');
    var searchPanel = document.getElementById('tab-search');
    var settingsPanel = document.getElementById('tab-settings');
    var loading = document.getElementById('content-loading');
    var empty = document.getElementById('content-empty');

    [searchPanel, settingsPanel].forEach(function (p) { if (p) p.classList.add('hidden'); });

    if (tabName === 'search') {
      if (grid) grid.style.display = 'none';
      if (header) header.style.display = 'none';
      if (loading) loading.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      if (searchPanel) searchPanel.classList.remove('hidden');
      Search.initSearchTab(_playItem);
      return;
    }

    if (tabName === 'settings') {
      if (grid) grid.style.display = 'none';
      if (header) header.style.display = 'none';
      if (loading) loading.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      if (settingsPanel) settingsPanel.classList.remove('hidden');
      _updateSettingsDisplay();
      return;
    }

    if (grid) grid.style.display = '';
    if (header) header.style.display = '';

    var titles = {
      live: 'TV ao Vivo', movies: 'Filmes', series: 'Séries',
      favorites: 'Favoritos', recents: 'Assistidos Recentemente'
    };
    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = titles[tabName] || tabName;

    _loadCurrentTab();
  }

  var _globalSearchWarmed = false;
  function _warmupGlobalSearch() {
    if (_globalSearchWarmed) return;
    _globalSearchWarmed = true;
    if (_state.mode === 'xtream') {
      Promise.all([
        API.getLiveStreams(''),
        API.getVodStreams(''),
        API.getSeriesList('')
      ]).then(function(res) {
        Search.setGlobalData((res[0]||[]).concat(res[1]||[]).concat(res[2]||[]));
      }).catch(function(){});
    } else if (_state.mode === 'm3u') {
      API.loadM3U().then(function(res) { Search.setGlobalData(res); }).catch(function(){});
    }
  }

  function _loadCurrentTab() {
    _warmupGlobalSearch();
    var tab = _state.activeTab;

    if (tab === 'favorites') {
      _renderFavorites();
      return;
    }
    if (tab === 'recents') {
      _renderRecents();
      return;
    }

    Renderer.setLoading(true);
    Renderer.setEmpty(false);

    if (_state.mode === 'xtream') {
      _loadXtreamTab(tab);
    } else if (_state.mode === 'm3u') {
      _loadM3UTab(tab);
    }
  }

  /* ══════════════ Demo Tab Loading ══════════════ */
  function _loadDemoTab(tab) {
    var data = _state.demoData;
    if (!data) { Renderer.setLoading(false); Renderer.setEmpty(true); return; }

    var allDemo = data.liveStreams.concat(data.vodStreams).concat(data.seriesList);
    Search.setGlobalData(allDemo);

    if (tab === 'live') {
      _renderCategories(data.liveCategories, function (catId) {
        var items = catId
          ? data.liveStreams.filter(function (s) { return s.category_id === catId; })
          : data.liveStreams;
        _renderGrid(items);
      });
      _renderGrid(data.liveStreams);
      Search.setTabData(data.liveStreams);
    } else if (tab === 'movies') {
      _renderCategories(data.vodCategories, function (catId) {
        var items = catId
          ? data.vodStreams.filter(function (s) { return s.category_id === catId; })
          : data.vodStreams;
        _renderGrid(items);
      });
      _renderGrid(data.vodStreams);
      Search.setTabData(data.vodStreams);
    } else if (tab === 'series') {
      _renderCategories(data.seriesCategories, function (catId) {
        var items = catId
          ? data.seriesList.filter(function (s) { return s.category_id === catId; })
          : data.seriesList;
        _renderGrid(items);
      });
      _renderGrid(data.seriesList);
      Search.setTabData(data.seriesList);
    }
    Renderer.setLoading(false);
  }

  /* ══════════════ Xtream Tab Loading (por categoria) ══════════════ */
  function _loadXtreamTab(tab) {
    // Passo 1: busca apenas as categorias (leve, rápido)
    var getCats, getStreams;

    if (tab === 'live') {
      getCats    = API.getLiveCategories;
      getStreams  = API.getLiveStreams;
    } else if (tab === 'movies') {
      getCats    = API.getVodCategories;
      getStreams  = API.getVodStreams;
    } else if (tab === 'series') {
      getCats    = API.getSeriesCategories;
      getStreams  = API.getSeriesList;
    } else {
      Renderer.setLoading(false);
      return;
    }

    getCats().then(function (cats) {
      _renderCategoriesLazy(cats, getStreams);

      // Carrega TUDO desta aba em background para permitir busca inline completa na aba
      getStreams('').then(function(allTab) {
        Search.setTabData(allTab);
      }).catch(function(){});

      if (cats && cats.length > 0) {
        var firstCat = cats[0];
        _state.activeCategory = firstCat.category_id;
        var token = ++_state.loadToken;
        getStreams(firstCat.category_id).then(function (items) {
          if (token !== _state.loadToken) return; /* descarta resposta antiga */
          _renderGrid(items);
          Renderer.setLoading(false);
        }).catch(_handleLoadError);
      } else {
        Renderer.setLoading(false);
        Renderer.setEmpty(true);
      }
    }).catch(_handleLoadError);
  }

  /**
   * Renderiza filtros de categoria com carregamento lazy por click.
   * Marca o primeiro botão como ativo e controla estado de seleção.
   */
  function _renderCategoriesLazy(categories, getStreams) {
    var container = document.getElementById('category-filter');
    if (!container) return;
    container.innerHTML = '';

    // Botão "Todos" – mostra atenção: pode ser lento em listas grandes
    // Removido: na carga por categoria evitamos "Todos" para não travar a TV

    if (!categories || !categories.length) return;

    categories.forEach(function (cat, idx) {
      var btn = document.createElement('button');
      btn.className = 'cat-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = cat.category_name;
      btn.dataset.catId = cat.category_id;
      btn.tabIndex = 0;

      btn.addEventListener('click', function () {
        if (_state.activeCategory === cat.category_id) return;
        _state.activeCategory = cat.category_id;

        var btns = container.querySelectorAll('.cat-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
        btn.classList.add('active');

        /* Incrementa token: qualquer resposta com token antigo será descartada */
        var token = ++_state.loadToken;
        Renderer.setLoading(true);
        getStreams(cat.category_id).then(function (items) {
          if (token !== _state.loadToken) return; /* resposta de categoria antiga — ignora */
          _renderGrid(items);
          Renderer.setLoading(false);
        }).catch(function (e) {
          if (token !== _state.loadToken) return;
          _handleLoadError(e);
        });
      });

      btn.addEventListener('keydown', function (e) {
        if (e.keyCode === 13) { e.preventDefault(); btn.click(); }
      });

      container.appendChild(btn);
    });
  }

  /* ══════════════ M3U Tab Loading (por categoria) ══════════════ */
  function _loadM3UTab(tab) {
    API.loadM3U().then(function (allItems) {
      var typeMap = { live: 'live', movies: 'movie', series: 'series' };
      var typeFilter = typeMap[tab];
      var filtered = typeFilter
        ? allItems.filter(function (i) { return i._type === typeFilter; })
        : allItems;

      // Cria pseudo-categorias a partir dos grupos
      var groups = {};
      filtered.forEach(function (item) {
        var g = item.category_name || item.group || 'Outros';
        if (!groups[g]) groups[g] = { category_id: g, category_name: g };
      });
      var cats = Object.values ? Object.values(groups) : Object.keys(groups).map(function(k){ return groups[k]; });

      // Renderiza categorias com carregamento lazy
      _renderCategoriesLazy(cats, function (catId) {
        return new Promise(function (resolve) {
          var items = filtered.filter(function (i) { return (i.category_name || i.group) === catId; });
          resolve(items);
        });
      });

      // Auto-seleciona primeira categoria
      if (cats && cats.length > 0) {
        _state.activeCategory = cats[0].category_id;
        var firstItems = filtered.filter(function (i) {
          return (i.category_name || i.group) === cats[0].category_id;
        });
        _renderGrid(firstItems);
      } else {
        _renderGrid(filtered);
      }
      Search.setTabData(filtered);
      Renderer.setLoading(false);
    }).catch(_handleLoadError);
  }

  function _handleLoadError(err) {
    Renderer.setLoading(false);
    Renderer.setEmpty(true);
    Renderer.showToast('Erro ao carregar: ' + (err && err.message ? err.message : 'falha de conexão'), 'error');
    console.error('[App] Erro ao carregar:', err);
  }

  /* ══════════════ Renderização ══════════════ */
  function _renderGrid(items) {
    var grid = document.getElementById('content-grid');
    if (!grid) return;
    Renderer.cleanItem = null;

    Renderer.renderGrid(grid, items, {
      onPlay:     _playItem,
      onFavorite: function (item, isFav) {
        Renderer.showToast(
          isFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos',
          isFav ? 'success' : 'info'
        );
        // Atualiza aba de favoritos se estiver ativa
        if (_state.activeTab === 'favorites') _renderFavorites();
      }
    });

    Renderer.setEmpty(items.length === 0);
  }

  function _renderCategories(categories, onSelect) {
    var container = document.getElementById('category-filter');
    if (!container) return;
    Renderer.renderCategoryFilter(container, categories, onSelect);
  }

  function _renderFavorites() {
    Renderer.setLoading(false);
    var favs = Storage.getFavoritesArray();
    // Reconstrói itens no formato adequado
    var items = favs.map(function (f) {
      return {
        stream_id:     f.type === 'live' ? f.id : null,
        vod_id:        f.type === 'movie' ? f.id : null,
        series_id:     f.type === 'series' ? f.id : null,
        name:          f.name,
        _type:         f.type,
        stream_icon:   f.icon,
        cover:         f.icon,
        series_cover:  f.icon,
        category_name: f.category
      };
    });
    document.getElementById('category-filter').innerHTML = '';
    _renderGrid(items);
  }

  function _renderRecents() {
    Renderer.setLoading(false);
    var recents = Storage.getRecents();
    var items = recents.map(function (r) {
      return {
        stream_id:     r.type === 'live' ? r.id : null,
        vod_id:        r.type === 'movie' ? r.id : null,
        series_id:     r.type === 'series' ? r.id : null,
        name:          r.name,
        _type:         r.type,
        stream_icon:   r.icon,
        cover:         r.icon,
        series_cover:  r.icon,
        category_name: r.category
      };
    });
    document.getElementById('category-filter').innerHTML = '';
    _renderGrid(items);
  }

  /* ══════════════════════════════════════
     PLAY / DETALHE
  ══════════════════════════════════════ */
  function _playItem(item) {
    var type = item._type || 'live';

    // Se mini-player estiver ativo e o usuário clicar em canal diferente,
    // fecha o mini antes de abrir o full-screen
    if (_state.miniActive) {
      _deactivateMiniPlayer(false /* não para o player agora, _openPlayer vai trocar */);
    }

    if (type === 'live') {
      _openPlayer(item);
    } else if (type === 'movie') {
      _openDetail(item);
    } else if (type === 'series') {
      _openSeriesDetail(item);
    }
  }

  function _openPlayer(item) {
    // Garante que o mini-player é desativado visualmente antes de ir full-screen
    _deactivateMiniPlayer(false);
    Navigation.pushHistory('player');
    _showScreen('player');  /* _showScreen já chama Navigation.setScreen internamente */
    Player.play(item);
    _state.miniItem = item;
    /* Navigation.focusFirst('player'); REMOVIDO para não criar anel de foco no botão Voltar automaticamente */
  }

  /* ══════════════════════════════════════
     DETALHE: FILMES
  ══════════════════════════════════════ */
  function _openDetail(item) {
    _showScreen('detail');
    Navigation.pushHistory('detail');
    Navigation.setScreen('detail');

    // Preenche dados básicos
    _fillDetailUI(item);

    // Episódios: oculta painel de séries
    var epPanel = document.getElementById('series-episodes-panel');
    if (epPanel) epPanel.classList.add('hidden');

    // Botão detalhes: abre player direto
    var playBtn = document.getElementById('detail-play');
    if (playBtn) {
      playBtn.onclick = function () { _openPlayer(item); };
    }

    // Botão favoritar
    _bindDetailFavorite(item);

    // Carrega info extra para filmes Xtream
    if (_state.mode === 'xtream' && item.vod_id) {
      API.getVodInfo(item.vod_id).then(function (info) {
        if (!info || !info.info) return;
        var plotEl = document.getElementById('detail-plot');
        if (plotEl && info.info.plot) plotEl.textContent = info.info.plot;
        var badgesEl = document.getElementById('detail-badges');
        if (badgesEl) {
          badgesEl.innerHTML = '';
          if (info.info.releasedate) badgesEl.appendChild(_badge(info.info.releasedate.substring(0,4), 'badge-year'));
          if (info.info.rating) badgesEl.appendChild(_badge('⭐ ' + info.info.rating, 'badge-rating'));
          if (info.info.genre) {
            info.info.genre.split(',').slice(0,2).forEach(function (g) {
              badgesEl.appendChild(_badge(g.trim(), 'badge-genre'));
            });
          }
        }
      }).catch(function () {});
    }

    Navigation.focusFirst('detail');
  }

  /* ══════════════════════════════════════
     DETALHE: SÉRIES
  ══════════════════════════════════════ */
  function _openSeriesDetail(item) {
    _showScreen('detail');
    Navigation.pushHistory('detail');
    Navigation.setScreen('detail');

    _fillDetailUI(item);

    // Mostra painel de episódios
    var epPanel = document.getElementById('series-episodes-panel');
    if (epPanel) epPanel.classList.remove('hidden');

    // Botão play: vai para S1E1
    var playBtn = document.getElementById('detail-play');
    if (playBtn) playBtn.onclick = function () {};

    _bindDetailFavorite(item);

    // Carrega episódios
    if (_state.mode === 'demo') {
      _renderDemoSeriesEpisodes(item);
    } else if (_state.mode === 'xtream' && item.series_id) {
      _loadXtreamSeriesEpisodes(item);
    }

    Navigation.focusFirst('detail');
  }

  function _renderDemoSeriesEpisodes(series) {
    var seasons = ['Temporada 1', 'Temporada 2', 'Temporada 3'];
    var seasonsRow = document.getElementById('seasons-row');
    var episodesGrid = document.getElementById('episodes-grid');
    seasonsRow.innerHTML = '';
    episodesGrid.innerHTML = '';

    seasons.forEach(function (s, idx) {
      var btn = document.createElement('button');
      btn.className = 'season-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = s;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.season-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        _renderDemoEps(series, idx + 1, episodesGrid);
      });
      seasonsRow.appendChild(btn);
    });

    _renderDemoEps(series, 1, episodesGrid);
  }

  function _renderDemoEps(series, season, container) {
    container.innerHTML = '';
    var count = season === 1 ? 8 : season === 2 ? 10 : 6;
    for (var i = 1; i <= count; i++) {
      var ep = { episode_num: i, title: 'Episódio ' + i, duration: '45min', series_id: series.series_id };
      container.appendChild(_createEpisodeCard(ep, series, i, season));
    }
  }

  function _loadXtreamSeriesEpisodes(series) {
    API.getSeriesInfo(series.series_id).then(function (info) {
      if (!info || !info.seasons) return;
      var seasonsRow = document.getElementById('seasons-row');
      var episodesGrid = document.getElementById('episodes-grid');
      seasonsRow.innerHTML = '';
      episodesGrid.innerHTML = '';

      var seasonNums = Object.keys(info.episodes || {});
      if (!seasonNums.length) return;

      seasonNums.forEach(function (sNum, idx) {
        var btn = document.createElement('button');
        btn.className = 'season-btn' + (idx === 0 ? ' active' : '');
        btn.textContent = 'Temporada ' + sNum;
        btn.addEventListener('click', function () {
          document.querySelectorAll('.season-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          _renderXtreamEps(info.episodes[sNum], series, episodesGrid);
        });
        seasonsRow.appendChild(btn);
      });

      if (seasonNums[0]) _renderXtreamEps(info.episodes[seasonNums[0]], series, episodesGrid);
    }).catch(function (e) {
      console.warn('[App] Erro ao carregar episódios:', e);
    });
  }

  function _renderXtreamEps(episodes, series, container) {
    container.innerHTML = '';
    if (!episodes) return;
    episodes.forEach(function (ep) {
      container.appendChild(_createEpisodeCard(ep, series, ep.episode_num, ep.season));
    });
  }

  function _createEpisodeCard(ep, series, epNum, season) {
    var card = document.createElement('div');
    card.className = 'episode-card';
    card.tabIndex = 0;
    card.setAttribute('aria-label', 'Episódio ' + epNum);

    // Thumb
    var thumb = document.createElement('div');
    thumb.className = 'episode-thumb';
    thumb.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:32px;';
    thumb.textContent = '🎬';
    if (ep.info && ep.info.movie_image) {
      var img = document.createElement('img');
      img.className = 'episode-thumb';
      img.alt = ep.title || '';
      img.src = ep.info.movie_image;
      img.onerror = function () { this.parentNode.replaceChild(thumb, this); };
      card.appendChild(img);
    } else {
      card.appendChild(thumb);
    }

    // Info
    var info = document.createElement('div');
    info.className = 'episode-info';
    var num = document.createElement('div');
    num.className = 'episode-num';
    num.textContent = 'S' + (season || 1) + ' E' + (epNum || ep.episode_num);
    var title = document.createElement('div');
    title.className = 'episode-title';
    title.textContent = ep.title || ep.name || ('Episódio ' + (epNum || ep.episode_num));
    var runtime = document.createElement('div');
    runtime.className = 'episode-runtime';
    runtime.textContent = (ep.info && ep.info.duration) ? ep.info.duration : (series.episode_run_time ? series.episode_run_time + ' min' : '');
    info.appendChild(num);
    info.appendChild(title);
    info.appendChild(runtime);
    card.appendChild(info);

    card.addEventListener('click', function () {
      var playItem = Object.assign({}, series, {
        _type: 'series',
        _episodeId: ep.id || ep.stream_id,
        _episodeExt: (ep.container_extension || 'mkv'),
        name: series.name + ' – ' + title.textContent
      });
      _openPlayer(playItem);
    });
    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13) { e.preventDefault(); card.click(); }
    });

    return card;
  }

  function _fillDetailUI(item) {
    var name = item.name || '';
    var icon = item.stream_icon || item.cover || item.series_cover || '';

    var titleEl = document.getElementById('detail-title');
    if (titleEl) titleEl.textContent = name;

    var coverEl = document.getElementById('detail-cover');
    if (coverEl) {
      if (icon) {
        coverEl.src = icon;
        coverEl.style.display = '';
        coverEl.onerror = function () {
          this.style.display = 'none';
        };
      } else {
        coverEl.style.display = 'none';
      }
    }

    // Backdrop
    var backdrop = document.getElementById('detail-backdrop');
    if (backdrop && icon) {
      backdrop.style.backgroundImage = 'url(' + icon + ')';
    }

    // Plot
    var plotEl = document.getElementById('detail-plot');
    if (plotEl) plotEl.textContent = item.plot || item.description || '';

    // Badges básicos
    var badgesEl = document.getElementById('detail-badges');
    if (badgesEl) {
      badgesEl.innerHTML = '';
      if (item.year)   badgesEl.appendChild(_badge(item.year, 'badge-year'));
      if (item.rating) badgesEl.appendChild(_badge('⭐ ' + item.rating, 'badge-rating'));
      if (item.category_name) badgesEl.appendChild(_badge(item.category_name, 'badge-genre'));
    }
  }

  function _bindDetailFavorite(item) {
    var favBtn = document.getElementById('detail-favorite');
    var favIcon = document.getElementById('detail-fav-icon');
    if (!favBtn || !favIcon) return;

    var id = String(item.stream_id || item.series_id || item.vod_id || item.id || '');
    var isFav = Storage.isFavorite(id);
    favIcon.textContent = isFav ? '★' : '☆';
    favBtn.onclick = function () {
      var nowFav = Storage.toggleFavorite(item);
      favIcon.textContent = nowFav ? '★' : '☆';
      Renderer.showToast(nowFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos', nowFav ? 'success' : 'info');
    };
  }

  function _bindDetailEvents() {
    var backBtn = document.getElementById('detail-back');
    if (backBtn) backBtn.addEventListener('click', goBack);
  }

  function _badge(text, cls) {
    var el = document.createElement('span');
    el.className = 'badge ' + (cls || '');
    el.textContent = text;
    return el;
  }

  /* ══════════════════════════════════════
     CONFIGURAÇÕES
  ══════════════════════════════════════ */
  function _bindSettingsEvents() {
    var sizeInc = document.getElementById('size-increase');
    var sizeDec = document.getElementById('size-decrease');
    var clearFavs = document.getElementById('clear-favorites');
    var clearRec  = document.getElementById('clear-recents');
    var clearAll  = document.getElementById('clear-all');

    if (sizeInc) sizeInc.addEventListener('click', function () { _changeScale(10); });
    if (sizeDec) sizeDec.addEventListener('click', function () { _changeScale(-10); });

    if (clearFavs) clearFavs.addEventListener('click', function () {
      Storage.clearFavorites();
      Renderer.showToast('Favoritos removidos', 'info');
    });
    if (clearRec) clearRec.addEventListener('click', function () {
      Storage.clearRecents();
      Renderer.showToast('Histórico limpo', 'info');
    });
    if (clearAll) clearAll.addEventListener('click', function () {
      Storage.clearAll();
      API.clearCache();
      Search.setTabData([]);
      Search.setGlobalData([]);
      Renderer.showToast('Todos os dados removidos', 'info');
    });
  }

  function _changeScale(delta) {
    var s = _state.uiScale + delta;
    s = Math.max(70, Math.min(160, s));
    _state.uiScale = s;
    Storage.setSetting('scale', s);
    document.documentElement.style.fontSize = (s / 100 * 16) + 'px';
    var display = document.getElementById('size-display');
    if (display) display.textContent = s + '%';
  }

  function _applySettings() {
    var settings = Storage.getSettings();
    _state.uiScale = settings.scale || 100;
    document.documentElement.style.fontSize = (_state.uiScale / 100 * 16) + 'px';
  }

  function _updateSettingsDisplay() {
    var display = document.getElementById('size-display');
    if (display) display.textContent = _state.uiScale + '%';

    var accountEl = document.getElementById('settings-account');
    if (accountEl) {
      var creds = Auth.getCredentials();
      if (creds && creds.type === 'xtream') {
        accountEl.textContent = creds.username + ' @ ' + creds.server;
      } else if (creds && creds.type === 'm3u') {
        accountEl.textContent = 'M3U: ' + _truncate(creds.url, 40);
      } else {
        accountEl.textContent = 'Modo de demonstração';
      }
    }
  }

  /* ══════════════════════════════════════
     NAVEGAÇÃO DE TELAS
  ══════════════════════════════════════ */
  function _showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('active');
      screens[i].classList.add('hidden');
    }
    var target = document.getElementById('screen-' + name);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
    }
    Navigation.setScreen(name);
  }

  /* ══════════════════════════════════════
     CHANNEL PICKER (split-screen)
     Metade esquerda: lista de canais
     Metade direita: preview estático do canal atual
  ══════════════════════════════════════ */

  function _activateMiniPlayer() {
    var playerScreen = document.getElementById('screen-player');
    var mainScreen   = document.getElementById('screen-main');
    if (!playerScreen || !mainScreen) return;

    _state.miniActive = true;

    /* Tela principal ocupa a metade esquerda */
    mainScreen.classList.remove('hidden');
    mainScreen.classList.add('active', 'channel-picker-main');

    /* Player vira preview estático na metade direita */
    playerScreen.classList.remove('hidden');
    playerScreen.classList.add('channel-picker-preview');

    /* Nome do canal no hint do preview */
    var previewTitle = document.getElementById('mini-player-title');
    if (previewTitle && _state.miniItem) previewTitle.textContent = _state.miniItem.name || '';

    /* Botão expandir → full-screen */
    var expandBtn = document.getElementById('mini-player-expand');
    if (expandBtn) expandBtn.onclick = _expandMiniPlayer;

    /* Botão fechar → para o stream */
    var closeBtn = document.getElementById('mini-player-close');
    if (closeBtn) closeBtn.onclick = function (e) { e.stopPropagation(); _deactivateMiniPlayer(true); };

    Navigation.setScreen('main');
    Navigation.focusFirst('main');

    playerScreen.addEventListener('click', _onMiniPlayerClick);
  }

  function _onMiniPlayerClick(e) {
    /* Botões com handlers próprios — não propaga */
    if (e.target && (e.target.id === 'mini-player-close' || e.target.id === 'mini-player-expand')) {
      return; /* onclick já definido acima */
    }
    if (e.target && (e.target.id === 'player-back' || e.target.id === 'player-back-from-error')) {
      e.stopPropagation();
      return;
    }
    /* Clique em qualquer área do preview → expande para full-screen */
    _expandMiniPlayer();
  }

  function _expandMiniPlayer() {
    if (!_state.miniActive) return;
    var playerScreen = document.getElementById('screen-player');
    var mainScreen   = document.getElementById('screen-main');

    playerScreen.classList.remove('channel-picker-preview');
    playerScreen.removeEventListener('click', _onMiniPlayerClick);
    if (mainScreen) {
      mainScreen.classList.remove('channel-picker-main');
      mainScreen.classList.add('hidden');
      mainScreen.classList.remove('active');
    }

    _state.miniActive = false;
    Navigation.pushHistory('player');
    Navigation.setScreen('player');
    /* Navigation.focusFirst('player'); REMOVIDO para não ficar com o botão Voltar focado visualmente */
  }

  function _deactivateMiniPlayer(stopPlayer) {
    if (!_state.miniActive) return;
    _state.miniActive = false;
    _state.miniItem   = null;

    var playerScreen = document.getElementById('screen-player');
    var mainScreen   = document.getElementById('screen-main');
    if (playerScreen) {
      playerScreen.classList.remove('channel-picker-preview');
      playerScreen.removeEventListener('click', _onMiniPlayerClick);
      if (stopPlayer) {
        playerScreen.classList.add('hidden');
        playerScreen.classList.remove('active');
        Player.stop();
      }
    }
    if (mainScreen) mainScreen.classList.remove('channel-picker-main');
  }

  function goBack() {
    /* Usa _currentScreen (Navigation.setScreen) que é sempre atualizado,
       ao invés do history que pode ficar dessincronizado. */
    var current = Navigation.getCurrentHistory();
    var screen  = document.querySelector('.screen.active');
    var screenId = screen ? screen.id.replace('screen-', '') : current;

    /* ── Player full-screen ────────────────────────────────── */
    if (screenId === 'player' && !_state.miniActive) {
      var item = _state.miniItem;

      // Canal ao vivo: não para o player, ativa mini-player flutuante
      if (item && item._type === 'live') {
        Navigation.popHistory();
        _activateMiniPlayer();
        return;
      }

      // VOD / Séries: para e volta
      Player.stop();
      _state.miniItem = null;
      Navigation.popHistory();
      _showScreen('main');
      Navigation.focusFirst('main');
      return;
    }

    /* ── Tela de detalhe ───────────────────────────────────── */
    if (screenId === 'detail') {
      Navigation.popHistory();
      _showScreen('main');
      Navigation.focusFirst('main');
      return;
    }

    /* ── Tela principal (main) ─────────────────────────────── */
    if (_state.miniActive) {
      // Mini-player ativo: back fecha o mini
      _deactivateMiniPlayer(true);
    }
  }

  function _handleLogout() {
    Player.stop();
    Auth.logout();
    API.clearCache();
    Search.setTabData([]);
    Search.setGlobalData([]);
    Navigation.clearHistory();
    Navigation.pushHistory('login');
    _showScreen('login');
    Navigation.setScreen('login');
    Navigation.focusFirst('login');
    Renderer.showToast('Desconectado com sucesso', 'info');
  }

  function _truncate(str, max) {
    str = str || '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  /* ══════════════════════════════════════
     API PÚBLICA
  ══════════════════════════════════════ */
  return {
    init:    init,
    goBack:  goBack
  };
})();

// Inicialização quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
