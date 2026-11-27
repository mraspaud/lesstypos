'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers/load');

// Functionality: both themes meet WCAG 2.x AA contrast (relative luminance,
// W3C 2008): 4.5:1 for text, 3:1 for typed text that recedes, against the
// page background and raised surfaces.
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root'))));
const darkStart = css.indexOf(':root[data-theme="dark"]');
const dark = tokens(css.slice(darkStart, css.indexOf('}', darkStart)));
const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: text colours reach 4.5:1 and receding typed text 3:1`, () => {
    for (const bg of ['bg', 'surface']) {
      for (const k of ['ink', 'muted', 'accent', 'err', 'warn']) assert.ok(ratio(t[k], t[bg]) >= 4.5, `${k} on ${bg}: ${ratio(t[k], t[bg]).toFixed(2)}`);
      assert.ok(ratio(t.done, t[bg]) >= 3, `done on ${bg}: ${ratio(t.done, t[bg]).toFixed(2)}`);
    }
  });
}
// The key hint on the primary button is text on the accent: its colour (the
// button's own where it inherits), seen through its opacity, reaches 4.5:1.
function declarations(selector) {
  const at = css.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, selector + ' is styled');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d[0]));
}
const tokenOf = (value) => /^var\(--([a-z0-9-]+)\)$/.exec(value)[1];
const blend = (fg, bg, alpha) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha))
  .toString(16).padStart(2, '0')).join('');
for (const [name, t] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: the key hint on the primary button reaches 4.5:1 on the accent`, () => {
    const button = declarations('.btn.primary'), hint = declarations('.btn.primary kbd');
    const colour = t[tokenOf(!hint.color || hint.color === 'inherit' ? button.color : hint.color)];
    const seen = blend(colour, t[tokenOf(button.background)], hint.opacity == null ? 1 : +hint.opacity);
    assert.ok(ratio(seen, t[tokenOf(button.background)]) >= 4.5, `key hint on accent: ${ratio(seen, t[tokenOf(button.background)]).toFixed(2)}`);
  });
}
test('both theme blocks are read', () => {
  assert.ok(light.ink && light.bg && dark.ink && dark.bg && light.bg !== dark.bg);
});

// Functionality: one dark palette. "Follow the system" is resolved to Canvas
// or Ink on <html data-theme>, so the stylesheet defines each palette once.
test('the dark palette is defined once', () => {
  assert.equal(css.split('--bg: ' + dark.bg).length - 1, 1);
});
test('a theme choice resolves to a palette; the system choice follows the system', () => {
  const FT = load();
  assert.equal(FT.theme.resolve('system', true), 'dark');
  assert.equal(FT.theme.resolve('system', false), 'light');
  assert.equal(FT.theme.resolve('light', true), 'light');
  assert.equal(FT.theme.resolve('dark', false), 'dark');
});
