'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
test('both theme blocks are read', () => {
  assert.ok(light.ink && light.bg && dark.ink && dark.bg && light.bg !== dark.bg);
});
