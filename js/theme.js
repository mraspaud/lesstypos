// The theme on <html data-theme>: Canvas (light) or Ink (dark). "Follow the
// system" is resolved here from prefers-color-scheme, before the first paint
// (this script loads in <head>) and whenever the system changes, so the
// stylesheet defines each palette once.
(function (g) {
  'use strict';
  var FT = (g.FT = g.FT || {});
  function resolve(choice, systemDark) {
    if (choice === 'light' || choice === 'dark') return choice;
    return systemDark ? 'dark' : 'light';
  }
  var chosen = 'system';
  var system = typeof document !== 'undefined' && g.matchMedia ? g.matchMedia('(prefers-color-scheme: dark)') : null;
  function paint() { if (system) document.documentElement.setAttribute('data-theme', resolve(chosen, system.matches)); }
  // choice: 'system', 'light' or 'dark' (the theme setting).
  function choose(choice) { chosen = choice; paint(); }
  if (system) {
    if (system.addEventListener) system.addEventListener('change', paint);
    paint();
  }
  FT.theme = { resolve: resolve, choose: choose };
})(typeof window !== 'undefined' ? window : globalThis);
