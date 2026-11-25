'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: a typing session tracks the target text, what the user typed,
// and the full timestamped input stream (including backspaces) per word.

function typeString(s, str, t0 = 0, dt = 100) {
  let t = t0;
  for (const ch of str) {
    if (ch === '<') s.input({ kind: 'back', t });
    else s.input({ kind: 'text', data: ch, t });
    t += dt;
  }
  return t;
}

test('typing a word and a space commits it with its stream', () => {
  const FT = load();
  const s = FT.session.create(['the', 'cat']);
  typeString(s, 'the ');
  const st = s.state();
  assert.equal(st.wordIndex, 1);
  assert.equal(st.words[0].committed, true);
  assert.equal(st.words[0].typed, 'the ');
  assert.deepEqual(plain(st.words[0].stream.map((e) => e.ch)), ['t', 'h', 'e', ' ']);
  assert.deepEqual(plain(st.words[0].stream.map((e) => e.t)), [0, 100, 200, 300]);
});

test('backspace edits the current word but keeps the stream', () => {
  const FT = load();
  const s = FT.session.create(['cat']);
  typeString(s, 'cx<at');
  const w = s.state().words[0];
  assert.equal(w.typed, 'cat');
  assert.deepEqual(plain(w.stream.map((e) => e.k)), ['c', 'c', 'b', 'c', 'c']);
});

test('extra characters beyond the word are kept', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog']);
  typeString(s, 'catt ');
  assert.equal(s.state().words[0].typed, 'catt ');
  assert.equal(s.state().wordIndex, 1);
});

test('backspace cannot cross into a correctly typed committed word', () => {
  const FT = load();
  const s = FT.session.create(['a', 'b']);
  typeString(s, 'a <<b');
  const st = s.state();
  assert.equal(st.words[0].typed, 'a ');
  assert.equal(st.words[1].typed, 'b');
});

test('backspace can return into a previous word that contains an error', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog']);
  typeString(s, 'cot <<<at dog ');
  const st = s.state();
  assert.equal(st.words[0].typed, 'cat ');
  assert.equal(st.words[0].committed, true);
  assert.equal(st.words[1].typed, 'dog ');
  assert.equal(st.wordIndex, 2);
  // the first word's stream holds the whole history, including the erased space
  assert.deepEqual(plain(st.words[0].stream.map((e) => e.k === 'b' ? '<' : e.ch).join('')), 'cot <<<at ');
});

test('a space at the start of a word is ignored', () => {
  const FT = load();
  const s = FT.session.create(['a', 'b']);
  typeString(s, 'a  b');
  const st = s.state();
  assert.equal(st.words[1].typed, 'b');
  assert.equal(st.words[1].stream.length, 1);
});

test('a multi-character input event is one motor event with shared time', () => {
  const FT = load();
  const s = FT.session.create(['the']);
  s.input({ kind: 'text', data: 'th', t: 50 });
  s.input({ kind: 'text', data: 'e', t: 150 });
  const st = s.state().words[0].stream;
  assert.deepEqual(plain(st.map((e) => e.ch)), ['t', 'h', 'e']);
  assert.equal(st[0].g, st[1].g);
  assert.notEqual(st[1].g, st[2].g);
  assert.equal(st[1].t, 50);
});

test('words can be appended while typing and onCommit fires', () => {
  const FT = load();
  const s = FT.session.create(['a']);
  const committed = [];
  s.onCommit((w, i) => committed.push([w.target, i]));
  s.append(['b']);
  typeString(s, 'a b ');
  assert.deepEqual(plain(committed), [['a', 0], ['b', 1]]);
});

test('words can carry generator metadata', () => {
  const FT = load();
  const s = FT.session.create([{ word: 'strong', source: 'target', target: 'str' }, 'cat']);
  const w = s.state().words;
  assert.equal(w[0].target, 'strong');
  assert.deepEqual(plain(w[0].meta), { source: 'target', target: 'str' });
  assert.equal(w[1].meta, null);
});

test('a backspace reports whether it changed anything', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog', 'sun']);
  typeString(s, 'cot dog ');
  assert.equal(s.input({ kind: 'back', t: 1 }), false); // blocked by the correct "dog"
  const s2 = FT.session.create(['cat', 'dog']);
  typeString(s2, 'cot ');
  assert.equal(s2.input({ kind: 'back', t: 1 }), true); // into the wrong "cot"
  assert.equal(s2.input({ kind: 'back', t: 2 }), true);
});
