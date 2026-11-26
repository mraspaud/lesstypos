'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the reading place is where the typed words end in the book;
// places saved while prose skipped part of the book are repaired.
const FT = load();
const book = { id: 'b', words: Array.from({ length: 700 }, (_, i) => 'w' + i) };
const typedWords = (indices) => indices.map((i) => ({ target: book.words[i] }));
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

test('the place after an exercise is the word after the last one typed, when the words follow the book', () => {
  assert.equal(FT.books.placeAfter(book, 10, typedWords(range(10, 140))), 140);
});

test('words that do not follow the book in order give no place', () => {
  assert.equal(FT.books.placeAfter(book, 10, typedWords([10, 11, 13])), null);
});

test('words that skipped part of the book, as prose did, lead to the real place', () => {
  const skipped = typedWords([...range(45, 165), ...range(445, 601)]);
  assert.equal(FT.books.placeAfterSkip(book, 45, skipped), 601);
});

test('a place saved after a skip is repaired; a place without a skip, or chosen since, is left alone', () => {
  const skippedExercise = { text: { id: 'b', from: 45, to: 321 }, words: typedWords([...range(45, 165), ...range(445, 601)]) };
  assert.equal(FT.books.repairedPlace(Object.assign({}, book, { pos: 321 }), skippedExercise), 601);
  assert.equal(FT.books.repairedPlace(Object.assign({}, book, { pos: 45 }), skippedExercise), null);   // a chapter chosen since
  const plain = { text: { id: 'b', from: 10, to: 140 }, words: typedWords(range(10, 140)) };
  assert.equal(FT.books.repairedPlace(Object.assign({}, book, { pos: 140 }), plain), null);
  const odd = { text: { id: 'b', from: 10, to: 13 }, words: [...typedWords([10, 11]), { target: 'elsewhere' }] };
  assert.equal(FT.books.repairedPlace(Object.assign({}, book, { pos: 13 }), odd), null);
});
