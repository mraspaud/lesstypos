'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { typist, typeCorrectly, correctly } = require('./helpers/typing');
const { near } = require('./helpers/assert');

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
  near(up.after, 61.2);
  assert.equal(up.result, 'met');
  const slow = FT.bursts.step(60, { wpm: 58, accuracy: 0.99 }, 55);
  near(slow.after, 58.8);
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
  const hands = typist(s, { at: 100 }).type('abcd efgh ');
  typist(s, { at: hands.t + 10100 }).type('ijkl ');   // after a rest
  const words = s.state().words.filter((w) => w.committed);
  const r1 = FT.bursts.roundStats(words, FT.align.analyzeWords(words), 0, 1000);
  assert.equal(r1.words, 2);
  near(r1.wpm, 120, 1e-6); // 10 chars / 5 / (1000 ms / 60000)
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
    t = typist(s, { at: t + 60, dt: 60 }).type(correctly(list.slice(r * 20, r * 20 + 20))).t;
    rounds.push({ start, end: t });
    t += 10000;   // a rest
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

test('a burst exercise reports speed over its rounds, not the rests between them', () => {
  const tr = FT.trainer.create({ seed: 10 });
  const s = FT.session.create(['abcd', 'efgh', 'ijkl', 'mnop']);
  const r1 = { start: 0, end: typist(s, { at: 100 }).type('abcd efgh ').t };
  const start2 = r1.end + 10000;   // after a rest
  const r2 = { start: start2, end: typist(s, { at: start2 + 100 }).type('ijkl mnop ').t };
  const { summary } = tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: r2.end, words: s.state().words.filter((w) => w.committed), rounds: [r1, r2] });
  near(summary.metrics.wpm, 120, 1, String(summary.metrics.wpm)); // 20 chars in 2 s
});

test('reading the burst target does not fix it before any burst is finished', () => {
  const tr = FT.trainer.create({ seed: 11 });
  assert.equal(tr.bursts.target(), 40);                 // no relaxed history yet
  const relaxed = (t0) => {
    const { words, t } = typeCorrectly(FT, tr.newExercise({ type: 'relaxed' }).words.slice(0, 80), { at: t0 + 100 });
    tr.finish({ type: 'relaxed', startedAt: t0, durationMs: t - t0, words });
  };
  relaxed(Date.UTC(2026, 0, 1));
  assert.ok(tr.bursts.target() > 100);                   // follows relaxed speed (~120 WPM x 1.1)
  assert.equal(tr.profile().bursts.target, null);        // nothing was stored by reading it
});

test('burst metrics count only the words finished inside the rounds', () => {
  const tr = FT.trainer.create({ seed: 13 });
  const s = FT.session.create(['abcd', 'efgh', 'ijkl', 'mnop', 'qrst', 'uvwx']);
  const r1 = { start: 0, end: typist(s, { at: 100 }).type('abcd efgh ').t };
  // words typed after the last completed round (e.g. a partial round before Finish)
  const t = typist(s, { at: r1.end + 10050, dt: 50 }).type('ijkl mnop qrst uvwx ').t;
  const { summary } = tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed), rounds: [r1] });
  assert.equal(summary.metrics.words, 2);
  near(summary.metrics.wpm, 120, 1, String(summary.metrics.wpm));
});

test('live round statistics use the multi-letter keys', () => {
  const s = FT.session.create(['you', 'are', 'we']);
  typist(s, { at: 100, dt: 4 }).type('th');   // the th key, sending two fast keystrokes
  const t = typist(s, { at: 204 }).type('ou are we ').t;
  const words = s.state().words.filter((w) => w.committed);
  const chars = 4 + 4 + 3;
  near(FT.bursts.roundStats(words, FT.align.analyzeWords(words, { macros: ['th'] }), 0, t).accuracy, 1 - 1 / chars);
});
