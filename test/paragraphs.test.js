'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: prose keeps its paragraphs; Enter ends a paragraph, as in
// the text, and a space there is an error like any other.
const FT = load();
const typeAll = (s, str, t0 = 0) => { let t = t0; for (const ch of str) s.input({ kind: 'text', data: ch, t: (t += 100) }); return t; };

test('a book records where its paragraphs end', () => {
  const stored = FT.books.toText(FT.books.fromText('One two.\n\nThree four five.\n\nSix.'), 'p');
  assert.deepEqual(plain(stored.words), ['One', 'two.', 'Three', 'four', 'five.', 'Six.']);
  assert.deepEqual(plain(stored.breaks), [1, 4]);
});

test('an EPUB keeps its paragraph ends across chapters', async () => {
  const { buildEpub } = require('./helpers/zip');
  const book = await FT.books.fromEpub(buildEpub({
    chapters: [{ href: 'a.xhtml', body: '<p>One two.</p><p>Three.</p>' }, { href: 'b.xhtml', body: '<p>Four five.</p><p>Six.</p>' }],
    nav: '<li><a href="a.xhtml">A</a></li><li><a href="b.xhtml">B</a></li>',
  }));
  assert.deepEqual(plain(FT.books.toText(book, 'e').breaks), [1, 2, 4]);
});

test('a prose exercise ends the words of a paragraph with Enter', () => {
  const tr = FT.trainer.create({ seed: 1 });
  const text = { id: 't', words: ['One', 'two.', 'Three', 'four.'], breaks: [1], pos: 0 };
  const ex = tr.newExercise({ type: 'prose', text });
  assert.deepEqual(plain(ex.words.map((w) => w.sep || ' ')), [' ', '\n', ' ', ' ']);
});

test('Enter commits a word, and an Enter or a space at the start of a word is ignored', () => {
  const s = FT.session.create([{ word: 'two.', sep: '\n' }, 'Three']);
  typeAll(s, 'two.\n\n Three ');
  const w = s.state().words;
  assert.equal(w[0].typed, 'two.\n');
  assert.equal(w[1].typed, 'Three ');
});

test('at a paragraph end Enter is correct and a space is one error', () => {
  const errors = (typed) => {
    const s = FT.session.create([{ word: 'two.', sep: '\n' }]);
    typeAll(s, typed);
    const word = s.state().words[0];
    return FT.align.analyzeWord(FT.session.targetOf(word), word.stream).targets.reduce((a, x) => a + x.err, 0);
  };
  assert.equal(errors('two.\n'), 0);
  assert.equal(errors('two. '), 1);
});

test('the Enter keystroke is part of the timing and sequence records', () => {
  const s = FT.session.create([{ word: 'two.', sep: '\n' }, 'Three']);
  typeAll(s, 'two.\nThree ');
  const words = s.state().words;
  const { records } = FT.timing.extract(words, FT.align.analyzeWords(words));
  assert.deepEqual(plain(records.map((r) => r.ch).slice(3, 6)), ['.', '\n', 'T']);
  assert.equal(records[5].ctx.slice(-2), '.\n');
});
