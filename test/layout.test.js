'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: an optional layout declaration (genkey-style key rows plus a
// matching finger grid, fingers 0-9 = left pinky..right pinky, 4/5 thumbs)
// lets the app explain sequences with the layout community's movement
// categories (SFB, LSB, scissors, rolls, alternation, redirects). Multi-
// character keys are recognised as macros.

const FT = load();
const QWERTY = `
q w e r t   y u i o p
a s d f g   h j k l ;
z x c v b   n m , . /
0 1 2 3 3   6 6 7 8 9
0 1 2 3 3   6 6 7 8 9
0 1 2 3 3   6 6 7 8 9
`;
const L = FT.layout.parse(QWERTY);
const kind = (s) => FT.layout.classify(L, s)?.type ?? null;

test('parses keys with row, column, finger and hand', () => {
  assert.deepEqual(plain(L.keys.f), { row: 1, col: 3, finger: 3, hand: 'L' });
  assert.equal(L.keys.j.hand, 'R');
});

test('bigram categories', () => {
  assert.equal(kind('ed'), 'sfb');
  assert.equal(kind('ee'), 'repeat');
  assert.equal(kind('fj'), 'alternate');
  assert.equal(kind('df'), 'roll-in');
  assert.equal(kind('fd'), 'roll-out');
  // Scissor: adjacent fingers, the longer finger on the lower row (layouts.wiki).
  assert.ok(FT.layout.classify(L, 'cr').tags.includes('full-scissor')); // middle bottom, index top
  assert.ok(!FT.layout.classify(L, 'ex').tags.includes('full-scissor')); // middle top, ring bottom
  assert.ok(FT.layout.classify(L, 'vw').tags.length === 0);
  assert.ok(FT.layout.classify(L, 'te').tags.includes('lsb'));
});

test('trigram categories', () => {
  assert.equal(kind('sfd'), 'redirect');
  assert.equal(kind('sdf'), 'onehand');
  assert.equal(kind('fjf'), 'alternate');
  assert.equal(kind('dfj'), 'roll');
  assert.ok(FT.layout.classify(L, 'dkd').tags.includes('sfs'));
});

test('unknown characters and spaces give no classification', () => {
  assert.equal(FT.layout.classify(L, 'a b'), null);
  assert.equal(FT.layout.classify(L, 'aé'), null);
});

test('multi-character keys are declared as macros', () => {
  const T = FT.layout.parse('th e\n3 2');
  assert.deepEqual(plain(T.macros), ['th']);
  assert.equal(FT.layout.classify(T, 'th').type, 'macro');
});

test('mismatched grids are reported with a useful message', () => {
  assert.throws(() => FT.layout.parse('a b c\n0 1'), /row 1.*3 keys.*2 fingers/);
  assert.throws(() => FT.layout.parse('a b\n0 x'), /finger/);
});
