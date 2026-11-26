'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, plain } = require('./helpers/load');
const { buildZip, buildEpub, DEFLATED } = require('./helpers/zip');

// Functionality: a book (EPUB or Project Gutenberg text) becomes chapters of
// ordinary text to type: no front matter, captions, page numbers or
// Gutenberg boilerplate.
const FT = load();
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'books', f));
const titles = (book) => book.chapters.map((c) => c.title);
const allText = (book) => book.chapters.map((c) => c.words.join(' ')).join(' ');
let snowdropEpub;
const snowdropBook = () => (snowdropEpub ??= FT.books.fromEpub(new Uint8Array(fixture('snowdrop.epub'))));

test('a zip archive gives its files, stored or compressed', async () => {
  const files = await FT.zip.read(new Uint8Array(fixture('snowdrop.epub')));
  assert.equal(new TextDecoder().decode(files['mimetype']), 'application/epub+zip');
  assert.match(new TextDecoder().decode(files['META-INF/container.xml']), /rootfile/);
});

test('a zip archive inflates deflated files', async () => {
  const files = await FT.zip.read(buildZip({ 'a.txt': 'hello hello hello' }, { method: DEFLATED }));
  assert.equal(new TextDecoder().decode(files['a.txt']), 'hello hello hello');
});

test('a zip archive in a form it cannot read is refused with a clear message', async () => {
  await assert.rejects(FT.zip.read(buildZip({ 'a.txt': 'x' }, { method: 12 })), /compression/i);
  await assert.rejects(FT.zip.read(buildZip({ 'a.txt': 'x' }, { zip64: true })), /large/i);
});

const p = (text) => `<p>${text}</p>`;
const longText = (word) => p(Array.from({ length: 160 }, () => word).join(' '));
const chapterWords = async (epub) => {
  const book = await FT.books.fromEpub(epub);
  return Object.fromEntries(book.chapters.map((c) => [c.title, c.words.join(' ')]));
};

test('an EPUB 3 book with only a nav table of contents', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: 'one.xhtml', body: longText('one') }, { href: 'two.xhtml', body: longText('two') }],
    nav: '<li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li>',
  }));
  assert.deepEqual(Object.keys(got), ['One', 'Two']);
  assert.match(got.Two, /^two two/);
});

test('table of contents links in single quotes, with ../ or encoded paths, and attributes in any order', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: 'text/one.xhtml', body: longText('one') }, { href: 'text/ch%202.xhtml', body: longText('two') }, { href: 'text/three.xhtml', body: longText('three') }],
    ncx: "<navPoint><navLabel><text>One</text></navLabel><content src='text/one.xhtml'/></navPoint>" +
      '<navPoint><navLabel><text>Two</text></navLabel><content id="x" src="text/../text/ch%202.xhtml"/></navPoint>' +
      "<navPoint><navLabel><text>Three</text></navLabel><content src='text/three.xhtml' id='y'/></navPoint>",
  }));
  assert.deepEqual(Object.keys(got), ['One', 'Two', 'Three']);
});

test('the printed page numbers listed beside the table of contents do not cut chapters', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: 'one.xhtml', body: longText('one') + '<span id="pg2"></span>' + longText('more') }],
    ncx: '<navPoint><navLabel><text>One</text></navLabel><content src="one.xhtml"/></navPoint>',
    pageList: '<pageTarget type="normal" value="2"><navLabel><text>[Pg 2]</text></navLabel><content src="one.xhtml#pg2"/></pageTarget>',
  }));
  assert.deepEqual(Object.keys(got), ['One']);
});

test('a malformed link or a file missing from the EPUB does not stop the import', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: '100%.xhtml', body: longText('one') }, { href: 'gone.xhtml', body: '', missing: true }, { href: 'two.xhtml', body: longText('two') }],
    nav: '<li><a href="100%.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li>',
  }));
  assert.deepEqual(Object.keys(got), ['One', 'Two']);
});

test('EPUB entities: named ones are decoded, unknown and invalid ones dropped', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: 'one.xhtml', body: p('caf&eacute; &copy; &bogus; &#99999999;ok &amp; done') + longText('one') }],
    nav: '<li><a href="one.xhtml">One</a></li>',
  }));
  assert.match(got.One, /^café ok done one/);   // © and & are marks without letters
});

test('an anchor inside a word or paragraph leaves the text whole', async () => {
  const got = await chapterWords(buildEpub({
    chapters: [{ href: 'one.xhtml', body: p('a won<span id="p5"></span>derful <a id="n1"></a>day') + longText('one') }],
    nav: '<li><a href="one.xhtml">One</a></li>',
  }));
  assert.match(got.One, /^a wonderful day one/);
});

test('an EPUB gives its title, author and chapters from its table of contents', async () => {
  const book = await snowdropBook();
  assert.equal(book.title, 'Snowdrop & Other Tales');
  assert.equal(book.author, 'Jacob Grimm, Wilhelm Grimm');
  assert.deepEqual(plain(titles(book).slice(-2)), ['Snowdrop', 'The Pink']);
  assert.ok(!titles(book).some((t) => /^contents$|illustrations/i.test(t)));
});

test('an EPUB chapter is its prose only', async () => {
  const book = await snowdropBook();
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
test('Alice in Wonderland comes with the app, in its chapters', () => {
  const alice = FT.books.bundled();
  assert.equal(alice.title, 'Alice’s Adventures in Wonderland');
  assert.equal(alice.chapters.length, 12);
  assert.equal(alice.chapters[0].title, 'CHAPTER I. Down the Rabbit-Hole');
  assert.equal(alice.chapters[0].words.slice(0, 4).join(' '), 'Alice was beginning to');
});

test('the bundled book is ready to type from Chapter I', () => {
  const stored = FT.books.bundledText();
  assert.equal(stored.pos, 0);
  assert.ok(stored.bundled);
  assert.ok(stored.words.length > 25000);
});
