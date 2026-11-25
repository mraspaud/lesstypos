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

test('the frontier stays within bounds and a manual override is respected', () => {
  const d = FT.difficulty.create({ frontier: 120, min: 100, max: 1000 });
  for (let i = 0; i < 5; i++) d.update(win({ firstAttemptAccuracy: 0.9 }));
  assert.equal(d.state().frontier, 100);
  d.override(5000);
  assert.equal(d.state().frontier, 1000);
  assert.equal(d.state().manual, true);
  assert.equal(d.update(win()).action, 'manual');
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
  assert.ok(h[0].reasons.length > 0);
});
