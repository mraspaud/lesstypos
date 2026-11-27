// Screens and routes. One screen at a time owns the view: its name
// (app.current), the navigation, the address, the focus, its keys and its
// leave hooks. Routes are the screens with an address: "section" or
// "section/tab"; older page names still work.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc;

  // Three sections: Train, Insights (tabs) and Settings (tabs). footer: the
  // page footer (attribution, where data stays) shows on that section's pages.
  var SECTIONS = {
    home: { name: 'Train', key: '1', footer: true },
    insights: { name: 'Insights', key: '2', tabs: [['focus', 'Focus'], ['errors', 'Errors'], ['progress', 'Progress']] },
    settings: { name: 'Settings', key: '3', footer: true, tabs: [['typing', 'Typing'], ['training', 'Daily training'], ['keyboard', 'Keyboard'],
      ['appearance', 'Appearance'], ['texts', 'Texts'], ['data', 'Data']] },
  };
  var NAV = ['home', 'insights', 'settings'].map(function (k) { return { route: k, name: SECTIONS[k].name, key: SECTIONS[k].key }; });
  var ALIASES = { sequences: 'insights/focus', errors: 'insights/errors', history: 'insights/progress', insights: 'insights/focus',
    preferences: 'settings/typing', settings: 'settings/typing', texts: 'settings/texts', data: 'settings/data' };
  var LETTERS = { p: 'home', q: 'insights/focus', e: 'insights/errors', h: 'insights/progress', s: 'settings/typing', t: 'settings/texts', d: 'settings/data' };
  var ROUTES = {};   // route → the function that opens its screen (registered by the view files)

  function route(name, open) { ROUTES[name] = open; }
  function resolve(name) { name = ALIASES[name] || name; return ROUTES[name] ? name : 'home'; }
  function sectionOf(name) { return String(name || '').split('/')[0]; }
  function routeLabel(name) {
    var section = SECTIONS[sectionOf(name)], tab = section.tabs && section.tabs.filter(function (t) { return name === sectionOf(name) + '/' + t[0]; })[0];
    return section.name + (tab ? ': ' + tab[1] : '');
  }

  // ---------- the screen on view ----------
  var active = { name: null, spec: {}, shortcuts: {}, actions: [], generation: 0 };

  // spec.render draws the screen (now or once its data has loaded); spec.keys
  // lists shortcuts without a button (see U.shortcut); spec.onLeave runs when
  // another screen replaces this one; spec.holdOnNavigation, when it returns
  // true, keeps the user on this screen; spec.onKey, if given, takes every
  // key pressed on this screen.
  function screen(name, spec) {
    spec = spec || {};
    var leaving = active;
    active = { name: name, spec: spec, shortcuts: {}, actions: [], generation: leaving.generation + 1 };
    if (leaving.spec.onLeave) leaving.spec.onLeave();
    U.closeKeyHelp();
    app.current = name;
    if (ROUTES[name]) setAddress(name);
    document.body.classList.toggle('typing-mode', name === 'typing');
    document.body.classList.toggle('quiet-nav', name === 'typing' || name === 'effort');
    app.$footer.hidden = !(SECTIONS[sectionOf(name)] || {}).footer;
    renderNav();
    draw();
  }
  // Draws the screen on view again (its data changed): its keys and clicks
  // start afresh, while work it started still completes.
  function redraw() {
    active.shortcuts = {};
    active.actions = [];
    draw();
  }
  function draw() {
    (active.spec.keys || []).forEach(U.shortcut);
    if (active.spec.render) active.spec.render();
  }
  function activeScreen() { return active; }
  // Wraps a callback of async work so it does nothing once the user has
  // moved to another screen.
  function onThisScreen(fn) {
    var generation = active.generation;
    return function () { if (active.generation === generation) return fn.apply(this, arguments); };
  }
  // A click handler for the screen's markup: returns the attribute that binds
  // it. The handler is given the element clicked.
  function action(fn) {
    active.actions.push(fn);
    return ' data-action="' + (active.actions.length - 1) + '"';
  }
  function bindActions(root) {
    var actions = active.actions;
    root.querySelectorAll('[data-action]').forEach(function (el) { el.onclick = function () { perform(actions[+el.dataset.action], el); }; });
  }
  // A form whose submit is one of the screen's actions.
  function onSubmit(form, fn) {
    form.addEventListener('submit', function (e) { e.preventDefault(); perform(fn); });
  }
  // Runs one of the screen's actions (a click or a shortcut). An action that
  // returns a promise holds the screen's other actions until it settles, so a
  // fast second press cannot start the same work twice.
  function perform(act, arg) {
    var screen = active;
    if (screen.busy) return;
    var result = act(arg);
    if (!result || typeof result.then !== 'function') return;
    screen.busy = true;
    var release = function () { screen.busy = false; };
    result.then(release, release);
  }

  // Draws the screen. Focus moves to the element that had it if it is still
  // there (same id, or the summary of the same fold), otherwise to the page
  // heading, so keyboard users never land on <body>. A redraw of the same
  // screen keeps its open folds open.
  var painted = -1;   // the generation of the screen last painted
  function paint(html) {
    var had = document.activeElement && document.activeElement.id;
    var redrawn = painted === active.generation, open = redrawn ? openFolds() : [], summaryOf = redrawn ? focusedFold() : null;
    painted = active.generation;
    app.$view.innerHTML = '<div id="notice" class="notice" hidden></div>' + html;
    folds().forEach(function (f) { if (open.indexOf(f.key) >= 0) f.fold.open = true; });
    renderNotice();
    bindActions(app.$view);
    app.$view.querySelectorAll('[data-stab]').forEach(function (b) { b.onclick = function () { perform(go, b.dataset.stab); }; });
    var back = (had && document.getElementById(had)) || foldSummary(summaryOf);
    var target = back && app.$view.contains(back) ? back : app.$view.querySelector('h1') || app.$view;
    if (target.tagName === 'H1' || target === app.$view) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: target.tagName === 'H1' ? false : true });
  }
  // The folds on view, each with a key that a redraw keeps: its id, or else
  // its place among the folds without one.
  function folds() {
    var unnamed = 0;
    return Array.prototype.map.call(app.$view.querySelectorAll('details'), function (fold) {
      return { fold: fold, key: fold.id ? '#' + fold.id : unnamed++ };
    });
  }
  function openFolds() { return folds().filter(function (f) { return f.fold.open; }).map(function (f) { return f.key; }); }
  // The key of the fold whose summary has the focus, if one has.
  function focusedFold() {
    var el = document.activeElement, found = folds().filter(function (f) { return f.fold.querySelector('summary') === el; })[0];
    return found ? found.key : null;
  }
  function foldSummary(key) {
    var found = key == null ? null : folds().filter(function (f) { return f.key === key; })[0];
    return found && found.fold.querySelector('summary');
  }
  // Redraws one part of the screen.
  function fill(el, html) {
    el.innerHTML = html;
    bindActions(el);
  }
  // The notice: app.notice stays (storage trouble) until it is cleared; a
  // flash shows on the screen on view only, redraws included.
  var flashed = { text: null, generation: -1 };
  function flash(text) {
    flashed = { text: text, generation: active.generation };
    renderNotice();
  }
  function renderNotice() {
    var el = document.getElementById('notice');
    if (!el) return;
    var text = [app.notice, flashed.generation === active.generation ? flashed.text : null].filter(Boolean).join(' ');
    el.hidden = !text;
    el.textContent = text;
    if (text) announce(text);
  }
  // Polite announcement for assistive technology (one shared live region).
  function announce(text) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = text; }, 30);
  }

  // ---------- addresses ----------
  var address = null;   // of the route the user is on (or typed from)
  function replaceAddress(name) {
    if (location.hash.slice(1) !== name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// may refuse */ } }
  }
  function setAddress(name) { address = name; replaceAddress(name); }
  function restoreAddress() { if (address) replaceAddress(address); }
  function staysHere() { return !!(active.spec.holdOnNavigation && active.spec.holdOnNavigation()); }
  // Each address the app sets arrives later as its own hashchange, after
  // whatever happened in between (e.g. an exercise started right after):
  // those events are the app's own, not the user's, and are let pass.
  var ownAddresses = [];
  function go(name) {
    name = resolve(name);
    if (staysHere()) return;
    if (location.hash.slice(1) !== name) { ownAddresses.push(name); try { location.hash = name; } catch (e) { /* ignore */ } }
    show(name);
  }
  function show(name) {
    name = resolve(name);
    if (staysHere()) { restoreAddress(); return; } // e.g. Back while typing
    ROUTES[name]();
  }
  // e: the hashchange; its new address is the one it reports, since the
  // current one may have moved on.
  function followAddress(e) {
    var h = hashOf(e && e.newURL != null ? e.newURL : location.href), own = ownAddresses.indexOf(h);
    if (own >= 0) { ownAddresses.splice(own, 1); return; }
    if (!h || (!ROUTES[h] && !ALIASES[h])) return; // not a page (e.g. an in-page link)
    if (resolve(h) === app.current) return;
    if (h !== resolve(h)) { go(h); return; } // an older page name: show its new place
    show(h);
  }
  function hashOf(href) { var i = href.indexOf('#'); return i < 0 ? '' : href.slice(i + 1); }
  function showAddressed() { show(resolve(location.hash.slice(1))); }

  // ---------- navigation ----------
  function renderNav() {
    app.$nav.innerHTML = NAV.map(function (n) {
      return '<button type="button" data-go="' + n.route + '"' + (sectionOf(app.current) === n.route ? ' aria-current="page"' : '') + '>' +
        esc(n.name) + '<kbd>' + n.key + '</kbd></button>';
    }).join('');
  }
  // The section heading and its tabs, for the top of a tabbed page.
  function sectionHead(section) {
    var S = SECTIONS[section];
    return '<h1>' + esc(S.name) + '</h1><nav class="tabs sectiontabs" aria-label="' + esc(S.name) + ' pages">' +
      S.tabs.map(function (t) {
        var r = section + '/' + t[0];
        return '<button type="button" data-stab="' + r + '"' + (app.current === r ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '</button>';
      }).join('') + '</nav>';
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
  // The digits open the sections, the letters their pages.
  function navigateByKey(key) {
    var n = NAV.filter(function (x) { return x.key === key; })[0];
    if (n) { go(n.route); return true; }
    if (LETTERS[key]) { go(LETTERS[key]); return true; }
    return false;
  }
  // [key, label] rows for the keyboard help, leaving out keys the screen uses.
  function navigationHelp(taken) {
    var rows = NAV.filter(function (n) { return !taken[n.key]; }).map(function (n) { return [n.key, n.name]; });
    Object.keys(LETTERS).forEach(function (k) { if (!taken[k]) rows.push([k, routeLabel(LETTERS[k])]); });
    return rows;
  }

  Object.assign(U, { route: route, screen: screen, redraw: redraw, activeScreen: activeScreen, onThisScreen: onThisScreen, action: action, onSubmit: onSubmit, perform: perform, paint: paint, fill: fill,
    renderNotice: renderNotice, flash: flash, announce: announce,
    go: go, show: show, followAddress: followAddress, showAddressed: showAddressed, sectionHead: sectionHead,
    stepSection: stepSection, navigateByKey: navigateByKey, navigationHelp: navigationHelp });
})(globalThis.FT);
