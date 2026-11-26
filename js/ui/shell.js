// Application shell: settings, routing, navigation, global keys, boot.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc;
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
    if (app.trainerSettings) app.trainerSettings.accents = s.accents !== false;
  }
  function programmeDef() { return FT.programme.clean(app.settings.programme) || FT.programme.DEFAULT; }
  function today() { return FT.trainer.dayOf(Date.now()); }
  function saveSettings() {
    applySettings();
    return app.store.saveSettings(app.settings).catch(storageError);
  }
  function saveProfile() { return app.store.saveProfile(app.trainer.profile()).catch(storageError); }
  function storageError(e) {
    app.notice = 'Your progress could not be saved (' + (e && e.message || e) + '). Export your data from Settings: Data to keep it.';
    renderNotice();
  }

  // previous: the stored profile, whose user choices (fixed vocabulary)
  // survive a rebuild from raw sessions.
  function makeTrainer(profile, sessions, previous) {
    app.trainerSettings = { macros: macros(), accents: app.settings.accents !== false };
    var opts = { settings: app.trainerSettings, seed: (Date.now() % 1e6) + 1 };
    if (profile) return FT.trainer.create(Object.assign({ profile: profile }, opts));
    if (sessions && sessions.length) return FT.trainer.rebuild(sessions, Object.assign({ previous: previous }, opts));
    return FT.trainer.create(opts);
  }

  // ---------- routing ----------
  // Three sections: Train, Insights (tabs) and Settings (tabs). Routes are
  // "section" or "section/tab"; older page names still work.
  var SECTIONS = {
    home: { name: 'Train', key: '1' },
    insights: { name: 'Insights', key: '2', tabs: [['focus', 'Focus'], ['errors', 'Errors'], ['progress', 'Progress']] },
    settings: { name: 'Settings', key: '3', tabs: [['typing', 'Typing'], ['training', 'Daily training'], ['keyboard', 'Keyboard'],
      ['appearance', 'Appearance'], ['texts', 'Texts'], ['data', 'Data']] },
  };
  var NAV = ['home', 'insights', 'settings'].map(function (k) { return [k, SECTIONS[k].name, SECTIONS[k].key]; });
  var ALIASES = { sequences: 'insights/focus', errors: 'insights/errors', history: 'insights/progress', insights: 'insights/focus',
    preferences: 'settings/typing', settings: 'settings/typing', texts: 'settings/texts', data: 'settings/data' };
  // direct letters (listed by ?)
  var LETTERS = { p: 'home', q: 'insights/focus', e: 'insights/errors', h: 'insights/progress', s: 'settings/typing', t: 'settings/texts', d: 'settings/data' };
  var VIEWS = {
    home: function () { viewHome(); },
    'insights/focus': function () { viewSequences(); }, 'insights/errors': function () { viewErrors(); }, 'insights/progress': function () { viewHistory(); },
    'settings/typing': function () { viewSettings('typing'); }, 'settings/training': function () { viewSettings('training'); },
    'settings/keyboard': function () { viewSettings('keyboard'); }, 'settings/appearance': function () { viewSettings('appearance'); },
    'settings/texts': function () { viewTexts(); }, 'settings/data': function () { viewData(); },
  };
  function resolve(name) { name = ALIASES[name] || name; return VIEWS[name] ? name : 'home'; }
  function sectionOf(route) { return String(route || '').split('/')[0]; }
  function go(name) {
    name = resolve(name);
    // our own address change arrives later as a hashchange: it must not undo
    // what happened in between (e.g. an exercise started right after)
    if (location.hash.slice(1) !== name) { app.ownHash = name; try { location.hash = name; } catch (e) { /* ignore */ } }
    show(name);
  }
  function show(name) {
    name = resolve(name);
    if (U.holdForLeave && U.holdForLeave()) return; // an exercise in progress is paused, never dropped
    leaveScreen();
    stopTyping();
    app.current = name;
    document.body.classList.remove('typing-mode');
    renderNav();
    VIEWS[name]();
  }
  // The section heading and its tabs, for the top of a tabbed page.
  function sectionHead(section) {
    var S = SECTIONS[section], cur = app.current;
    return '<h1>' + esc(S.name) + '</h1><nav class="tabs sectiontabs" aria-label="' + esc(S.name) + ' pages">' +
      S.tabs.map(function (t) {
        var r = section + '/' + t[0];
        return '<button type="button" data-stab="' + r + '"' + (cur === r ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '</button>';
      }).join('') + '</nav>';
  }
  // Leaving a screen: an exercise waiting for its effort rating is saved
  // without one, and screen-specific key handlers are dropped.
  function leaveScreen() {
    var pending = app.leaveEffort;
    app.leaveEffort = null;
    if (pending) pending();
  }
  function renderNav() {
    app.$nav.innerHTML = NAV.map(function (n) {
      return '<button type="button" data-go="' + n[0] + '"' + (sectionOf(app.current) === n[0] ? ' aria-current="page"' : '') + '>' +
        esc(n[1]) + '<kbd>' + n[2] + '</kbd></button>';
    }).join('');
  }
  function renderNotice() {
    var el = document.getElementById('notice');
    if (!el) return;
    el.hidden = !app.notice;
    el.textContent = app.notice || '';
    if (app.notice) announce(app.notice);
  }
  // Polite announcement for assistive technology (one shared live region).
  function announce(text) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = text; }, 30);
  }
  // Renders a screen. Its keys (app.keys: { Enter: fn, n: fn, ... }) are set by
  // the screen after rendering; rendering any screen clears the previous ones,
  // so no key handler can outlive its screen.
  // Focus moves to the element that had it if it is still there (same id),
  // otherwise to the page heading, so keyboard users never land on <body>.
  function setView(html) {
    app.keys = {};
    closeKeyHelp();
    var had = document.activeElement && document.activeElement.id;
    app.$view.innerHTML = '<div id="notice" class="notice" hidden></div>' + html;
    document.body.classList.toggle('quiet-nav', app.current === 'typing' || app.current === 'effort');
    renderNotice();
    app.$view.querySelectorAll('[data-stab]').forEach(function (b) { b.onclick = function () { go(b.dataset.stab); }; });
    var back = had && document.getElementById(had);
    var target = back && app.$view.contains(back) ? back : app.$view.querySelector('h1') || app.$view;
    if (target.tagName === 'H1' || target === app.$view) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: target.tagName === 'H1' ? false : true });
  }

  // ---------- lists and tabs ----------
  // j/k and the down/up arrows move between the rows of a list ([data-row]);
  // left/right move between tabs ([data-tab]).
  // Not folded away in a closed <details> (its summary stays visible).
  function shown(el) {
    var d = el.closest('details:not([open])');
    return !d || (el.closest('summary') && el.closest('summary').parentNode === d);
  }
  function moveRow(dir) {
    var rows = Array.prototype.slice.call(app.$view.querySelectorAll('[data-row]')).filter(shown);
    if (!rows.length) return false;
    var i = rows.indexOf(document.activeElement);
    if (i < 0) { var sel = app.$view.querySelector('.selected [data-row]'); i = sel ? rows.indexOf(sel) : -1; } // continue from the opened row
    var next = i < 0 ? rows[0] : rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
    next.focus();
    if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function moveTab(dir) {
    var a = document.activeElement, attr = a && a.dataset && (a.dataset.tab != null ? 'tab' : a.dataset.stab != null ? 'stab' : null);
    if (!attr) return false;
    var sel = '[data-' + attr + ']';
    var tabs = Array.prototype.slice.call(a.parentNode.querySelectorAll(sel));
    var next = tabs[(tabs.indexOf(a) + dir + tabs.length) % tabs.length];
    var id = next.dataset[attr];
    next.click();
    var again = app.$view.querySelector('[data-' + attr + '="' + id + '"]');
    if (again) again.focus();
    return true;
  }
  // [ and ] switch to the previous or next tab of the section.
  function stepSection(dir) {
    var sec = SECTIONS[sectionOf(app.current)];
    if (!sec || !sec.tabs) return false;
    var names = sec.tabs.map(function (t) { return sectionOf(app.current) + '/' + t[0]; });
    var i = names.indexOf(app.current);
    if (i < 0) return false;
    go(names[(i + dir + names.length) % names.length]);
    return true;
  }

  // In a form field: Esc leaves it (shortcuts work again), Ctrl+Enter submits
  // its form or presses the main button next to it.
  function fieldKey(e) {
    var el = e.target;
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
      var h = app.$view.querySelector('h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      var form = el.closest('form'), box = el.closest('section, form');
      var btn = (form && form.querySelector('button[type="submit"]')) || (box && (box.querySelector('.btn.primary') || box.querySelector('button')));
      if (btn) { e.preventDefault(); btn.click(); }
    }
  }

  // ---------- keyboard help (?) ----------
  // Built from the key hints the screen shows, so it always matches them.
  function closeKeyHelp() { var el = document.getElementById('keyhelp'); if (el) el.remove(); }
  function keyHelp() {
    var rows = [];
    var seen = {};
    app.$view.querySelectorAll('kbd').forEach(function (k) {
      // the hint's label: its button, link or summary, else the note it sits in
      var owner = k.closest('button, a, summary') || k.parentNode;
      if (owner.closest('#keyhelp') || /^\d–\d$|^[1-5]$/.test(k.textContent) && !k.closest('button')) return;
      var b = owner.cloneNode(true);
      b.querySelectorAll('kbd').forEach(function (x) { x.remove(); });
      var label = b.textContent.replace(/^\s*(or press|press)\s*/i, '').replace(/\s+/g, ' ').trim();
      if (!label || seen[k.textContent]) return;
      seen[k.textContent] = true;
      rows.push([k.textContent, label]);
    });
    if (app.$view.querySelector('[data-row]')) rows.push(['j k ↓ ↑', 'Move through the list'], ['Enter', 'Open the selected row']);
    if (app.$view.querySelector('[data-tab], [data-stab]')) rows.push(['← →', 'Switch tabs (on a tab)']);
    if (app.$view.querySelector('[data-stab]')) rows.push(['[ ]', 'Previous or next tab']);
    var mine = app.keys || {};
    NAV.forEach(function (n) { if (!mine[n[2]]) rows.push([n[2], n[1]]); });
    Object.keys(LETTERS).forEach(function (k) {
      if (mine[k] || seen[k]) return; // this screen uses the key for something else
      var r = LETTERS[k], sec = SECTIONS[sectionOf(r)], tab = sec.tabs && sec.tabs.filter(function (t) { return r === sectionOf(r) + '/' + t[0]; })[0];
      rows.push([k, sec.name + (tab ? ': ' + tab[1] : '')]);
    });
    rows.push(['?', 'Show or hide this list'], ['Esc', 'Close this list']);
    var el = document.createElement('div');
    el.id = 'keyhelp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keyboard shortcuts');
    el.innerHTML = '<h2>Keyboard shortcuts</h2><dl>' + rows.map(function (r) { return '<dt><kbd>' + esc(r[0]) + '</kbd></dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    document.body.appendChild(el);
  }

  // ---------- global keys ----------
  // Letters typed past the end of an exercise must not act as shortcuts.
  function typedJustNow() { return Date.now() - (app.typingEndedAt || 0) < 1500; }
  function onGlobalKey(e) {
    if (e.defaultPrevented) return; // already handled (e.g. a digit answering the effort question)
    if (app.current === 'typing') { if (e.target && e.target.id !== 'capture') U.keyElsewhere(e); return; }
    if (app.current === 'effort') return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) { fieldKey(e); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.getElementById('keyhelp')) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); closeKeyHelp(); return; }
    } else if (e.key === '?') { e.preventDefault(); keyHelp(); return; }
    if ((e.key === 'j' || e.key === 'ArrowDown') && !typedJustNow() && moveRow(1)) { e.preventDefault(); return; }
    if ((e.key === 'k' || e.key === 'ArrowUp') && !typedJustNow() && moveRow(-1)) { e.preventDefault(); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && moveTab(e.key === 'ArrowRight' ? 1 : -1)) { e.preventDefault(); return; }
    var f = app.keys && app.keys[e.key];
    if (f && !(e.key === 'Enter' && /BUTTON|A/.test(tag))) {   // a focused button handles its own Enter
      if (e.key.length === 1 && typedJustNow()) return;
      e.preventDefault(); app.keys = {}; f(); return;
    }
    if (typedJustNow()) return;
    if ((e.key === '[' || e.key === ']') && stepSection(e.key === ']' ? 1 : -1)) { e.preventDefault(); return; }
    var n = NAV.filter(function (x) { return x[2] === e.key; })[0];
    if (n) { e.preventDefault(); go(n[0]); return; }
    if (LETTERS[e.key]) { e.preventDefault(); go(LETTERS[e.key]); }
  }

  // An exercise that was waiting for its effort rating when the page closed.
  function resumeDraft(draft) {
    if (draft.opts && draft.opts.programme) app.run = FT.programme.resume(app.settings.programmeRun, today()) || null;
    U.viewEffort(draft);
  }

  // ---------- boot ----------
  function boot() {
    app.$view = document.getElementById('view');
    app.$nav = document.getElementById('nav');
    document.addEventListener('keydown', onGlobalKey);
    var skip = document.querySelector('a.skip');
    if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); app.$view.focus(); });
    app.$nav.addEventListener('click', function (e) { var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    window.addEventListener('hashchange', function () {
      var h = location.hash.slice(1);
      if (h === app.ownHash) { app.ownHash = null; return; }
      if (!h || (!VIEWS[h] && !ALIASES[h])) return; // not a page (e.g. an in-page link)
      if (resolve(h) === app.current) return;
      if (h !== resolve(h)) { go(h); return; } // an older page name: show its new place
      show(h);
    });
    var adapter;
    var ready = Promise.resolve().then(function () {
      adapter = FT.store.idbAdapter('lesstypos');
      return adapter.keys();
    }).catch(function () { adapter = FT.store.memoryAdapter(); app.storageOk = false; })
      .then(function () {
        app.store = FT.store.create({ adapter: adapter });
        // sessions stored before compaction are re-saved compactly (once)
        return app.store.compactSessions().catch(function () {}).then(app.store.load);
      }).then(function (d) {
        app.settings = FT.settings.clean(d.settings);
        applySettings();
        var rebuild = !d.profile || FT.trainer.needsRebuild(d.profile);
        return (rebuild ? app.store.listSessions() : Promise.resolve([])).then(function (sessions) {
          app.trainer = makeTrainer(rebuild ? null : d.profile, sessions, d.profile);
          if (rebuild && sessions.length) return saveProfile();
        });
      }).then(function () {
        if (!app.storageOk) app.notice = 'This browser does not allow storage for this page, so progress will be lost when you close it. Use Settings: Data → Export to keep it.';
        return app.store.getDraft().catch(function () { return null; });
      }).then(function (draft) {
        if (draft) { resumeDraft(draft); return; }
        show(resolve(location.hash.slice(1)));
      }).catch(function (e) {
        app.$view.innerHTML = '<p class="notice">LessTypos could not start: ' + esc(e && e.message || e) + '</p>';
      });
    FT.app = app;
    FT.ready = ready;
  }


  Object.assign(U, { macros: macros, applySettings: applySettings, programmeDef: programmeDef, today: today, saveSettings: saveSettings, saveProfile: saveProfile, storageError: storageError, makeTrainer: makeTrainer, go: go, show: show, renderNav: renderNav, renderNotice: renderNotice, announce: announce, setView: setView, sectionHead: sectionHead, onGlobalKey: onGlobalKey, boot: boot });
})(globalThis.FT);
