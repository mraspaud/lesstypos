'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: prose may contain typographic characters. Either the exact
// character or its ASCII equivalent is accepted, and statistics treat them as
// the same character. Capitalisation errors are recognisable.

const FT = load();
function stream(str) {
  return Array.from(str).map((ch, i) => (ch === '<' ? { k: 'b', t: i * 100 } : { k: 'c', ch, t: i * 100, g: i }));
}
const A = (p, s) => FT.align.analyzeWord(p, stream(s));
const errors = (r) => r.events.filter((e) => e.type !== 'none').length;

test('typographic characters have ASCII equivalents', () => {
  assert.equal(FT.text.canon('’'), "'");
  assert.equal(FT.text.canon('“'), '"');
  assert.equal(FT.text.canon('—'), '-');
  assert.equal(FT.text.canon('é'), 'e');
  assert.equal(FT.text.canon('a'), 'a');
  assert.ok(FT.text.same("'", '’'));
  assert.ok(!FT.text.same('a', 'b'));
});

test("don’t typed with a straight or curly apostrophe is fully correct", () => {
  assert.equal(errors(A('don’t ', "don't ")), 0);
  assert.equal(errors(A('don’t ', 'don’t ')), 0);
  assert.equal(errors(A('café ', 'cafe ')), 0);
  assert.equal(errors(A('well—no ', 'well-no ')), 0);
});

test('statistics see the canonical character', () => {
  const r = A('don’t ', 'don’t ');
  assert.equal(r.targets[3].ch, "'");
});

test('a substitution that differs only in case is tagged as capitalisation', () => {
  const r = A('He ', 'he ');
  const sub = r.events.find((e) => e.type === 'sub');
  assert.equal(sub.case, true);
  const r2 = A('He ', 'ke ');
  assert.equal(r2.events.find((e) => e.type === 'sub').case, false);
});

test('a session treats an equivalent character as correct when looking for errors', () => {
  const s = FT.session.create(['don’t', 'go']);
  for (const ch of "don't ") s.input({ kind: 'text', data: ch, t: 1 });
  assert.equal(s.input({ kind: 'back', t: 2 }), false); // nothing wrong nearby
});

// Functionality: pasted prose becomes a word list, keeping capitals and
// punctuation, with typographic clean-up and Project Gutenberg boilerplate removed.
test('prose is split into words, keeping capitals and punctuation', () => {
  const w = plain(FT.text.prepare('  It was the best\nof times,\n\n\tit was “the worst”… '));
  assert.deepEqual(w, ['It', 'was', 'the', 'best', 'of', 'times,', 'it', 'was', '“the', 'worst”...']);
});

test('Project Gutenberg header and footer are removed', () => {
  const raw = 'The Project Gutenberg eBook of X\nlicence blah\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nCall me Ishmael.\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nmore licence';
  assert.deepEqual(plain(FT.text.prepare(raw)), ['Call', 'me', 'Ishmael.']);
});

// Functionality: the target text is split into presses: a declared
// multi-letter key (matched regardless of capitals) is one press.
test('target presses group declared multi-letter keys', () => {
  assert.deepEqual(plain(FT.text.targetPresses('The ', ['th'])), [0, 0, 1, 2]);
  assert.deepEqual(plain(FT.text.targetPresses('quoth ', ['th', 'qu'])), [0, 0, 1, 2, 2, 3]);
  assert.deepEqual(plain(FT.text.targetPresses('the ', [])), [0, 1, 2, 3]);
  assert.deepEqual(plain(FT.text.targetPresses('athe ', ['th', 'the'])), [0, 1, 1, 1, 2]); // longest first
});

// Functionality: typed keystrokes are grouped into presses: one multi-character
// input event, or a declared multi-letter key arriving as fast separate keys.
const S = (spec) => spec.map(([ch, t, g]) => (ch === '<' ? { k: 'b', t } : { k: 'c', ch, t, g }));
test('typed presses: one input event, or a declared key typed as fast separate keystrokes', () => {
  assert.deepEqual(plain(FT.text.pressIds(S([['t', 0, 1], ['h', 0, 1], ['e', 100, 2]]), [])), [0, 0, 1]);
  assert.deepEqual(plain(FT.text.pressIds(S([['t', 0, 1], ['h', 5, 2], ['e', 100, 3]]), ['th'])), [0, 0, 1]);
  assert.deepEqual(plain(FT.text.pressIds(S([['t', 0, 1], ['h', 5, 2]]), [])), [0, 1]);            // undeclared: never merged
  assert.deepEqual(plain(FT.text.pressIds(S([['t', 0, 1], ['h', 120, 2]]), ['th'])), [0, 1]);       // declared but slow
  assert.deepEqual(plain(FT.text.pressIds(S([['x', 0, 1], ['<', 50], ['e', 100, 2]]), [])), [0, null, 1]);
});

test('a declared key of three letters typed as fast separate keystrokes is one press', () => {
  const st = [['t', 0], ['h', 4], ['e', 8], ['n', 200]].map(([ch, t], i) => ({ k: 'c', ch, t, g: i + 1 }));
  assert.deepEqual(plain(FT.text.pressIds(st, ['the'])), [0, 0, 0, 1]);
});

test('an acute accent typed as an apostrophe counts as one', () => {
  assert.ok(FT.text.same('´', "'"));
  assert.ok(FT.text.same("'", '´'));
  assert.ok(FT.text.sameStr('don´t', "don't"));
  assert.ok(!FT.text.same('`', "'")); // the grave accent is a real ASCII character
});

test('a gap of 0 ms merges nothing into a multi-letter press', () => {
  const st = [{ k: 'c', ch: 't', t: 0, g: 1 }, { k: 'c', ch: 'h', t: 0.5, g: 2 }];
  assert.deepEqual(plain(FT.text.pressIds(st, ['th'], 0)), [0, 1]);
  assert.deepEqual(plain(FT.text.pressIds(st, ['th'])), [0, 0]);
});
