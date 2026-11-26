'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { typist } = require('./helpers/typing');

// Functionality: a typing session tracks the target text, what the user typed,
// and the full timestamped input stream (including backspaces) per word.

// Typing notation: test/helpers/typing.js.

test('typing a word and a space commits it with its stream', () => {
  const FT = load();
  const s = FT.session.create(['the', 'cat']);
  typist(s).type('the ');
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
  typist(s).type('cx<at');
  const w = s.state().words[0];
  assert.equal(w.typed, 'cat');
  assert.deepEqual(plain(w.stream.map((e) => e.k)), ['c', 'c', 'b', 'c', 'c']);
});

test('extra characters beyond the word are kept', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog']);
  typist(s).type('catt ');
  assert.equal(s.state().words[0].typed, 'catt ');
  assert.equal(s.state().wordIndex, 1);
});

test('backspace cannot cross into correct words when nothing nearby is wrong', () => {
  const FT = load();
  const s = FT.session.create(['a', 'b']);
  typist(s).type('a <<b');
  const st = s.state();
  assert.equal(st.words[0].typed, 'a ');
  assert.equal(st.words[1].typed, 'b');
});

test('backspace can return into a previous word that contains an error', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog']);
  typist(s).type('cot <<<at dog ');
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
  typist(s).type('a  b');
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
  typist(s).type('a b ');
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

test('backspace reaches back through correct words to a nearby error', () => {
  const FT = load();
  const s = FT.session.create(['have', 'school', 'life', 'home']);
  typist(s).type('have schcol life ' + '<'.repeat(9) + 'ool life ');
  const st = s.state();
  assert.equal(st.words[1].typed, 'school ');
  assert.equal(st.words[2].typed, 'life ');
  assert.equal(st.wordIndex, 3);
});

test('backspace does not reopen correct words when no error is near', () => {
  const FT = load();
  const s = FT.session.create(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  typist(s).type('x b c d e f g ');   // the only error is 7 words back
  assert.equal(s.input({ kind: 'back', t: 1 }), false);
});

test('a backspace reports whether it changed anything', () => {
  const FT = load();
  const s = FT.session.create(['cat', 'dog', 'sun']);
  typist(s).type('cat dog ');
  assert.equal(s.input({ kind: 'back', t: 1 }), false); // nothing wrong nearby
  const s2 = FT.session.create(['cat', 'dog']);
  typist(s2).type('cot ');
  assert.equal(s2.input({ kind: 'back', t: 1 }), true); // into the wrong "cot"
  assert.equal(s2.input({ kind: 'back', t: 2 }), true);
});

test('backspace removes a whole character, even outside the basic plane', () => {
  const FT = load();
  const s = FT.session.create(['a😀']);
  s.input({ kind: 'text', data: 'a', t: 1 });
  s.input({ kind: 'text', data: '😀', t: 2 });
  s.input({ kind: 'back', t: 3 });
  assert.equal(s.current().typed, 'a');
});

// Functionality: a space before the word has all its letters is a typo in
// place (user decision): the word stays open until it is complete.
test('a space typed before the end of a word stays in the word as a wrong character', () => {
  const FT = load();
  const s = FT.session.create(['the', 'cat']);
  typist(s).type('th ');
  assert.equal(s.state().wordIndex, 0);
  assert.equal(s.state().words[0].typed, 'th ');
  typist(s, { at: 1000 }).type('<e ');
  assert.equal(s.state().wordIndex, 1);
  assert.equal(s.state().words[0].typed, 'the ');
});

test('a word with all its letters typed, right or wrong, ends at the space', () => {
  const FT = load();
  const s = FT.session.create(['the', 'cat']);
  typist(s).type('teh ');
  assert.equal(s.state().wordIndex, 1);
});

test('an early Enter at a paragraph end is a typo in place too', () => {
  const FT = load();
  const s = FT.session.create([{ word: 'end.', sep: '\n' }, 'Next']);
  typist(s).type('end\n');
  assert.equal(s.state().wordIndex, 0);
});

test('with a multi-letter key, a word is complete when it has as many presses as the word needs', () => {
  const FT = load();
  const s = FT.session.create(['the', 'cat'], { macros: ['th'] });
  typist(s).type('xe ');   // one key where the th key was meant, then e: two presses, as "the" needs
  assert.equal(s.state().wordIndex, 1);
});
