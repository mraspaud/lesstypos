'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { presses, stream, typist } = require('./helpers/typing');

// Functionality (of the tests' own helpers): one notation for typing, where
// '<' is a backspace and '[th]' one input event of several characters.
const FT = load();

test('the notation reads single presses, backspaces and multi-character events', () => {
  assert.deepEqual(presses('t[he]<n’'), ['t', '[he]', '<', 'n', '’']);
});

test('a stream gives each press its time and input group, a multi-character event one group', () => {
  assert.deepEqual(stream('a[bc]<', { t0: 10, dt: 5 }), [
    { k: 'c', ch: 'a', t: 10, g: 0 }, { k: 'c', ch: 'b', t: 15, g: 1 }, { k: 'c', ch: 'c', t: 15, g: 1 }, { k: 'b', t: 20 },
  ]);
});

test('a typist types into a session on its own clock, with one gap per press if given', () => {
  const s = FT.session.create(['ab', 'cd']);
  const hands = typist(s, { at: 1000 }).type('ab ').type('cd ', [50, 60, 70]);
  assert.equal(hands.t, 1000 + 200 + 50 + 60 + 70);
  assert.deepEqual(plain(s.state().words.map((w) => w.stream.map((e) => e.t))), [[1000, 1100, 1200], [1250, 1310, 1380]]);
});
