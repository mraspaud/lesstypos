'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: reading a book between daily trainings, and prose that ends
// at a sentence end when its time is up.
const FT = load();

test('home offers the daily training until it is done today, then reading; a started training is resumed first', () => {
  const choose = FT.programme.homeDefault;
  assert.equal(choose({ trainedToday: false, resumable: false }), 'train');
  assert.equal(choose({ trainedToday: true, resumable: false }), 'read');
  assert.equal(choose({ trainedToday: true, resumable: true }), 'resume');
});

test('a day counts as trained when an exercise of a daily training was done that day', () => {
  const day = FT.days.number(Date.UTC(2026, 10, 26, 12));
  const at = (h) => Date.UTC(2026, 10, 26, h);
  assert.equal(FT.history.trainedOn([{ startedAt: at(9), run: 'r1' }], day), true);
  assert.equal(FT.history.trainedOn([{ startedAt: at(9) }], day), false);                       // practice outside a training
  assert.equal(FT.history.trainedOn([{ startedAt: at(9) - 86400e3, run: 'r0' }], day), false);  // yesterday's training
});

test('a history entry records the daily training it belonged to', () => {
  const tr = FT.trainer.create({ seed: 3 });
  const s = FT.session.create(tr.newExercise({ type: 'relaxed' }).words.slice(0, 20));
  let t = 0;
  for (const w of s.state().words.slice(0, 20)) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 10, 26, 9), durationMs: t, run: 'r7', words: s.state().words.filter((w) => w.committed) });
  assert.equal(tr.history().at(-1).run, 'r7');
});

test('a sentence ends at . ! ? or … , also inside closing quotes, but not after a common abbreviation', () => {
  const ends = FT.text.endsSentence;
  for (const w of ['tired.', 'conversations?”', 'Hi!', 'so…', '(end.)', 'said.’']) assert.ok(ends(w), w);
  for (const w of ['Mr.', 'Mrs.', 'Dr.', 'St.', 'word', 'well,', 'e.g.']) assert.ok(!ends(w), w);
});
