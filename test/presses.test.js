'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const FT = load();

// Functionality: the target text is split into presses: a declared
// multi-letter key (matched regardless of capitals) is one press.
test('target presses group declared multi-letter keys', () => {
  assert.deepEqual(plain(FT.presses.ofTarget('The ', ['th'])), [0, 0, 1, 2]);
  assert.deepEqual(plain(FT.presses.ofTarget('quoth ', ['th', 'qu'])), [0, 0, 1, 2, 2, 3]);
  assert.deepEqual(plain(FT.presses.ofTarget('the ', [])), [0, 1, 2, 3]);
  assert.deepEqual(plain(FT.presses.ofTarget('athe ', ['th', 'the'])), [0, 1, 1, 1, 2]); // longest first
});

// Functionality: typed keystrokes are grouped into presses: one multi-character
// input event, or a declared multi-letter key arriving as fast separate keys.
const S = (spec) => spec.map(([ch, t, g]) => (ch === '<' ? { k: 'b', t } : { k: 'c', ch, t, g }));
test('typed presses: one input event, or a declared key typed as fast separate keystrokes', () => {
  assert.deepEqual(plain(FT.presses.ids(S([['t', 0, 1], ['h', 0, 1], ['e', 100, 2]]), [])), [0, 0, 1]);
  assert.deepEqual(plain(FT.presses.ids(S([['t', 0, 1], ['h', 5, 2], ['e', 100, 3]]), ['th'])), [0, 0, 1]);
  assert.deepEqual(plain(FT.presses.ids(S([['t', 0, 1], ['h', 5, 2]]), [])), [0, 1]);            // undeclared: never merged
  assert.deepEqual(plain(FT.presses.ids(S([['t', 0, 1], ['h', 120, 2]]), ['th'])), [0, 1]);       // declared but slow
  assert.deepEqual(plain(FT.presses.ids(S([['x', 0, 1], ['<', 50], ['e', 100, 2]]), [])), [0, null, 1]);
});

test('a declared key of three letters typed as fast separate keystrokes is one press', () => {
  const st = [['t', 0], ['h', 4], ['e', 8], ['n', 200]].map(([ch, t], i) => ({ k: 'c', ch, t, g: i + 1 }));
  assert.deepEqual(plain(FT.presses.ids(st, ['the'])), [0, 0, 0, 1]);
});

test('a gap of 0 ms merges nothing into a multi-letter press', () => {
  const st = [{ k: 'c', ch: 't', t: 0, g: 1 }, { k: 'c', ch: 'h', t: 0.5, g: 2 }];
  assert.deepEqual(plain(FT.presses.ids(st, ['th'], 0)), [0, 1]);
  assert.deepEqual(plain(FT.presses.ids(st, ['th'])), [0, 0]);
});
