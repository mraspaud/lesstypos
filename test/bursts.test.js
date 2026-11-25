'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: speed bursts aim at an adaptive pace target. It starts a bit
// above relaxed speed, rises after a round that meets it accurately, falls
// otherwise (1-up-1-down staircase), and stays within bounds.

const FT = load();
const relaxed = (wpm) => ({ type: 'relaxed', wpm, words: 200 });

test('the target starts 10% above recent relaxed speed', () => {
  assert.equal(Math.round(FT.bursts.initialTarget([relaxed(50), relaxed(60), relaxed(55)])), 61); // median 55 x 1.1
  assert.equal(FT.bursts.initialTarget([]), 40);
});

test('a round that meets the target accurately raises it; otherwise it falls', () => {
  const up = FT.bursts.step(60, { wpm: 62, accuracy: 0.97 }, 55);
  assert.ok(Math.abs(up.after - 61.2) < 1e-9);
  assert.equal(up.result, 'met');
  const slow = FT.bursts.step(60, { wpm: 58, accuracy: 0.99 }, 55);
  assert.ok(Math.abs(slow.after - 58.8) < 1e-9);
  const sloppy = FT.bursts.step(60, { wpm: 70, accuracy: 0.9 }, 55);
  assert.ok(sloppy.after < 60);
  assert.match(sloppy.reason, /accuracy/);
});

test('the target stays between 0.9x and 2x relaxed speed', () => {
  assert.equal(FT.bursts.step(49.6, { wpm: 10, accuracy: 0.5 }, 55).after, 49.5);
  assert.equal(FT.bursts.step(110, { wpm: 200, accuracy: 1 }, 55).after, 110);
});

test('round statistics count the words finished inside the round', () => {
  const s = FT.session.create(['abcd', 'efgh', 'ijkl']);
  let t = 0;
  for (const w of ['abcd ', 'efgh ']) for (const ch of w) s.input({ kind: 'text', data: ch, t: (t += 100) });
  t += 10000; // rest
  for (const ch of 'ijkl ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const words = s.state().words.filter((w) => w.committed);
  const r1 = FT.bursts.roundStats(words, 0, 1000);
  assert.equal(r1.words, 2);
  assert.ok(Math.abs(r1.wpm - 120) < 1e-6); // 10 chars / 5 / (1000 ms / 60000)
  assert.equal(r1.accuracy, 1);
});

test('finishing a burst exercise replays its rounds and persists the target', () => {
  const tr = FT.trainer.create({ seed: 9 });
  const ex = tr.newExercise({ type: 'bursts' });
  const s = FT.session.create(ex.words.slice(0, 60));
  let t = 0; const rounds = [];
  const list = s.state().words.slice(0, 60);
  for (let r = 0; r < 3; r++) {
    const start = t;
    for (const w of list.slice(r * 20, r * 20 + 20)) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 60) });
    rounds.push({ start, end: t });
    t += 10000;
  }
  const before = tr.bursts.target();
  const { summary, raw } = tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed), rounds });
  assert.equal(summary.rounds.length, 3);
  assert.equal(summary.rounds[0].before, before);
  assert.ok(tr.bursts.target() > before); // 60 ms/key is ~200 WPM: every round met
  const rebuilt = FT.trainer.rebuild([JSON.parse(JSON.stringify(raw))], { seed: 9 });
  assert.equal(rebuilt.bursts.target(), tr.bursts.target());
  assert.equal(FT.trainer.create({ seed: 9, profile: JSON.parse(JSON.stringify(tr.profile())) }).bursts.target(), tr.bursts.target());
});
