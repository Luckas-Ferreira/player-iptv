/**
 * app.js — Orquestrador principal (estilo PlaySim simplificado)
 *
 * Layout: topbar + sidebar de categorias + grid de cards.
 * Memória: limites baixos no Pager (renderer.js) + cache simples na API.
 * Bug histórico corrigido: _handleSearch estava definida duas vezes.
 */
var App = (function () {
  'use strict';

  /* Itens máximos mostrados por categoria. Listas IPTV típicas têm
     muito mais — mostrar tudo trava a TV. Busca usa limite maior. */
  var MAX_ITEMS_PER_CATEGORY = 100;

  var _state = {
    mode: 'xtream',          /* 'xtream' | 'm3u' */
    activeTab: 'live',
    activeCategory: '',
    isSearching: false,
    allItems: [],
    loadToken: 0,
    isLoggingIn: false,
    currentEpisodes: []
  };

  var _catLoadTimer = null;

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  function init() {
    Player.init();
    Navigation.init();
    _bindLoginEvents();
    _bindMainEvents();
    _bindDetailEvents();
    _bindSettingsEvents();
    _bindSearchEvents();

    if (Auth.restoreSession()) {
      var c = Auth.getCredentials();
      _state.mode = (c && c.type) || 'xtream';
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

    var btn = document.getElementById('btn-connect');
    if (btn) btn.addEventListener('click', _handleLogin);

    var inputs = document.querySelectorAll('.login-form input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('keydown', function (e) {
        if (e.keyCode === 13) _handleLogin();
      });
    }
  }

  function _switchLoginTab(type) {
    var tabX = document.getElementById('tab-xtream');
    var tabM = document.getElementById('tab-m3u');
    var formX = document.getElementById('form-xtream');
    var formM = document.getElementById('form-m3u');
    if (type === 'xtream') {
      tabX.classList.add('active');    tabX.setAttribute('aria-selected', 'true');
      tabM.classList.remove('active'); tabM.setAttribute('aria-selected', 'false');
      formX.classList.remove('hidden'); formM.classList.add('hidden');
    } else {
      tabM.classList.add('active');    tabM.setAttribute('aria-selected', 'true');
      tabX.classList.remove('active'); tabX.setAttribute('aria-selected', 'false');
      formM.classList.remove('hidden'); formX.classList.add('hidden');
    }
  }

  function _handleLogin() {
    if (_state.isLoggingIn) return;
    var isX = document.getElementById('tab-xtream');
    isX = isX && isX.classList.contains('active');

    _state.isLoggingIn = true;
    _setLoginStatus('Conectando…', 'loading');

    var promise;
    if (isX) {
      var srv = (document.getElementById('xtream-server') || {}).value || '';
      var usr = (document.getElementById('xtream-user')   || {}).value || '';
      var pwd = (document.getElementById('xtream-pass')   || {}).value || '';
      if (!srv || !usr || !pwd) {
        _state.isLoggingIn = false;
        _setLoginStatus('Preencha todos os campos', 'error');
        return;
      }
      promise = Auth.loginXtream(srv, usr, pwd);
    } else {
      var url = (document.getElementById('m3u-url') || {}).value || '';
      if (!url) {
        _state.isLoggingIn = false;
        _setLoginStatus('Insira a URL M3U', 'error');
        return;
      }
      promise = Auth.loginM3U(url);
    }

    promise.then(function (r) {
      _state.isLoggingIn = false;
      if (r.success) {
        _state.mode = isX ? 'xtream' : 'm3u';
        _setLoginStatus('Conectado!', 'success');
        setTimeout(_enterMain, 400);
      } else {
        _setLoginStatus(r.error || 'Falha na conexão', 'error');
      }
    }).catch(function () {
      _state.isLoggingIn = false;
      _setLoginStatus('Erro inesperado', 'error');
    });
  }

  function _setLoginStatus(msg, type) {
    var el = document.getElementById('login-status');
    if (!el) return;
    el.className = 'login-status' + (type ? ' ' + type : '');
    el.textContent = msg;
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
    var items = document.querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        item.addEventListener('click', function () { _activateTab(item.dataset.tab); });
        item.addEventListener('keydown', function (e) {
          if (e.keyCode === 13) { e.preventDefault(); _activateTab(item.dataset.tab); }
        });
      })(items[i]);
    }

    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', _handleLogout);
  }

  function _activateTab(tabName) {
    Renderer.destroyVirtualScroll();

    _state.activeTab = tabName;
    _state.activeCategory = '';
    _state.isSearching = false;

    /* Marca aba ativa no menu */
    var items = document.querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.tab === tabName) items[i].classList.add('active');
      else                                  items[i].classList.remove('active');
    }

    /* Limpa containers */
    var grid = document.getElementById('content-grid');
    var cat  = document.getElementById('category-filter');
    if (grid) grid.innerHTML = '';
    if (cat)  cat.innerHTML  = '';

    /* Toggle busca (só faz sentido em Filmes/Séries) */
    var searchBar = document.getElementById('header-search-form');
    var searchInput = document.getElementById('header-search-input');
    if (searchBar) {
      if (tabName === 'movies' || tabName === 'series') searchBar.classList.remove('hidden');
      else searchBar.classList.add('hidden');
    }
    if (searchInput) searchInput.value = '';

    /* Título do conteúdo */
    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = {
      live: 'TV ao Vivo',
      movies: 'Filmes',
      series: 'Séries',
      favorites: 'Favoritos',
      watchlist: 'Continuar Assistindo',
      settings: 'Configurações'
    }[tabName] || tabName;

    /* Settings tem layout próprio */
    var settingsPanel = document.getElementById('tab-settings');
    if (settingsPanel) {
      if (tabName === 'settings') settingsPanel.classList.remove('hidden');
      else                         settingsPanel.classList.add('hidden');
    }

    /* Esconde "Continuar Assistindo" faixa nas abas que não usam */
    var cwRow = document.getElementById('continue-watching-row');
    if (cwRow) cwRow.classList.add('hidden');

    if (tabName === 'settings')   { _updateSettingsDisplay(); return; }
    if (tabName === 'favorites')  { _renderFavorites(); return; }
    if (tabName === 'watchlist')  { _renderWatchlist(); return; }

    /* Live/movies/series */
    Renderer.setLoading(true);
    Renderer.setEmpty(false);
    if (_state.mode === 'xtream') _loadXtreamTab(tabName);
    else                          _loadM3UTab(tabName);
  }

  /* ══════════════════════════════════════
     "Continuar Assistindo" — faixa do topo
  ══════════════════════════════════════ */
  function _renderContinueWatchingRow(filterTab) {
    var row = document.getElementById('continue-watching-row');
    var box = document.getElementById('cw-cards-container');
    if (!row || !box) return;

    if (filterTab === 'watchlist' || filterTab === 'favorites' || filterTab === 'settings') {
      row.classList.add('hidden');
      return;
    }

    var items = Storage.getProgressArray();
    var typeMap = { live: 'live', movies: 'movie', series: 'series' };
    var t = typeMap[filterTab];
    if (t) items = items.filter(function (it) { return it._type === t; });

    if (!items.length) { row.classList.add('hidden'); return; }

    row.classList.remove('hidden');
    box.innerHTML = '';
    var shown = items.slice(0, 10);
    for (var i = 0; i < shown.length; i++) {
      box.appendChild(Renderer.createCard(shown[i], {
        showTypeBadge: true,
        onPlay: _playItem,
        onRemove: function (targetItem) {
          var id = String(targetItem._episodeId || targetItem.vod_id || targetItem.stream_id || targetItem.id || '');
          Storage.removeProgress(id);
          _renderContinueWatchingRow(_state.activeTab);
        }
      }));
    }
  }

  /* ══════════════════════════════════════
     CARREGAMENTO DE ABAS
  ══════════════════════════════════════ */
  function _loadXtreamTab(tab) {
    _renderContinueWatchingRow(tab);

    var getCats, getStreams;
    if      (tab === 'live')   { getCats = API.getLiveCategories;   getStreams = API.getLiveStreams; }
    else if (tab === 'movies') { getCats = API.getVodCategories;    getStreams = API.getVodStreams; }
    else if (tab === 'series') { getCats = API.getSeriesCategories; getStreams = API.getSeriesList; }
    else { Renderer.setLoading(false); return; }

    getCats().then(function (cats) {
      _renderCategories(cats, getStreams);
      if (cats && cats.length > 0) {
        _state.activeCategory = cats[0].category_id;
        _loadStreams(getStreams, cats[0].category_id);
      } else {
        Renderer.setLoading(false);
        Renderer.setEmpty(true);
      }
    }).catch(_handleLoadError);
  }

  function _loadM3UTab(tab) {
    _renderContinueWatchingRow(tab);

    API.loadM3U().then(function (all) {
      var typeFilter = { live: 'live', movies: 'movie', series: 'series' }[tab];
      var filtered = [];
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        if (it && it.name && it.name.trim() !== '' && (!typeFilter || it._type === typeFilter)) {
          filtered.push(it);
        }
      }

      /* Agrupa por categoria */
      var groups = {};
      for (var k = 0; k < filtered.length; k++) {
        var g = filtered[k].category_name || filtered[k].group || 'Outros';
        if (!groups[g]) groups[g] = { category_id: g, category_name: g };
      }
      var cats = [];
      for (var key in groups) {
        if (groups.hasOwnProperty(key)) cats.push(groups[key]);
      }

      _renderCategories(cats, function (catId) {
        var items = [];
        for (var j = 0; j < filtered.length; j++) {
          if ((filtered[j].category_name || filtered[j].group) === catId) {
            items.push(filtered[j]);
            if (items.length >= MAX_ITEMS_PER_CATEGORY) break;
          }
        }
        return Promise.resolve(items);
      });

      if (cats.length > 0) {
        var first = cats[0].category_id;
        var initial = [];
        for (var z = 0; z < filtered.length; z++) {
          if ((filtered[z].category_name || filtered[z].group) === first) {
            initial.push(filtered[z]);
            if (initial.length >= MAX_ITEMS_PER_CATEGORY) break;
          }
        }
        _state.allItems = initial;
        Renderer.setLoading(false);
        _renderGrid(initial);
      } else {
        Renderer.setLoading(false);
        Renderer.setEmpty(true);
      }
    }).catch(_handleLoadError);
  }

  function _loadStreams(getStreams, categoryId, search) {
    var token = ++_state.loadToken;
    var grid = document.getElementById('content-grid');
    var firstReceived = false;
    var collected = [];

    _state.allItems = [];
    Renderer.setEmpty(false);
    Renderer.Pager.init(grid, { onPlay: _playItem, onFavorite: _onFavoriteToggle });

    var limit = search ? 800 : MAX_ITEMS_PER_CATEGORY;

    getStreams(categoryId, function (chunk) {
      if (token !== _state.loadToken) return;
      if (collected.length >= limit) return;

      /* Filtra itens sem nome */
      var valid = [];
      for (var i = 0; i < chunk.length; i++) {
        var it = chunk[i];
        if (it && it.name && it.name.trim() !== '') {
          if (search) {
            var q = search.toLowerCase();
            if (it.name.toLowerCase().indexOf(q) === -1) continue;
          }
          valid.push(it);
          if (collected.length + valid.length >= limit) break;
        }
      }
      if (!valid.length) return;

      if (collected.length + valid.length > limit) {
        valid = valid.slice(0, limit - collected.length);
      }
      collected = collected.concat(valid);

      if (!firstReceived) {
        firstReceived = true;
        Renderer.setLoading(false);
        if (grid) grid.style.display = '';
      }

      _state.allItems = collected;
      Renderer.Pager.append(valid);
    }, search).then(function () {
      if (token !== _state.loadToken) return;
      Renderer.setLoading(false);
      Renderer.setEmpty(collected.length === 0);
    }).catch(function (e) {
      if (token !== _state.loadToken) return;
      _handleLoadError(e);
    });
  }

  function _renderCategories(categories, getStreams) {
    var container = document.getElementById('category-filter');
    if (!container) return;
    container.innerHTML = '';
    if (!categories || !categories.length) return;

    for (var i = 0; i < categories.length; i++) {
      (function (idx) {
        var cat = categories[idx];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cat-btn' + (idx === 0 ? ' active' : '');
        btn.textContent = cat.category_name;
        btn.dataset.catId = cat.category_id;
        btn.tabIndex = 0;

        btn.addEventListener('click', function () {
          if (_state.activeCategory === cat.category_id) return;
          _state.activeCategory = cat.category_id;
          var all = container.querySelectorAll('.cat-btn');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
          btn.classList.add('active');

          var input = document.getElementById('header-search-input');
          if (input) input.value = '';
          _state.isSearching = false;

          if (_catLoadTimer) { clearTimeout(_catLoadTimer); _catLoadTimer = null; }
          _catLoadTimer = setTimeout(function () {
            _catLoadTimer = null;
            Renderer.destroyVirtualScroll();
            Renderer.setLoading(true);

            if (_state.mode === 'xtream') {
              /* getStreams é função da API que aceita onChunk e usa Pager */
              _loadStreams(getStreams, cat.category_id);
            } else {
              /* M3U: closure retorna Promise<items> direto */
              getStreams(cat.category_id).then(function (items) {
                _state.allItems = items || [];
                Renderer.setLoading(false);
                _renderGrid(_state.allItems);
                Renderer.setEmpty(!_state.allItems.length);
              }).catch(_handleLoadError);
            }
          }, 250);
        });

        container.appendChild(btn);
      })(i);
    }
  }

  function _handleLoadError(err) {
    Renderer.setLoading(false);
    Renderer.setEmpty(true);
    var msg = (err && err.message) || 'falha de conexão';
    if (msg === 'timeout')      msg = 'O servidor demorou para responder';
    else if (msg === 'rede')    msg = 'Sem conexão com o servidor';
    else if (msg.indexOf('JSON') !== -1) msg = 'Resposta inválida do servidor';
    Renderer.showToast('Erro: ' + msg, 'error', 4000);
    console.error('[App]', err);
  }

  function _renderGrid(items, customOpts) {
    var grid = document.getElementById('content-grid');
    if (!grid) return;
    _state.allItems = items || [];
    var opts = customOpts || { onPlay: _playItem, onFavorite: _onFavoriteToggle };
    Renderer.Pager.init(grid, opts);
    Renderer.Pager.append(_state.allItems);
    Renderer.setEmpty(!_state.allItems.length);
  }

  function _onFavoriteToggle(item, isFav) {
    Renderer.showToast(isFav ? '★ Favorito adicionado' : '☆ Favorito removido',
                       isFav ? 'success' : 'info');
    if (_state.activeTab === 'favorites') _renderFavorites();
  }

  function _renderFavorites() {
    Renderer.setLoading(false);
    var cwRow = document.getElementById('continue-watching-row');
    if (cwRow) cwRow.classList.add('hidden');

    var raw = Storage.getFavoritesArray();
    var items = raw.map(function (f) {
      return {
        stream_id: f.type === 'live'   ? f.id : null,
        vod_id:    f.type === 'movie'  ? f.id : null,
        series_id: f.type === 'series' ? f.id : null,
        name: f.name,
        _type: f.type,
        stream_icon: f.icon,
        cover: f.icon,
        series_cover: f.icon,
        category_name: f.category
      };
    });

    var cat = document.getElementById('category-filter');
    if (cat) cat.innerHTML = '';

    _renderGrid(items, {
      onPlay: _playItem,
      onFavorite: _onFavoriteToggle,
      showTypeBadge: true
    });
  }

  function _renderWatchlist() {
    Renderer.setLoading(false);
    var cwRow = document.getElementById('continue-watching-row');
    if (cwRow) cwRow.classList.add('hidden');

    var items = Storage.getProgressArray();
    var cat = document.getElementById('category-filter');
    if (cat) cat.innerHTML = '';

    _renderGrid(items, {
      onPlay: _playItem,
      onFavorite: _onFavoriteToggle,
      showTypeBadge: true,
      onRemove: function (target) {
        var id = String(target._episodeId || target.vod_id || target.stream_id || target.id || '');
        Storage.removeProgress(id);
        _renderWatchlist();
      }
    });
  }

  /* ══════════════════════════════════════
     PLAY / DETALHE
  ══════════════════════════════════════ */
  function _playItem(item) {
    var type = item._type || 'live';
    if      (type === 'live')   _openPlayer(item);
    else if (type === 'movie')  _openDetail(item);
    else if (type === 'series') _openSeriesDetail(item);
  }

  function _openPlayer(item) {
    Navigation.pushHistory('player');
    _showScreen('player');
    Player.play(item);

    var next = _findNextItem(item);
    if (next) {
      Player.setNextItem(next, function () {
        var clone = {};
        for (var k in next) if (next.hasOwnProperty(k)) clone[k] = next[k];
        clone._fromAutoplay = true;
        _openPlayer(clone);
      });
    } else {
      Player.setNextItem(null);
    }
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

  function _openDetail(item) {
    _showScreen('detail');
    Navigation.pushHistory('detail');
    Navigation.setScreen('detail');

    _fillDetailUI(item);

    var epPanel = document.getElementById('series-episodes-panel');
    if (epPanel) epPanel.classList.add('hidden');

    var playBtn = document.getElementById('detail-play');
    if (playBtn) playBtn.onclick = function () { _openPlayer(item); };
    _bindDetailFavorite(item);

    var vodId = item.vod_id || item.stream_id || item.id;
    if (_state.mode === 'xtream' && vodId) {
      var plotEl = document.getElementById('detail-plot');
      if (plotEl && !plotEl.textContent.trim()) {
        plotEl.textContent = 'Carregando detalhes…';
        plotEl.style.color = 'var(--text-3)';
      }

      API.getVodInfo(vodId).then(function (info) {
        if (!info) return;
        var data = info.info || info;
        if (plotEl) plotEl.style.color = '';

        if (plotEl && data.plot) plotEl.textContent = data.plot;
        else if (plotEl && plotEl.textContent === 'Carregando detalhes…') plotEl.textContent = '';

        var dirRow = document.getElementById('detail-director-row');
        var dirEl  = document.getElementById('detail-director');
        if (dirRow && dirEl) {
          if (data.director && data.director !== 'N/A') {
            dirEl.textContent = data.director;
            dirRow.classList.remove('hidden');
          } else dirRow.classList.add('hidden');
        }

        var castRow = document.getElementById('detail-cast-row');
        var castEl  = document.getElementById('detail-cast');
        if (castRow && castEl) {
          if (data.cast && data.cast !== 'N/A') {
            castEl.textContent = data.cast;
            castRow.classList.remove('hidden');
          } else castRow.classList.add('hidden');
        }

        var badges = document.getElementById('detail-badges');
        if (badges) {
          badges.innerHTML = '';
          if (data.releasedate) badges.appendChild(_badge(data.releasedate.substring(0, 4), 'badge-year'));
          else if (item.year)   badges.appendChild(_badge(item.year, 'badge-year'));
          if (data.duration)    badges.appendChild(_badge(data.duration, 'badge-duration'));
          if (data.rating)      badges.appendChild(_badge('★ ' + data.rating, 'badge-rating'));
          if (data.genre) {
            var gs = data.genre.split(',');
            for (var g = 0; g < Math.min(3, gs.length); g++) {
              badges.appendChild(_badge(gs[g].trim(), 'badge-genre'));
            }
          } else if (item.category_name) {
            badges.appendChild(_badge(item.category_name, 'badge-genre'));
          }
        }

        if (data.movie_image || data.cover_big) {
          var better = data.movie_image || data.cover_big;
          var coverEl = document.getElementById('detail-cover');
          if (coverEl) { coverEl.src = better; coverEl.style.display = ''; }
          var bdEl = document.getElementById('detail-backdrop');
          if (bdEl) bdEl.style.backgroundImage = 'url(' + better + ')';
        }
      }).catch(function (e) {
        if (plotEl && plotEl.textContent === 'Carregando detalhes…') plotEl.textContent = '';
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
      var seasonsRow  = document.getElementById('seasons-row');
      var episodesGrid = document.getElementById('episodes-grid');
      seasonsRow.innerHTML  = '';
      episodesGrid.innerHTML = '';

      var snums = Object.keys(info.episodes);
      if (!snums.length) return;

      /* Info da série */
      var si = info.info || {};
      var plotEl = document.getElementById('detail-plot');
      if (plotEl && si.plot) { plotEl.textContent = si.plot; plotEl.style.color = ''; }

      /* Botões de temporada */
      for (var i = 0; i < snums.length; i++) {
        (function (idx) {
          var sNum = snums[idx];
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'season-btn' + (idx === 0 ? ' active' : '');
          btn.textContent = 'Temporada ' + sNum;
          btn.tabIndex = 0;
          btn.addEventListener('click', function () {
            var all = document.querySelectorAll('.season-btn');
            for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
            btn.classList.add('active');
            _renderXtreamEps(info.episodes[sNum], series, episodesGrid);
          });
          seasonsRow.appendChild(btn);
        })(i);
      }

      _renderXtreamEps(info.episodes[snums[0]], series, episodesGrid);

      /* Lista plana de episódios pra autoplay do próximo */
      var allEps = [];
      for (var k = 0; k < snums.length; k++) {
        var arr = info.episodes[snums[k]] || [];
        for (var m = 0; m < arr.length; m++) {
          var ep = arr[m];
          var clone = {};
          for (var key in series) if (series.hasOwnProperty(key)) clone[key] = series[key];
          clone._type        = 'series';
          clone._episodeId   = ep.id || ep.stream_id;
          clone._episodeExt  = ep.container_extension || 'mkv';
          clone.name         = series.name + ' – S' + (ep.season || snums[k]) + ' E' + (ep.episode_num || (m + 1));
          allEps.push(clone);
        }
      }
      _state.currentEpisodes = allEps;

      /* Botão "Assistir" do detail: continua de onde parou ou começa S1E1 */
      var playBtn = document.getElementById('detail-play');
      if (playBtn) {
        var prog = Storage.getSeriesProgress(series.series_id);
        if (prog) {
          playBtn.onclick = function () {
            var item = {};
            for (var key in series) if (series.hasOwnProperty(key)) item[key] = series[key];
            item._type       = 'series';
            item._episodeId  = prog.id;
            item._episodeExt = prog.episodeExt || 'mkv';
            item.name        = prog.name;
            item._resumeTime = prog.time || 0;
            _openPlayer(item);
          };
        } else if (info.episodes[snums[0]] && info.episodes[snums[0]][0]) {
          var ep0 = info.episodes[snums[0]][0];
          playBtn.onclick = function () {
            var item = {};
            for (var key in series) if (series.hasOwnProperty(key)) item[key] = series[key];
            item._type       = 'series';
            item._episodeId  = ep0.id || ep0.stream_id;
            item._episodeExt = ep0.container_extension || 'mkv';
            item.name        = series.name + ' – S1 E' + (ep0.episode_num || 1);
            item._resumeTime = 0;
            _openPlayer(item);
          };
        }
      }
    }).catch(function (e) { console.warn('[App] Episódios:', e); });
  }

  function _renderXtreamEps(episodes, series, container) {
    container.innerHTML = '';
    if (!episodes) return;
    for (var i = 0; i < episodes.length; i++) {
      container.appendChild(_createEpisodeCard(episodes[i], series));
    }
  }

  function _createEpisodeCard(ep, series) {
    var card = document.createElement('div');
    card.className = 'episode-card';
    card.tabIndex = 0;

    if (ep.info && ep.info.movie_image) {
      var img = document.createElement('img');
      img.className = 'episode-thumb';
      img.alt = ep.title || '';
      Renderer.lazyLoadImg(img, ep.info.movie_image);
      card.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'episode-thumb episode-thumb-empty';
      ph.textContent = 'EP';
      card.appendChild(ph);
    }

    var info = document.createElement('div');
    info.className = 'episode-info';

    var num = document.createElement('div');
    num.className = 'episode-num';
    num.textContent = 'S' + (ep.season || 1) + ' E' + (ep.episode_num || '');

    var title = document.createElement('div');
    title.className = 'episode-title';
    title.textContent = ep.title || ep.name || ('Episódio ' + ep.episode_num);

    info.appendChild(num);
    info.appendChild(title);
    card.appendChild(info);

    /* Progresso */
    var progId = ep.id || ep.stream_id;
    var prog = Storage.getProgress(progId);
    if (prog && prog.pct > 1) {
      var bar = document.createElement('div');
      bar.className = 'card-progress';
      var fill = document.createElement('div');
      fill.className = 'card-progress-fill';
      fill.style.width = Math.min(100, prog.pct) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    function open() {
      var item = {};
      for (var key in series) if (series.hasOwnProperty(key)) item[key] = series[key];
      item._type       = 'series';
      item._episodeId  = ep.id || ep.stream_id;
      item._episodeExt = ep.container_extension || 'mkv';
      item.name        = series.name + ' – ' + title.textContent;
      item._resumeTime = 0;
      _openPlayer(item);
    }

    card.addEventListener('click', open);
    card.addEventListener('keydown', function (e) {
      if (e.keyCode === 13) { e.preventDefault(); open(); }
    });

    return card;
  }

  function _fillDetailUI(item) {
    var icon = item.stream_icon || item.cover || item.series_cover || '';

    var t = document.getElementById('detail-title');
    if (t) t.textContent = item.name || '';

    var c = document.getElementById('detail-cover');
    if (c) {
      if (icon) {
        c.src = icon;
        c.style.display = '';
        c.onerror = function () { this.style.display = 'none'; };
      } else c.style.display = 'none';
    }

    var bd = document.getElementById('detail-backdrop');
    if (bd && icon) bd.style.backgroundImage = 'url(' + icon + ')';

    var p = document.getElementById('detail-plot');
    if (p) {
      p.textContent = item.plot || item.description || item.overview || '';
      p.style.color = '';
    }

    var dirRow = document.getElementById('detail-director-row');
    var castRow = document.getElementById('detail-cast-row');
    if (dirRow) dirRow.classList.add('hidden');
    if (castRow) castRow.classList.add('hidden');

    var badges = document.getElementById('detail-badges');
    if (badges) {
      badges.innerHTML = '';
      if (item.year)          badges.appendChild(_badge(item.year, 'badge-year'));
      if (item.rating)        badges.appendChild(_badge('★ ' + item.rating, 'badge-rating'));
      if (item.category_name) badges.appendChild(_badge(item.category_name, 'badge-genre'));
    }

    var playBtn = document.getElementById('detail-play');
    if (playBtn) {
      var itemType = item._type || item.type || 'movie';
      var id = String(item.stream_id || item.vod_id || item.series_id || item.id || item._episodeId || '');
      var prog = Storage.getProgress(id);
      if (!prog && itemType === 'series' && (item.series_id || item.id)) {
        prog = Storage.getSeriesProgress(item.series_id || item.id);
      }
      playBtn.innerHTML = '▶ ' + (prog ? 'Continuar' : 'Assistir');
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
      Renderer.showToast(nf ? '★ Favorito adicionado' : '☆ Favorito removido',
                         nf ? 'success' : 'info');
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
     SETTINGS
  ══════════════════════════════════════ */
  function _bindSettingsEvents() {
    var cf = document.getElementById('clear-favorites');
    var cr = document.getElementById('clear-recents');
    var ca = document.getElementById('clear-all');
    var sr = document.getElementById('settings-refresh');
    var sl = document.getElementById('settings-logout');

    if (cf) cf.addEventListener('click', function () {
      Storage.clearFavorites();
      Renderer.showToast('Favoritos removidos', 'info');
    });
    if (cr) cr.addEventListener('click', function () {
      Storage.clearRecents();
      Renderer.showToast('Histórico limpo', 'info');
    });
    if (ca) ca.addEventListener('click', function () {
      Storage.clearAll();
      API.clearCache();
      Renderer.showToast('Dados locais removidos', 'info');
    });
    if (sr) sr.addEventListener('click', function () {
      API.clearCache();
      Renderer.showToast('Atualizando listas...', 'info');
      setTimeout(function () { _activateTab(_state.activeTab); }, 200);
    });
    if (sl) sl.addEventListener('click', _handleLogout);
  }

  function _updateSettingsDisplay() {
    var a = document.getElementById('settings-account');
    if (a) {
      var c = Auth.getCredentials();
      if (c && c.type === 'xtream') a.textContent = c.username + ' @ ' + c.server;
      else if (c && c.type === 'm3u') a.textContent = 'M3U: ' + (c.url || '').substring(0, 40);
      else a.textContent = '—';
    }
  }

  /* ══════════════════════════════════════
     TELAS
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

  /* ══════════════════════════════════════
     BUSCA
  ══════════════════════════════════════ */
  function _bindSearchEvents() {
    var form  = document.getElementById('header-search-form');
    var input = document.getElementById('header-search-input');
    var btn   = document.getElementById('header-search-btn');
    var topBtn = document.getElementById('topbar-search-btn');

    if (!form || !input || !btn) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      _handleSearch();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      _handleSearch();
    });

    /* TVs antigas precisam capturar Enter ANTES do navigation.js fazer blur */
    input.addEventListener('keydown', function (e) {
      var code = e.keyCode || e.which;
      if (code === 13 || code === 195) {
        e.preventDefault();
        e.stopPropagation();
        _handleSearch();
      }
    }, true);

    if (topBtn) {
      topBtn.addEventListener('click', function () {
        if (form) form.classList.remove('hidden');
        if (input) {
          input.focus();
          try { input.select(); } catch (e) {}
        }
      });
    }
  }

  function _handleSearch() {
    var input = document.getElementById('header-search-input');
    if (!input) return;
    var query = (input.value || '').trim();
    var tab = _state.activeTab;

    if (!query) {
      if (_state.isSearching) {
        _state.isSearching = false;
        _activateTab(tab);
      }
      return;
    }

    var getStreams;
    if      (tab === 'movies') getStreams = API.getVodStreams;
    else if (tab === 'series') getStreams = API.getSeriesList;
    else if (tab === 'live')   getStreams = API.getLiveStreams;
    else return;

    _state.isSearching = true;
    Renderer.destroyVirtualScroll();
    Renderer.setLoading(true);

    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = 'Busca: ' + query;

    _loadStreams(getStreams, null, query);
  }

  /* ══════════════════════════════════════
     NAVEGAÇÃO
  ══════════════════════════════════════ */
  function goBack() {
    var screen = document.querySelector('.screen.active');
    var sid = screen ? screen.id.replace('screen-', '') : '';

    if (sid === 'player') Player.stop();

    var prev = Navigation.popHistory();
    if (prev) {
      _showScreen(prev);
      if (prev === 'main') Navigation.focusFirst('main');
      else if (prev === 'detail') {
        setTimeout(function () {
          var btn = document.getElementById('detail-play');
          if (btn) {
            /* Atualiza texto do botão (progresso pode ter mudado) */
            var item = btn._detailItem;
            if (item) {
              var itemType = item._type || item.type || 'movie';
              var id = String(item.stream_id || item.vod_id || item.series_id || item.id || item._episodeId || '');
              var prog = Storage.getProgress(id);
              if (!prog && itemType === 'series' && (item.series_id || item.id)) {
                prog = Storage.getSeriesProgress(item.series_id || item.id);
              }
              btn.innerHTML = '▶ ' + (prog ? 'Continuar' : 'Assistir');
            }
            btn.focus();
          }
        }, 100);
      }
    } else {
      _showScreen('main');
      Navigation.focusFirst('main');
    }
  }

  function _handleLogout() {
    Player.stop();
    Storage.clearAuth();
    Auth.logout();
    API.clearCache();
    Navigation.clearHistory();
    Navigation.pushHistory('login');
    _showScreen('login');
    Navigation.setScreen('login');
    Navigation.focusFirst('login');
    Renderer.showToast('Desconectado', 'info');
  }

  return { init: init, goBack: goBack };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
