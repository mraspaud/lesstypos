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

const prose = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');
const gutenberg = (body) => 'Title: The Book\n\n*** START OF THE PROJECT GUTENBERG EBOOK THE BOOK ***\n\n' + body + '\n\n*** END OF THE PROJECT GUTENBERG EBOOK THE BOOK ***\n';

test('a Gutenberg text whose Contents has no page numbers and whose headings take two lines', () => {
  const book = FT.books.fromText(gutenberg('THE BOOK\n\nContents\n\n CHAPTER I.     Down the Hole\n CHAPTER II.    The Pool\n\n\n\n' +
    'CHAPTER I.\nDown the Hole\n\n' + prose(200, 'alice') + '\n\nCHAPTER II.\nThe Pool\n\n' + prose(200, 'tears')));
  assert.deepEqual(plain(titles(book).slice(book.start)), ['CHAPTER I. Down the Hole', 'CHAPTER II. The Pool']);
  assert.doesNotMatch(allText(book), /Contents|CHAPTER/);
});

test('without a header, title and author come from the title page', () => {
  const book = FT.books.fromText('*** START OF THE PROJECT GUTENBERG EBOOK 11 ***\n\n[Illustration]\n\nAlice’s Adventures in Wonderland\n\nby Lewis Carroll\n\nChapter 1\n\n' + prose(200));
  assert.equal(book.title, 'Alice’s Adventures in Wonderland');
  assert.equal(book.author, 'Lewis Carroll');
});

test('text before the first chapter heading is kept', () => {
  const book = FT.books.fromText(prose(300, 'before') + '\n\nChapter 4\n\n' + prose(300, 'after'));
  assert.equal(allText(book).split(' ').length, 600);
  assert.equal(book.start, 0);
});

test('a book of short chapters starts at the first', () => {
  const book = FT.books.fromText('Chapter 1\n\n' + prose(20) + '\n\nChapter 2\n\n' + prose(20) + '\n\nChapter 3\n\n' + prose(20));
  assert.equal(book.chapters.length, 3);
  assert.equal(book.start, 0);
});

test('a production note and a transcriber’s note go entirely, however many lines', () => {
  const book = FT.books.fromText(gutenberg('Produced by Someone\nand the Proofreading Team at http://www.pgdp.net\n\n' +
    "Transcriber's Note:\n\nObvious typos fixed.\nItalics shown as _this_.\n\nChapter 1\n\n" + prose(200)));
  assert.doesNotMatch(allText(book), /Produced|Proofreading|Transcriber|typos|Italics/);
});

test('a one-line paragraph that only starts like a heading is not a chapter', () => {
  const book = FT.books.fromText('Chapter 1\n\n' + prose(200) + '\n\nPart civil, part military.\n\n' + prose(200));
  assert.equal(book.chapters.length, 1);
});

test('a fraction after a number stays readable', () => {
  assert.deepEqual(plain(FT.books.fromText('It was 2½ miles.').chapters[0].words), ['It', 'was', '2', '1/2', 'miles.']);
});

test('a word in capitals used as such elsewhere keeps its capitals at a paragraph start', () => {
  const words = plain(FT.books.fromText('NASA announced a launch.\n\nLater NASA said more.').chapters[0].words);
  assert.equal(words[0], 'NASA');
});

// Functionality: a book comes with the app, so prose works from the start.
test('Alice in Wonderland comes with the app, ready at Chapter I', () => {
  const alice = FT.books.bundled();
  assert.equal(alice.title, 'Alice’s Adventures in Wonderland');
  assert.equal(alice.chapters.length, 12);
  assert.equal(alice.chapters[0].title, 'CHAPTER I. Down the Rabbit-Hole');
  assert.equal(alice.chapters[0].words.slice(0, 4).join(' '), 'Alice was beginning to');
  assert.equal(alice.start, 0);
  const stored = FT.books.toText(alice, 'alice');
  assert.equal(stored.pos, 0);
  assert.ok(stored.words.length > 25000);
});
