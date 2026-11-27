'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: the difficulty controller moves the vocabulary frontier only
// on sufficient relaxed-mode evidence. Accuracy gates advancement; hesitation,
// rhythm and perceived effort can hold it; there is no WPM floor. Every
// decision carries its reasons.

const FT = load();
const win = (o) => Object.assign({ words: 160, firstAttemptAccuracy: 0.996, hesitationRate: 0.05, rhythmCv: 0.3, effort: null, wpm: 40 }, o);

test('no decision until the evidence window is large enough', () => {
  const d = FT.difficulty.create({ frontier: 200 });
  const r = d.update(win({ words: 80 }));
  assert.equal(r.action, 'wait');
  assert.equal(d.state().frontier, 200);
});

test('evidence accumulates across exercises until the window is full', () => {
  const d = FT.difficulty.create({ frontier: 200 });
  d.update(win({ words: 80 }));
  const r = d.update(win({ words: 80 }));
  assert.equal(r.action, 'advance');
});

test('sustained high accuracy advances the frontier gradually', () => {
  const d = FT.difficulty.create({ frontier: 200 });
  const r = d.update(win());
  assert.equal(r.action, 'advance');
  const f = d.state().frontier;
  assert.ok(f > 200 && f < 260, String(f));
});

test('accuracy inside the target band holds the frontier', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  const r = d.update(win({ firstAttemptAccuracy: 0.99 }));
  assert.equal(r.action, 'hold');
  assert.equal(d.state().frontier, 500);
});

test('low accuracy retreats the frontier', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  assert.equal(d.update(win({ firstAttemptAccuracy: 0.975 })).action, 'retreat');
  assert.ok(d.state().frontier < 500);
});

test('high accuracy with worse hesitation than baseline holds', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  for (let i = 0; i < 3; i++) d.update(win({ firstAttemptAccuracy: 0.99, hesitationRate: 0.05 }));
  const r = d.update(win({ hesitationRate: 0.12 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /hesitation/.test(x)));
});

test('high accuracy with worse rhythm than baseline holds', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  for (let i = 0; i < 3; i++) d.update(win({ firstAttemptAccuracy: 0.99, rhythmCv: 0.3 }));
  const r = d.update(win({ rhythmCv: 0.5 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /rhythm/.test(x)));
});

test('high perceived effort holds advancement', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  const r = d.update(win({ effort: 4 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /effort/.test(x)));
});

test('speed is never a criterion', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  assert.equal(d.update(win({ wpm: 12 })).action, 'advance');
});

test('the frontier stays within its bounds', () => {
  const d = FT.difficulty.create({ frontier: 120 }, { min: 100, max: 1000 });
  for (let i = 0; i < 5; i++) d.update(win({ firstAttemptAccuracy: 0.9 }));
  assert.equal(d.state().frontier, 100);
  d.override(5000);
  assert.equal(d.state().frontier, 1000);
});

test('a fixed vocabulary is respected until released', () => {
  const d = FT.difficulty.create({ frontier: 300 });
  d.override(800);
  assert.equal(d.state().manual, true);
  assert.equal(d.update(win()).action, 'manual');
  assert.equal(d.state().frontier, 800);
  d.override(null);
  assert.equal(d.state().manual, false);
});

test('decisions are logged with reasons and survive serialisation', () => {
  const d = FT.difficulty.create({ frontier: 200 });
  d.update(win());
  const d2 = FT.difficulty.create(JSON.parse(JSON.stringify(d.toJSON())));
  const h = plain(d2.state().history);
  assert.equal(h.length, 1);
  assert.equal(h[0].action, 'advance');
  assert.match(h[0].reasons.join('; '), /accuracy \(first try\) .* at or above/);
});

// Functionality: the controller's state is only what it learned; its tuning
// comes from the code, so a change of tuning reaches stored profiles.
test('the stored state holds what was learned, not the tuning', () => {
  const d = FT.difficulty.create({ frontier: 500, low: 0.5, high: 0.6, windows: [], history: [] });
  assert.deepEqual(Object.keys(plain(d.toJSON())).sort(), ['frontier', 'history', 'manual', 'pending', 'windows']);
  for (let i = 0; i < 3; i++) d.update({ words: 60, firstAttemptAccuracy: 0.97 });
  assert.equal(d.state().frontier < 500, true); // retreats by the real band, not the stored 0.5
});

test('an exercise without an accuracy figure does not count as 0% accuracy', () => {
  const d = FT.difficulty.create({ frontier: 500 });
  const r = d.update({ words: 200, firstAttemptAccuracy: null });
  assert.notEqual(r.action, 'retreat');
  assert.equal(d.state().frontier, 500);
});

// Functionality: the evidence for the vocabulary comes from relaxed
// practice's unbiased words only (the random sample and the frontier words),
// split into the easiest words (the reference) and the rest. Carriers chosen
// for training targets never count.
const typed = (target, source, errors = 0) => ({
  word: { target, meta: { source } },
  analysis: { targets: Array.from(target, (_, i) => ({ err: i < errors ? 1 : 0 })) },
});
const ranks = { the: 0, and: 1, house: 150, window: 900 };
const evidenceOf = (list) => plain(FT.difficulty.evidence(list.map((x) => x.word), list.map((x) => x.analysis), (w) => (w in ranks ? ranks[w] : -1)));

test('target and maintenance carriers never count as vocabulary evidence', () => {
  const e = evidenceOf([typed('window', 'target', 3), typed('house', 'maintenance', 2), typed('window', 'frontier')]);
  assert.deepEqual(e.vocabulary, { words: 1, chars: 6, errors: 0 });
  assert.deepEqual(e.easiest, { words: 0, chars: 0, errors: 0 });
});

test('the unbiased words below rank 100 are the easiest words; the others are the vocabulary', () => {
  const e = evidenceOf([typed('the', 'random', 1), typed('and', 'frontier'), typed('house', 'random', 2), typed('window', 'frontier'), typed('the', 'target', 3)]);
  assert.deepEqual(e.easiest, { words: 2, chars: 6, errors: 1 });
  assert.deepEqual(e.vocabulary, { words: 2, chars: 11, errors: 2 });
});
