/**
 * app.js – Orquestrador principal do StreamTV
 *
 * CORREÇÕES DESTA VERSÃO:
 * 1. init() usa Auth.restoreSession() — sem requisição de rede no F5.
 * 2. _loadXtreamTab() e _renderCategoriesLazy() usam streaming (onChunk):
 *    mostra os primeiros cards assim que chegam, sem esperar o JSON completo.
 * 3. Renderer.renderGrid() em modo append (true) para acrescentar sem limpar.
 */

var App = (function () {
  'use strict';

  var _state = {
    mode: 'xtream',
    activeTab: 'live',
    activeCategory: '',
    allItems: [],
    renderedCount: 0,
    isLoadingMore: false,
    demoData: null,
    uiScale: 100,
    miniActive: false,
    miniItem: null,
    loadToken: 0
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

    /* Restaura sessão do localStorage SEM requisição de rede */
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
    var isX = document.getElementById('tab-xtream');
    isX = isX && isX.classList.contains('active');
    _setLoginStatus('Conectando…', 'loading');

    if (isX) {
      var srv = (document.getElementById('xtream-server') || {}).value || '';
      var usr = (document.getElementById('xtream-user') || {}).value || '';
      var pwd = (document.getElementById('xtream-pass') || {}).value || '';
      if (!srv || !usr || !pwd) { _setLoginStatus('Preencha todos os campos', 'error'); return; }

      Auth.loginXtream(srv, usr, pwd).then(function (r) {
        if (r.success) {
          _state.mode = 'xtream';
          Storage.saveAuth({ type: 'xtream', server: srv, username: usr, password: pwd });
          _setLoginStatus('Conectado!', 'success');
          setTimeout(_enterMain, 600);
        } else { _setLoginStatus(r.error || 'Falha na conexão', 'error'); }
      });
    } else {
      var url = (document.getElementById('m3u-url') || {}).value || '';
      if (!url) { _setLoginStatus('Insira uma URL M3U', 'error'); return; }

      Auth.loginM3U(url).then(function (r) {
        if (r.success) {
          _state.mode = 'm3u';
          Storage.saveAuth({ type: 'm3u', url: url });
          _setLoginStatus('Lista carregada!', 'success');
          setTimeout(_enterMain, 600);
        } else { _setLoginStatus(r.error || 'Falha ao carregar lista', 'error'); }
      });
    }
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
      var c = Auth.getCredentials();
      nameEl.textContent = (c && c.username) ? c.username : 'Conectado';
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

    /* Scroll infinito para o restante dos itens */
    var mc = document.getElementById('main-content');
    if (mc) {
      mc.addEventListener('scroll', function () {
        if (_state.activeTab === 'settings' || _state.activeTab === 'search') return;
        if (mc.scrollTop + mc.clientHeight >= mc.scrollHeight - 300) _loadMoreItems();
      });
    }

    [document.getElementById('btn-logout'), document.getElementById('settings-logout')]
      .forEach(function (btn) {
        if (btn) btn.addEventListener('click', function () { Storage.clearAuth(); _handleLogout(); });
      });

    Search.initInlineSearch(function (results) {
      if (results === null) _loadCurrentTab(); else _renderGrid(results);
    });
  }

  function _activateTab(tabName) {
    if (_state.miniActive && tabName !== 'live') _deactivateMiniPlayer(true);
    _state.activeTab = tabName;
    _state.activeCategory = '';

    document.querySelectorAll('.menu-item').forEach(function (m) {
      if (m.dataset.tab === tabName) m.classList.add('active');
      else m.classList.remove('active');
    });

    var grid = document.getElementById('content-grid');
    var header = document.querySelector('.content-header');
    var spanel = document.getElementById('tab-search');
    var stpanel = document.getElementById('tab-settings');
    var loading = document.getElementById('content-loading');
    var empty = document.getElementById('content-empty');

    [spanel, stpanel].forEach(function (p) { if (p) p.classList.add('hidden'); });

    if (tabName === 'search') {
      if (grid) grid.style.display = 'none';
      if (header) header.style.display = 'none';
      if (loading) loading.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      if (spanel) spanel.classList.remove('hidden');
      Search.initSearchTab(_playItem);
      return;
    }
    if (tabName === 'settings') {
      if (grid) grid.style.display = 'none';
      if (header) header.style.display = 'none';
      if (loading) loading.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      if (stpanel) stpanel.classList.remove('hidden');
      _updateSettingsDisplay();
      return;
    }

    if (grid) grid.style.display = '';
    if (header) header.style.display = '';
    var titleEl = document.getElementById('content-title');
    if (titleEl) titleEl.textContent = {
      live: 'TV ao Vivo', movies: 'Filmes', series: 'Séries',
      favorites: 'Favoritos', recents: 'Assistidos Recentemente'
    }[tabName] || tabName;

    _loadCurrentTab();
  }

  var _globalSearchWarmed = false;
  function _warmupGlobalSearch() {
    if (_globalSearchWarmed) return;
    _globalSearchWarmed = true;
    if (_state.mode === 'm3u') {
      API.loadM3U().then(function (r) { Search.setGlobalData(r); }).catch(function () { });
    } else {
      Search.setGlobalData([]);
    }
  }

  function _loadCurrentTab() {
    _warmupGlobalSearch();
    var tab = _state.activeTab;
    if (tab === 'favorites') { _renderFavorites(); return; }
    if (tab === 'recents') { _renderRecents(); return; }
    Renderer.setLoading(true);
    Renderer.setEmpty(false);
    if (_state.mode === 'xtream') _loadXtreamTab(tab);
    else if (_state.mode === 'm3u') _loadM3UTab(tab);
  }

  /* ══════════════════════════════════════
     STREAMING PROGRESSIVO — XTREAM
     Mostra cards conforme o JSON vai chegando,
     sem esperar o payload completo.
  ══════════════════════════════════════ */
  function _loadXtreamTab(tab) {
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

  /* Inicia carregamento com streaming para uma categoria */
  function _startStreamingLoad(getStreams, categoryId) {
    var token = ++_state.loadToken;
    var grid = document.getElementById('content-grid');

    /* Limpa grade e estado */
    if (grid) grid.innerHTML = '';
    _state.allItems = [];
    _state.renderedCount = 0;
    _state.isLoadingMore = false;

    var firstChunkReceived = false;

    getStreams(categoryId, function (chunk) {
      /* Descarta chunks de requisições antigas */
      if (token !== _state.loadToken) return;

      /* Na primeira chegada de dados: esconde spinner e mostra grade */
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        Renderer.setLoading(false);
        if (grid) grid.style.display = '';
      }

      _state.allItems = _state.allItems.concat(chunk);

      /* Renderiza apenas os primeiros N itens imediatamente para não travar a TV */
      var limit = _state.activeTab === 'live' ? 100 : 40;
      if (_state.renderedCount < limit && grid) {
        var needed = limit - _state.renderedCount;
        var toRender = chunk.slice(0, needed);
        if (toRender.length > 0) {
          Renderer.renderGrid(grid, toRender, {
            onPlay: _playItem,
            onFavorite: _onFavoriteToggle
          }, true /* append */);
          _state.renderedCount += toRender.length;
        }
      }

      /* Alimenta busca progressivamente */
      if (Search.appendTabData) Search.appendTabData(chunk);

    }).then(function (allItems) {
      if (token !== _state.loadToken) return;

      _state.allItems = allItems || [];
      Search.setTabData(_state.allItems);

      if (!firstChunkReceived) {
        /* Nenhum chunk recebido via streaming (proxy bufferizou tudo) */
        Renderer.setLoading(false);
        _state.renderedCount = 0;
        _loadMoreItems();
      }
      Renderer.setEmpty(_state.allItems.length === 0);
    }).catch(function (e) {
      if (token !== _state.loadToken) return;
      _handleLoadError(e);
    });
  }

  /* Renderiza botões de categoria + lazy loading por clique */
  function _renderCategoriesLazy(categories, getStreams) {
    var container = document.getElementById('category-filter');
    if (!container) return;
    container.innerHTML = '';
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
        container.querySelectorAll('.cat-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        Renderer.setLoading(true);
        _startStreamingLoad(getStreams, cat.category_id);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.keyCode === 13) { e.preventDefault(); btn.click(); }
      });
      container.appendChild(btn);
    });
  }

  /* ─── M3U ─────────────────────────────────────────────────────────────── */
  function _loadM3UTab(tab) {
    API.loadM3U().then(function (all) {
      var tf = { live: 'live', movies: 'movie', series: 'series' }[tab];
      var filtered = tf ? all.filter(function (i) { return i._type === tf; }) : all;

      var groups = {};
      filtered.forEach(function (i) {
        var g = i.category_name || i.group || 'Outros';
        if (!groups[g]) groups[g] = { category_id: g, category_name: g };
      });
      var cats = Object.keys(groups).map(function (k) { return groups[k]; });

      _renderCategoriesLazy(cats, function (catId) {
        return Promise.resolve(filtered.filter(function (i) {
          return (i.category_name || i.group) === catId;
        }));
      });

      _state.allItems = cats.length > 0
        ? filtered.filter(function (i) { return (i.category_name || i.group) === cats[0].category_id; })
        : filtered;

      Search.setTabData(filtered);
      Renderer.setLoading(false);
      _state.renderedCount = 0;
      _loadMoreItems();
      Renderer.setEmpty(_state.allItems.length === 0);
    }).catch(_handleLoadError);
  }

  function _handleLoadError(err) {
    Renderer.setLoading(false);
    Renderer.setEmpty(true);
    Renderer.showToast('Erro ao carregar: ' + (err && err.message ? err.message : 'falha de conexão'), 'error');
    console.error('[App]', err);
  }

  /* ─── Grid / Scroll infinito ─────────────────────────────────────────── */
  function _renderGrid(items) {
    var grid = document.getElementById('content-grid');
    if (!grid) return;
    _state.allItems = items || [];
    _state.renderedCount = 0;
    _state.isLoadingMore = false;
    grid.innerHTML = '';
    _loadMoreItems();
    Renderer.setEmpty(_state.allItems.length === 0);
  }

  function _loadMoreItems() {
    if (_state.isLoadingMore) return;
    if (!_state.allItems || _state.renderedCount >= _state.allItems.length) return;
    var grid = document.getElementById('content-grid');
    if (!grid) return;
    _state.isLoadingMore = true;
    if (_state.renderedCount > 0) Renderer.setLoadingMore(true);
    setTimeout(function () {
      var bs = _state.activeTab === 'live' ? 100 : 40;
      var start = _state.renderedCount;
      var end = Math.min(start + bs, _state.allItems.length);
      Renderer.renderGrid(grid, _state.allItems.slice(start, end), {
        onPlay: _playItem, onFavorite: _onFavoriteToggle
      }, true);
      _state.renderedCount = end;
      _state.isLoadingMore = false;
      Renderer.setLoadingMore(false);
    }, 80);
  }

  function _onFavoriteToggle(item, isFav) {
    Renderer.showToast(isFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos', isFav ? 'success' : 'info');
    if (_state.activeTab === 'favorites') _renderFavorites();
  }

  function _renderFavorites() {
    Renderer.setLoading(false);
    var items = Storage.getFavoritesArray().map(function (f) {
      return {
        stream_id: f.type === 'live' ? f.id : null, vod_id: f.type === 'movie' ? f.id : null,
        series_id: f.type === 'series' ? f.id : null, name: f.name, _type: f.type,
        stream_icon: f.icon, cover: f.icon, series_cover: f.icon, category_name: f.category
      };
    });
    document.getElementById('category-filter').innerHTML = '';
    _renderGrid(items);
  }

  function _renderRecents() {
    Renderer.setLoading(false);
    var items = Storage.getRecents().map(function (r) {
      return {
        stream_id: r.type === 'live' ? r.id : null, vod_id: r.type === 'movie' ? r.id : null,
        series_id: r.type === 'series' ? r.id : null, name: r.name, _type: r.type,
        stream_icon: r.icon, cover: r.icon, series_cover: r.icon, category_name: r.category
      };
    });
    document.getElementById('category-filter').innerHTML = '';
    _renderGrid(items);
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
    if (_state.mode === 'xtream' && item.vod_id) {
      API.getVodInfo(item.vod_id).then(function (info) {
        if (!info || !info.info) return;
        var plotEl = document.getElementById('detail-plot');
        if (plotEl && info.info.plot) plotEl.textContent = info.info.plot;
        var badgesEl = document.getElementById('detail-badges');
        if (badgesEl) {
          badgesEl.innerHTML = '';
          if (info.info.releasedate) badgesEl.appendChild(_badge(info.info.releasedate.substring(0, 4), 'badge-year'));
          if (info.info.rating) badgesEl.appendChild(_badge('⭐ ' + info.info.rating, 'badge-rating'));
          if (info.info.genre) info.info.genre.split(',').slice(0, 2).forEach(function (g) {
            badgesEl.appendChild(_badge(g.trim(), 'badge-genre'));
          });
        }
      }).catch(function () { });
    }
    Navigation.focusFirst('detail');
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
    Navigation.focusFirst('detail');
  }

  function _loadXtreamSeriesEpisodes(series) {
    API.getSeriesInfo(series.series_id).then(function (info) {
      if (!info || !info.episodes) return;
      var seasonsRow = document.getElementById('seasons-row');
      var episodesGrid = document.getElementById('episodes-grid');
      seasonsRow.innerHTML = ''; episodesGrid.innerHTML = '';
      var snums = Object.keys(info.episodes || {});
      if (!snums.length) return;
      snums.forEach(function (sNum, idx) {
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
      _renderXtreamEps(info.episodes[snums[0]], series, episodesGrid);
      var playBtn = document.getElementById('detail-play');
      if (playBtn && info.episodes[snums[0]] && info.episodes[snums[0]][0]) {
        var ep0 = info.episodes[snums[0]][0];
        playBtn.onclick = function () {
          _openPlayer(Object.assign({}, series, {
            _type: 'series', _episodeId: ep0.id || ep0.stream_id,
            _episodeExt: ep0.container_extension || 'mkv',
            name: series.name + ' – S1 E' + (ep0.episode_num || 1)
          }));
        };
      }
    }).catch(function (e) { console.warn('[App] Episódios:', e); });
  }

  function _renderXtreamEps(episodes, series, container) {
    container.innerHTML = '';
    if (!episodes) return;
    episodes.forEach(function (ep) { container.appendChild(_createEpisodeCard(ep, series)); });
  }

  function _createEpisodeCard(ep, series) {
    var card = document.createElement('div');
    card.className = 'episode-card'; card.tabIndex = 0;
    var thumb = document.createElement('div');
    thumb.className = 'episode-thumb';
    thumb.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg-input);font-size:28px;';
    thumb.textContent = '🎬';
    if (ep.info && ep.info.movie_image) {
      var img = document.createElement('img');
      img.className = 'episode-thumb'; img.alt = ep.title || '';
      img.src = ep.info.movie_image;
      img.onerror = function () { if (this.parentNode) this.parentNode.replaceChild(thumb, this); };
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
    card.addEventListener('click', function () {
      _openPlayer(Object.assign({}, series, {
        _type: 'series', _episodeId: ep.id || ep.stream_id,
        _episodeExt: ep.container_extension || 'mkv',
        name: series.name + ' – ' + titleEl.textContent
      }));
    });
    card.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); card.click(); } });
    return card;
  }

  function _fillDetailUI(item) {
    var icon = item.stream_icon || item.cover || item.series_cover || '';
    var t = document.getElementById('detail-title'); if (t) t.textContent = item.name || '';
    var c = document.getElementById('detail-cover');
    if (c) { if (icon) { c.src = icon; c.style.display = ''; c.onerror = function () { this.style.display = 'none'; }; } else c.style.display = 'none'; }
    var bd = document.getElementById('detail-backdrop');
    if (bd && icon) bd.style.backgroundImage = 'url(' + icon + ')';
    var p = document.getElementById('detail-plot'); if (p) p.textContent = item.plot || item.description || '';
    var bx = document.getElementById('detail-badges');
    if (bx) {
      bx.innerHTML = '';
      if (item.year) bx.appendChild(_badge(item.year, 'badge-year'));
      if (item.rating) bx.appendChild(_badge('⭐ ' + item.rating, 'badge-rating'));
      if (item.category_name) bx.appendChild(_badge(item.category_name, 'badge-genre'));
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
    el.className = 'badge ' + (cls || ''); el.textContent = txt; return el;
  }

  /* ══════════════════════════════════════
     CONFIGURAÇÕES
  ══════════════════════════════════════ */
  function _bindSettingsEvents() {
    var si = document.getElementById('size-increase'), sd = document.getElementById('size-decrease');
    var cf = document.getElementById('clear-favorites'), cr = document.getElementById('clear-recents');
    var ca = document.getElementById('clear-all');
    if (si) si.addEventListener('click', function () { _changeScale(10); });
    if (sd) sd.addEventListener('click', function () { _changeScale(-10); });
    if (cf) cf.addEventListener('click', function () { Storage.clearFavorites(); Renderer.showToast('Favoritos removidos', 'info'); });
    if (cr) cr.addEventListener('click', function () { Storage.clearRecents(); Renderer.showToast('Histórico limpo', 'info'); });
    if (ca) ca.addEventListener('click', function () {
      Storage.clearAll(); API.clearCache();
      Search.setTabData([]); Search.setGlobalData([]);
      Renderer.showToast('Todos os dados removidos', 'info');
    });
  }

  function _changeScale(delta) {
    var s = Math.max(70, Math.min(160, _state.uiScale + delta));
    _state.uiScale = s;
    Storage.setSetting('scale', s);
    document.documentElement.style.fontSize = (s / 100 * 16) + 'px';
    var d = document.getElementById('size-display'); if (d) d.textContent = s + '%';
  }

  function _applySettings() {
    var s = Storage.getSettings();
    _state.uiScale = s.scale || 100;
    document.documentElement.style.fontSize = (_state.uiScale / 100 * 16) + 'px';
  }

  function _updateSettingsDisplay() {
    var d = document.getElementById('size-display'); if (d) d.textContent = _state.uiScale + '%';
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
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active'); s.classList.add('hidden');
    });
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

  function goBack() {
    var screen = document.querySelector('.screen.active');
    var sid = screen ? screen.id.replace('screen-', '') : '';
    if (sid === 'player' && !_state.miniActive) {
      Player.stop(); _state.miniItem = null;
      Navigation.popHistory(); _showScreen('main'); Navigation.focusFirst('main');
      return;
    }
    if (sid === 'detail') {
      Navigation.popHistory(); _showScreen('main'); Navigation.focusFirst('main');
      return;
    }
  }

  function _handleLogout() {
    Player.stop(); Auth.logout(); API.clearCache();
    Search.setTabData([]); Search.setGlobalData([]);
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
