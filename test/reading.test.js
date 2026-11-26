'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: reading a book between daily trainings, and prose that ends
// at a sentence end when its time is up.
const FT = load();

test('home offers the daily training until it is done today, then reading; a started training is resumed first', () => {
  const choose = FT.programme.homeDefault;
  assert.equal(choose({ day: 20, trainedOn: 19, resumable: false }), 'train');
  assert.equal(choose({ day: 20, trainedOn: null, resumable: false }), 'train');
  assert.equal(choose({ day: 20, trainedOn: 20, resumable: false }), 'read');
  assert.equal(choose({ day: 20, trainedOn: 20, resumable: true }), 'resume');
});

test('the day of the last finished daily training is kept in the settings', () => {
  assert.equal(FT.settings.clean({ trainedOn: 20450 }).trainedOn, 20450);
  assert.equal(FT.settings.clean({ trainedOn: 'x' }).trainedOn, null);
});

test('a sentence ends at . ! ? or … , also inside closing quotes, but not after a common abbreviation', () => {
  const ends = FT.text.endsSentence;
  for (const w of ['tired.', 'conversations?”', 'Hi!', 'so…', '(end.)', 'said.’']) assert.ok(ends(w), w);
  for (const w of ['Mr.', 'Mrs.', 'Dr.', 'St.', 'word', 'well,', 'e.g.']) assert.ok(!ends(w), w);
});
