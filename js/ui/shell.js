// Application shell: settings, routing, navigation, global keys, boot.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EXERCISES = U.EXERCISES, EFFORT = U.EFFORT, DEFAULT_SETTINGS = U.DEFAULT_SETTINGS;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix, pill = FT.fmt.pill;
  // defined in other ui files
  function startExercise() { return U.startExercise.apply(null, arguments); }
  function stopTyping() { return U.stopTyping.apply(null, arguments); }
  function viewData() { return U.viewData.apply(null, arguments); }
  function viewErrors() { return U.viewErrors.apply(null, arguments); }
  function viewHistory() { return U.viewHistory.apply(null, arguments); }
  function viewHome() { return U.viewHome.apply(null, arguments); }
  function viewSequences() { return U.viewSequences.apply(null, arguments); }
  function viewSettings() { return U.viewSettings.apply(null, arguments); }
  function viewTexts() { return U.viewTexts.apply(null, arguments); }

  // ---------- settings ----------
  function macros() {
    var m = (app.settings.macros || []).slice();
    if (app.layout) app.layout.macros.forEach(function (x) { if (m.indexOf(x) < 0) m.push(x); });
    return m;
  }
  function applySettings() {
    var s = app.settings;
    document.documentElement.style.setProperty('--type-size', s.fontSize + 'rem');
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', s.theme);
    app.layout = null;
    if (s.layoutText && s.layoutText.trim()) { try { app.layout = FT.layout.parse(s.layoutText); } catch (e) { app.layout = null; } }
    if (app.trainerSettings) app.trainerSettings.macros = macros();
    FT.text.setOptions({ accents: s.accents !== false });
  }
  function programmeDef() { return app.settings.programme || FT.programme.DEFAULT; }
  function today() { return FT.trainer.dayOf(Date.now()); }
  function saveSettings() {
    applySettings();
    return app.store.saveSettings(app.settings).catch(storageError);
  }
  function saveProfile() { return app.store.saveProfile(app.trainer.profile()).catch(storageError); }
  function storageError(e) {
    app.notice = 'Your progress could not be saved (' + (e && e.message || e) + '). Export your data from the Data page to keep it.';
    renderNotice();
  }

  function makeTrainer(profile, sessions) {
    app.trainerSettings = { macros: macros() };
    var opts = { settings: app.trainerSettings, seed: (Date.now() % 1e6) + 1 };
    if (profile) return FT.trainer.create(Object.assign({ profile: profile }, opts));
    if (sessions && sessions.length) return FT.trainer.rebuild(sessions, opts);
    return FT.trainer.create(opts);
  }

  // ---------- routing ----------
  var ROUTES = ['home', 'texts', 'sequences', 'errors', 'history', 'preferences', 'data'];
  var NAV = [['home', 'Practice', 'p'], ['texts', 'Texts', 't'], ['sequences', 'Sequences', 'q'], ['errors', 'Errors', 'e'],
    ['history', 'History', 'h'], ['preferences', 'Settings', 's'], ['data', 'Data', 'd']];
  function go(name) {
    if (ROUTES.indexOf(name) < 0) name = 'home';
    if (location.hash.slice(1) !== name) { try { location.hash = name; } catch (e) { /* ignore */ } }
    show(name);
  }
  function show(name) {
    stopTyping();
    app.current = name;
    document.body.classList.remove('typing-mode');
    renderNav();
    ({ home: viewHome, texts: viewTexts, sequences: viewSequences, errors: viewErrors, history: viewHistory,
      preferences: viewSettings, data: viewData })[name]();
  }
  function renderNav() {
    app.$nav.innerHTML = NAV.map(function (n) {
      return '<button type="button" data-go="' + n[0] + '"' + (app.current === n[0] ? ' aria-app.current="page"' : '') + '>' +
        esc(n[1]) + '<kbd>' + n[2] + '</kbd></button>';
    }).join('');
  }
  function renderNotice() {
    var el = document.getElementById('notice');
    if (!el) return;
    el.hidden = !app.notice;
    el.textContent = app.notice || '';
  }
  function setView(html) {
    app.$view.innerHTML = '<div id="notice" class="notice" hidden></div>' + html;
    renderNotice();
  }

  // ---------- global keys ----------
  function onGlobalKey(e) {
    if (app.current === 'typing' || app.current === 'effort') return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (app.current === 'summary' && app.progKeys) {
      var k = { Enter: 'next', n: 'skip', r: 'repeat', Escape: 'end' }[e.key];
      if (k && !(k === 'next' && /BUTTON|A/.test(tag))) {
        if (k === 'skip' && !document.getElementById('pskip')) return;
        e.preventDefault(); var f = app.progKeys[k]; app.progKeys = null; f(); return;
      }
    }
    if (e.key === 'Enter' && (app.current === 'home' || app.current === 'summary') && !/BUTTON|A/.test(tag)) {
      e.preventDefault();
      if (app.current === 'summary' && app.again) app.again();
      else if (app.current === 'summary' && document.getElementById('home')) go('home');
      else if (app.current === 'home' && app.homeEnter) app.homeEnter();
      else startExercise('relaxed');
      return;
    }
    var n = NAV.filter(function (x) { return x[2] === e.key; })[0];
    if (n) { e.preventDefault(); go(n[0]); }
  }

  // ---------- boot ----------
  function boot() {
    app.$view = document.getElementById('view');
    app.$nav = document.getElementById('nav');
    document.addEventListener('keydown', onGlobalKey);
    app.$nav.addEventListener('click', function (e) { var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (h !== app.current && ROUTES.indexOf(h) >= 0) show(h); });
    var adapter;
    var ready = Promise.resolve().then(function () {
      adapter = FT.store.idbAdapter('lesstypos');
      return adapter.keys();
    }).catch(function () { adapter = FT.store.memoryAdapter(); app.storageOk = false; })
      .then(function () {
        app.store = FT.store.create({ adapter: adapter });
        return app.store.load();
      }).then(function (d) {
        app.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
        applySettings();
        var rebuild = !d.profile || FT.trainer.needsRebuild(d.profile);
        return (rebuild ? app.store.listSessions() : Promise.resolve([])).then(function (sessions) {
          app.trainer = makeTrainer(rebuild ? null : d.profile, sessions);
          if (rebuild && sessions.length) return saveProfile();
        });
      }).then(function () {
        if (!app.storageOk) app.notice = 'This browser does not allow storage for this page, so progress will be lost when you close it. Use Data → Export to keep it.';
        var h = location.hash.slice(1);
        show(ROUTES.indexOf(h) >= 0 ? h : 'home');
      }).catch(function (e) {
        app.$view.innerHTML = '<p class="notice">LessTypos could not start: ' + esc(e && e.message || e) + '</p>';
      });
    FT.app = app;
    FT.ready = ready;
  }


  Object.assign(U, { macros: macros, applySettings: applySettings, programmeDef: programmeDef, today: today, saveSettings: saveSettings, saveProfile: saveProfile, storageError: storageError, makeTrainer: makeTrainer, go: go, show: show, renderNav: renderNav, renderNotice: renderNotice, setView: setView, onGlobalKey: onGlobalKey, boot: boot });
})(globalThis.FT);
