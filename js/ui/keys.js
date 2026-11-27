// Keys. Each screen has a table of shortcuts, filled by the buttons that show
// them (keyButton) and by shortcuts without a button; they last as long as the
// screen. The ? overlay lists that table. One document-level handler also
// moves through lists and tabs, handles form fields and the navigation keys.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc;
  var KEY_NAMES = { Escape: 'Esc', Delete: 'Del' };

  function keyName(key) { return KEY_NAMES[key] || key; }
  // Registers a shortcut for the screen on view; returns its <kbd> hint.
  // label: what the key does, as shown by ? (markup allowed).
  function shortcut(s) {
    U.activeScreen().shortcuts[s.key] = { label: s.label, act: s.act };
    return '<kbd>' + esc(keyName(s.key)) + '</kbd>';
  }
  // A button that shows its key and does the same on a click as on the key.
  // label is markup; kind: 'primary' or 'danger'; key is optional.
  function keyButton(b) {
    return '<button class="btn' + (b.kind ? ' ' + b.kind : '') + '" type="button"' + (b.id ? ' id="' + b.id + '"' : '') + U.action(b.onClick) + '>' +
      b.label + (b.key ? ' ' + shortcut({ key: b.key, label: b.label, act: b.onClick }) : '') + '</button>';
  }

  // A quiet text button for a secondary action: its key, then what it does
  // (label, markup). help: what ? says, where that needs more words; title: its tooltip.
  function legendKey(b) {
    return '<button type="button" class="legendkey" id="' + b.id + '"' + (b.title ? ' title="' + esc(b.title) + '"' : '') + U.action(b.onClick) + '>' +
      shortcut({ key: b.key, label: b.help || b.label, act: b.onClick }) + ' ' + b.label + '</button>';
  }

  // A plain button: label (markup), its click; kind: 'primary' or 'danger'.
  function button(label, onClick, kind, id) { return keyButton({ label: label, onClick: onClick, kind: kind, id: id }); }
  // A click handler that asks first: the first press arms the button, which
  // then says askLabel (markup), the second acts. From a key, the button is
  // found by opts.id; opts.onArm runs once it is armed.
  function onSecondPress(askLabel, act, opts) {
    opts = opts || {};
    return function (el) {
      var b = el || document.getElementById(opts.id);
      if (b.classList.contains('armed')) return act();
      b.classList.add('armed');
      b.innerHTML = askLabel;
      if (opts.onArm) opts.onArm();
    };
  }
  function goHome() { U.go('home'); }
  // The keys of a screen whose only way on is home.
  var HOME_KEYS = [{ key: 'Escape', label: 'Home', act: goHome }];

  // ---------- keyboard help (?) ----------
  function textOf(markup) {
    var el = document.createElement('div');
    el.innerHTML = markup;
    return el.textContent.replace(/\s+/g, ' ').trim();
  }
  function closeKeyHelp() { var el = document.getElementById('keyhelp'); if (el) el.remove(); }
  function keyHelp() {
    var shortcuts = U.activeScreen().shortcuts;
    var rows = Object.keys(shortcuts).map(function (k) { return [keyName(k), textOf(shortcuts[k].label)]; });
    if (app.$view.querySelector('[data-row]')) rows.push(['j k ↓ ↑', 'Move through the list'], ['Enter', 'Open the selected row']);
    if (app.$view.querySelector('[data-tab], [data-stab]')) rows.push(['← →', 'Switch tabs (on a tab)']);
    if (app.$view.querySelector('[data-stab]')) rows.push(['[ ]', 'Previous or next tab']);
    rows = rows.concat(U.navigationHelp(shortcuts));
    rows.push(['?', 'Show or hide this list'], ['Esc', 'Close this list']);
    var el = document.createElement('div');
    el.id = 'keyhelp'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Keyboard shortcuts');
    el.innerHTML = '<h2>Keyboard shortcuts</h2><dl>' + rows.map(function (r) { return '<dt><kbd>' + esc(r[0]) + '</kbd></dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    document.body.appendChild(el);
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

  // Letters typed past the end of an exercise must not act as shortcuts.
  var IN_FLIGHT_MS = 1500;
  function typedJustNow() { return Date.now() - (app.typingEndedAt || 0) < IN_FLIGHT_MS; }
  function onGlobalKey(e) {
    if (e.defaultPrevented) return;
    var screen = U.activeScreen();
    if (screen.spec.onKey) { screen.spec.onKey(e); return; }
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) { fieldKey(e); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.getElementById('keyhelp')) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); closeKeyHelp(); return; }
    } else if (e.key === '?') { e.preventDefault(); keyHelp(); return; }
    if ((e.key === 'j' || e.key === 'ArrowDown') && !typedJustNow() && moveRow(1)) { e.preventDefault(); return; }
    if ((e.key === 'k' || e.key === 'ArrowUp') && !typedJustNow() && moveRow(-1)) { e.preventDefault(); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && moveTab(e.key === 'ArrowRight' ? 1 : -1)) { e.preventDefault(); return; }
    var s = screen.shortcuts[e.key];
    if (s && !(e.key === 'Enter' && /^(BUTTON|A|SUMMARY)$/.test(tag))) { // a focused control handles its own Enter
      if (e.key.length === 1 && typedJustNow()) return;
      e.preventDefault(); U.perform(s.act); return;
    }
    if (typedJustNow()) return;
    if ((e.key === '[' || e.key === ']') && U.stepSection(e.key === ']' ? 1 : -1)) { e.preventDefault(); return; }
    if (U.navigateByKey(e.key)) e.preventDefault();
  }

  Object.assign(U, { shortcut: shortcut, keyButton: keyButton, legendKey: legendKey, button: button, onSecondPress: onSecondPress, goHome: goHome, HOME_KEYS: HOME_KEYS, closeKeyHelp: closeKeyHelp, onGlobalKey: onGlobalKey });
})(globalThis.FT);
