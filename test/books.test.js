'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, plain } = require('./helpers/load');

// Functionality: a book (EPUB or Project Gutenberg text) becomes chapters of
// ordinary text to type: no front matter, captions, page numbers or
// Gutenberg boilerplate.
const FT = load();
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'books', f));
const titles = (book) => book.chapters.map((c) => c.title);
const allText = (book) => book.chapters.map((c) => c.words.join(' ')).join(' ');

test('a zip archive gives its files, stored or compressed', async () => {
  const files = await FT.zip.read(new Uint8Array(fixture('snowdrop.epub')));
  assert.equal(new TextDecoder().decode(files['mimetype']), 'application/epub+zip');
  assert.match(new TextDecoder().decode(files['META-INF/container.xml']), /rootfile/);
});

test('an EPUB gives its title, author and chapters from its table of contents', async () => {
  const book = await FT.books.fromEpub(new Uint8Array(fixture('snowdrop.epub')));
  assert.equal(book.title, 'Snowdrop & Other Tales');
  assert.equal(book.author, 'Jacob Grimm, Wilhelm Grimm');
  assert.deepEqual(plain(titles(book).slice(-2)), ['Snowdrop', 'The Pink']);
  assert.ok(!titles(book).some((t) => /^contents$|illustrations/i.test(t)));
});

test('an EPUB chapter is its prose only', async () => {
  const book = await FT.books.fromEpub(new Uint8Array(fixture('snowdrop.epub')));
  const snowdrop = book.chapters.find((c) => c.title === 'Snowdrop');
  assert.equal(snowdrop.words.slice(0, 6).join(' '), 'It was the middle of winter,');
  assert.doesNotMatch(allText(book), /Illustration|Gutenberg|Produced by|\{/);
  assert.equal(book.chapters[book.start].title, 'Snowdrop');
});

test('a Gutenberg text gives the same stories without its front matter', () => {
  const book = FT.books.fromText(fixture('snowdrop.txt').toString('utf8'));
  assert.equal(book.title, 'Snowdrop and Other Tales');
  assert.deepEqual(plain(titles(book).slice(book.start, book.start + 2)), ['Snowdrop', 'The Pink']);
  assert.equal(book.chapters[book.start].words.slice(0, 6).join(' '), 'It was the middle of winter,');
  assert.doesNotMatch(allText(book), /\[Illustration|Transcriber|Produced by|Gutenberg|\{|_/);
});

test('pasted ordinary text stays one chapter', () => {
  const book = FT.books.fromText('It was a bright cold day in April, and the clocks were striking thirteen.');
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].words.length, 14);
  assert.equal(book.start, 0);
});

test('letters without an ASCII equivalent are spelled out, marks without letters dropped', () => {
  const words = plain(FT.books.fromText('Cæsar and Œdipus met a Fräulein † at [1] the _café_.').chapters[0].words);
  assert.deepEqual(words, ['Caesar', 'and', 'OEdipus', 'met', 'a', 'Fräulein', 'at', 'the', 'café.']);
});

test('a book is stored as words with chapter starts', () => {
  const stored = FT.books.toText({ title: 'T', chapters: [{ title: 'A', words: ['a', 'b'] }, { title: 'B', words: ['c'] }], start: 1 }, 'id1');
  assert.deepEqual(plain(stored.words), ['a', 'b', 'c']);
  assert.deepEqual(plain(stored.chapters), [{ title: 'A', start: 0 }, { title: 'B', start: 2 }]);
  assert.equal(stored.pos, 2);
  assert.equal(FT.books.chapterAt(stored, 2).title, 'B');
});

test('a paragraph opening in capitals for typography is typed in normal case', () => {
  const words = plain(FT.books.fromText('THERE was once a Queen. Then NASA and the BBC came.').chapters[0].words);
  assert.deepEqual(words.slice(0, 2), ['There', 'was']);
  assert.ok(words.includes('NASA') && words.includes('BBC'));
});
