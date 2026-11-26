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

test('an acute accent typed as an apostrophe counts as one', () => {
  assert.ok(FT.text.same('´', "'"));
  assert.ok(FT.text.same("'", '´'));
  assert.ok(FT.text.sameStr('don´t', "don't"));
  assert.ok(!FT.text.same('`', "'")); // the grave accent is a real ASCII character
});
