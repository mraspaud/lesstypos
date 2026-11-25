'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the Sequences page says which keys the keyboard sends late
// and what that means for their judgement.
const FT = load();

test('the late-key note lists the keys, space as ␣, and says what is still judged', () => {
  const html = FT.fmt.lateNote([' ', 'e', 'n', 'r']);
  assert.match(html, /␣/);
  assert.match(html, /<span class="seq">e<\/span>, <span class="seq">n<\/span> and <span class="seq">r<\/span>/);
  assert.match(html, /speed is not judged/);
  assert.match(html, /errors are/);
});

test('no late keys, no note', () => {
  assert.equal(FT.fmt.lateNote([]), '');
  assert.equal(FT.fmt.lateNote(undefined), '');
});
