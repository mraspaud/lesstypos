// Screens and routes. One screen at a time owns the view: its name
// (app.current), the navigation, the address, the focus, its keys and its
// leave hooks. Routes are the screens with an address: "section" or
// "section/tab"; older page names still work.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc;

  // Three sections: Train, Insights (tabs) and Settings (tabs).
  var SECTIONS = {
    home: { name: 'Train', key: '1' },
    insights: { name: 'Insights', key: '2', tabs: [['focus', 'Focus'], ['errors', 'Errors'], ['progress', 'Progress']] },
    settings: { name: 'Settings', key: '3', tabs: [['typing', 'Typing'], ['training', 'Daily training'], ['keyboard', 'Keyboard'],
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
    renderNav();
    (spec.keys || []).forEach(U.shortcut);
    if (spec.render) spec.render();
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
    root.querySelectorAll('[data-action]').forEach(function (el) { el.onclick = function () { actions[+el.dataset.action](el); }; });
  }

  // Draws the screen. Focus moves to the element that had it if it is still
  // there (same id), otherwise to the page heading, so keyboard users never
  // land on <body>.
  function paint(html) {
    var had = document.activeElement && document.activeElement.id;
    app.$view.innerHTML = '<div id="notice" class="notice" hidden></div>' + html;
    renderNotice();
    bindActions(app.$view);
    app.$view.querySelectorAll('[data-stab]').forEach(function (b) { b.onclick = function () { go(b.dataset.stab); }; });
    var back = had && document.getElementById(had);
    var target = back && app.$view.contains(back) ? back : app.$view.querySelector('h1') || app.$view;
    if (target.tagName === 'H1' || target === app.$view) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: target.tagName === 'H1' ? false : true });
  }
  // Redraws one part of the screen.
  function fill(el, html) {
    el.innerHTML = html;
    bindActions(el);
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

  // ---------- addresses ----------
  function setAddress(name) {
    app.address = name;
    if (location.hash.slice(1) !== name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// may refuse */ } }
  }
  // Back to the address of the screen the user is on (or typed from).
  function restoreAddress() {
    if (app.address && location.hash.slice(1) !== app.address) { try { history.replaceState(null, '', '#' + app.address); } catch (e) { /* file:// may refuse */ } }
  }
  function staysHere() { return !!(active.spec.holdOnNavigation && active.spec.holdOnNavigation()); }
  var ownHash = null;
  function go(name) {
    name = resolve(name);
    if (staysHere()) return;
    // our own address change arrives later as a hashchange: it must not undo
    // what happened in between (e.g. an exercise started right after)
    if (location.hash.slice(1) !== name) { ownHash = name; try { location.hash = name; } catch (e) { /* ignore */ } }
    show(name);
  }
  function show(name) {
    name = resolve(name);
    if (staysHere()) { restoreAddress(); return; } // e.g. Back while typing
    ROUTES[name]();
  }
  function followAddress() {
    var h = location.hash.slice(1);
    if (h === ownHash) { ownHash = null; return; }
    if (!h || (!ROUTES[h] && !ALIASES[h])) return; // not a page (e.g. an in-page link)
    if (resolve(h) === app.current) return;
    if (h !== resolve(h)) { go(h); return; } // an older page name: show its new place
    show(h);
  }
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

  Object.assign(U, { route: route, screen: screen, activeScreen: activeScreen, onThisScreen: onThisScreen, action: action, paint: paint, fill: fill,
    renderNotice: renderNotice, announce: announce,
    go: go, show: show, followAddress: followAddress, showAddressed: showAddressed, sectionHead: sectionHead,
    stepSection: stepSection, navigateByKey: navigateByKey, navigationHelp: navigationHelp });
})(globalThis.FT);
