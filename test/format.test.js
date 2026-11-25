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

test('the storage line gives sessions and statistics sizes', () => {
  assert.equal(FT.fmt.storageLine({ sessions: 12, sessionBytes: 2.5 * 1048576, profileBytes: 400 * 1024 }),
    '12 exercises take 2.5 MB; statistics derived from them take 400 KB.');
  assert.equal(FT.fmt.storageLine({ sessions: 1, sessionBytes: 900, profileBytes: 0 }), '1 exercise takes 1 KB; statistics derived from them take 0 KB.');
});
