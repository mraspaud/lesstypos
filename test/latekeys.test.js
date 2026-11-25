'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: keys the keyboard sends late. A tap-hold key (QMK/ZMK
// mod-tap, layer-tap) that is not settled on press is sent only once the
// firmware decides tap vs hold, as a synthetic tap: the browser sees its
// keyup within a millisecond of its keydown. Its letter's timestamp is then
// the decision time, not the press. Design choice: a character is late when
// >= 10 of its single-key presses were seen and >= 80% were held < 3 ms,
// while presses overall are held normally (median >= 20 ms); otherwise the
// input carries no hold information (synthetic input) and nothing is late.

const FT = load();

// Typing script: [[ch, holdMs], ...] typed 150 ms apart; ch may be 'th' (a
// macro sent as two instant keystrokes 2 ms apart).
function typed(script) {
  const keys = [], stream = [];
  let t = 0, g = 0;
  const code = (ch) => (ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase());
  for (const [s, hold] of script) {
    t += 150;
    Array.from(s).forEach((ch, i) => {
      const at = t + i * 2;
      keys.push({ k: 'd', c: code(ch), t: at });
      stream.push({ k: 'c', ch, t: at + 1, g: g++ });
      keys.push({ k: 'u', c: code(ch), t: at + (s.length > 1 ? 0.5 : hold) });
    });
  }
  keys.sort((a, b) => a.t - b.t);
  return { keys, words: [{ target: 'x', stream }] };
}

const userLike = () => {
  const s = [];
  for (let i = 0; i < 12; i++) s.push(['e', 0.5], [' ', 0.4], ['a', 80], ['o', 90], ['l', 70]);
  return s;
};

test('keys held about 0 ms while others are held normally are late', () => {
  const { keys, words } = typed(userLike());
  const r = FT.timing.lateKeys(keys, words);
  assert.deepEqual(plain(r.chars).sort(), [' ', 'e']);
  assert.deepEqual(plain(r.codes).sort(), ['KeyE', 'Space']);
  assert.equal(r.holds.e.n, 12);
  assert.deepEqual(plain(r.judged).sort(), [' ', 'a', 'e', 'l', 'o']);
  assert.equal(r.holds.a.instant, 0);
});

test('the instant taps of a multi-letter key macro do not make its letters late', () => {
  const s = userLike();
  for (let i = 0; i < 12; i++) s.push(['th', 0]);
  const { keys, words } = typed(s);
  const r = FT.timing.lateKeys(keys, words, ['th']);
  assert.ok(!r.chars.includes('t') && !r.chars.includes('h'));
});

test('input where every key is instant carries no hold information: nothing is late', () => {
  const s = [];
  for (let i = 0; i < 12; i++) s.push(['e', 0.5], ['a', 0.5], ['o', 0.5]);
  const { keys, words } = typed(s);
  assert.deepEqual(plain(FT.timing.lateKeys(keys, words).chars), []);
});

test('fewer than 10 presses of a key is not enough to call it late', () => {
  const s = [];
  for (let i = 0; i < 9; i++) s.push(['e', 0.5], ['a', 80], ['o', 80]);
  const { keys, words } = typed(s);
  assert.deepEqual(plain(FT.timing.lateKeys(keys, words).chars), []);
});

test('no key log: nothing is late', () => {
  assert.deepEqual(plain(FT.timing.lateKeys([], []).chars), []);
  assert.deepEqual(plain(FT.timing.lateKeys(undefined, []).chars), []);
});

// Review findings.
test('a home-row-mods keyboard where most presses are late keys is still detected', () => {
  const s = [];
  for (let i = 0; i < 12; i++) {
    for (const ch of 'arstneio ') s.push([ch, 0.5]);
    s.push(['b', 80], ['k', 90]);
  }
  const { keys, words } = typed(s);
  const r = FT.timing.lateKeys(keys, words);
  assert.deepEqual(plain(r.chars).sort(), [' ', 'a', 'e', 'i', 'n', 'o', 'r', 's', 't']);
});

test('a tap whose keydown and keyup share a timestamp is an instant tap', () => {
  const { keys, words } = typed(userLike().map(([ch, h]) => [ch, h < 1 ? 0 : h]));
  assert.deepEqual(plain(FT.timing.lateKeys(keys, words).chars).sort(), [' ', 'e']);
  // ... and it does not stay "held" for the rollover measure
  const k = [{ k: 'd', c: 'KeyE', t: 0 }, { k: 'u', c: 'KeyE', t: 0 }, { k: 'd', c: 'KeyA', t: 100 }, { k: 'u', c: 'KeyA', t: 180 }];
  assert.equal(FT.timing.rollover(k), 0);
});

test('one input event carrying two letters does not shift which press produced which letter', () => {
  const s = userLike();
  const { keys, words } = typed(s);
  // a two-letter input event right before an 'a' press: 'xy' at the same t, from one key
  const t0 = 1e5;
  keys.push({ k: 'd', c: 'KeyQ', t: t0 }, { k: 'u', c: 'KeyQ', t: t0 + 80 },
    { k: 'd', c: 'KeyA', t: t0 + 3 }, { k: 'u', c: 'KeyA', t: t0 + 83 });
  words.push({ target: 'y', stream: [{ k: 'c', ch: 'x', t: t0 + 1, g: 900 }, { k: 'c', ch: 'y', t: t0 + 1, g: 900 }, { k: 'c', ch: 'a', t: t0 + 4, g: 901 }] });
  const r = FT.timing.lateKeys(keys, words);
  assert.equal(r.holds.y, undefined);
  assert.equal(r.holds.a.n, 13);
});

test('late keys are reported as the canonical character the model uses', () => {
  const s = [];
  for (let i = 0; i < 12; i++) s.push(['’', 0.5], ['a', 80], ['o', 80]);
  const { keys, words } = typed(s);
  assert.deepEqual(plain(FT.timing.lateKeys(keys, words).chars), ["'"]);
});
