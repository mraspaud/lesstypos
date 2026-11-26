'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: progress is judged at matched effort and accuracy. The same
// speed at lower effort counts as progress, like more speed at the same effort.

const FT = load();
const h = (wpm, effort, faa = 0.99, type = 'relaxed') => ({ type, wpm, effort, faa, words: 200 });

test('compares speed with recent sessions at the same effort', () => {
  const hist = [h(50, 2), h(52, 2), h(51, 2), h(60, 4)];
  const c = plain(FT.progress.compare(hist, h(55, 2)));
  assert.equal(c.kind, 'same-effort');
  assert.equal(c.baselineWpm, 51);
  assert.equal(c.deltaWpm, 4);
});

test('the same speed at lower effort is reported as progress', () => {
  const hist = [h(54, 3), h(55, 3), h(53, 3)];
  const c = plain(FT.progress.compare(hist, h(54, 2)));
  assert.equal(c.kind, 'lower-effort');
  assert.ok(c.message.includes('less effort'));
});

test('sessions with clearly lower accuracy are not used as a baseline', () => {
  const hist = [h(70, 2, 0.95), h(50, 2), h(50, 2)];
  assert.equal(FT.progress.compare(hist, h(52, 2)).baselineWpm, 50);
});

test('no comparison without enough comparable sessions or an effort rating', () => {
  assert.equal(FT.progress.compare([h(50, 2)], h(52, 2)), null);
  assert.equal(FT.progress.compare([h(50, 2), h(50, 2)], h(52, null)), null);
  assert.equal(FT.progress.compare([h(50, 2, 0.99, 'bursts'), h(50, 2, 0.99, 'bursts')], h(52, 2)), null);
});

// Functionality: progress series keep only comparable sessions together and
// summarise each day by its median.
const D = (d, h = 9) => Date.UTC(2026, 0, d, h);
const HIST = [
  { type: 'relaxed', t: D(1), wpm: 50, faa: 0.98, effort: 3, words: 200, pairMs: 120, startMs: 90, cv: 0.5 },
  { type: 'relaxed', t: D(1, 18), wpm: 54, faa: 0.99, effort: 2, words: 200, pairMs: 110, startMs: 80, cv: 0.4 },
  { type: 'bursts', t: D(1), wpm: 80, faa: 0.95, words: 100, pairMs: 70 },
  { type: 'relaxed', t: D(3), wpm: 56, faa: 0.99, effort: null, words: 200, pairMs: 105, startMs: 70, cv: 0.4 },
  { type: 'relaxed', t: D(4), wpm: 99, faa: 1, words: 20 },                         // too short to count
  ...[60, 64, 62].map((wpm, i) => ({ type: 'benchmark', set: 'a', t: D(2, 9 + i), wpm, faa: 0.98, pairMs: 100 })),
  ...[70, 66].map((wpm, i) => ({ type: 'benchmark', set: 'b', t: D(5, 9 + i), wpm, faa: 0.98 })), // incomplete set
];

test('relaxed practice is summarised per day', () => {
  const r = plain(FT.progress.series(HIST).relaxed);
  assert.deepEqual(r.map((p) => [p.day, p.wpm, p.n]), [['2026-01-01', 52, 2], ['2026-01-03', 56, 1]]);
  assert.equal(r[0].effort, 2.5);
  assert.equal(r[1].effort, null);
});

test('benchmarks count only complete sets of three trials', () => {
  const b = plain(FT.progress.series(HIST).benchmark);
  assert.deepEqual(b.map((p) => [p.set, p.wpm, p.min, p.max]), [['a', 62, 60, 64]]);
});

test('common-pair timing per day comes from relaxed practice', () => {
  const p = plain(FT.progress.series(HIST).pairMs);
  assert.deepEqual(p.map((x) => [x.day, x.ms]), [['2026-01-01', 110], ['2026-01-03', 105]]);
});

// Benchmark sets: only complete sets of 3 full-length trials count, for the
// series, the "due" state and the comparison with the previous benchmark.
const trial = (set, d, wpm, ms = 60000) => ({ type: 'benchmark', set, t: D(d, 10), wpm, faa: 0.98, ms, planMs: 60000 });

test('a trial stopped early does not count, so its set is incomplete', () => {
  const h = [trial('a', 1, 60), trial('a', 1, 62), trial('a', 1, 99, 900)];
  assert.equal(plain(FT.progress.completeSets(h)).length, 0);
  assert.equal(FT.progress.benchmarkResult(h, 'a').trials, 2);
});

test('benchmark status uses complete sets and calendar days', () => {
  const h = [trial('a', 1, 60), trial('a', 1, 62), trial('a', 1, 64), trial('b', 9, 80)];
  const s = plain(FT.progress.benchmarkStatus(h, D(9, 20)));
  assert.equal(s.last.set, 'a');
  assert.equal(s.days, 8);
  assert.equal(s.due, true);
  assert.equal(FT.progress.benchmarkStatus(h, D(2, 1)).days, 1);   // the next calendar day, even < 24 h later
  assert.equal(FT.progress.benchmarkStatus([], D(2)).due, true);
  assert.equal(FT.progress.benchmarkStatus([], D(2)).last, null);
});

test('the previous benchmark is the last complete set before this one', () => {
  const h = [trial('a', 1, 60), trial('a', 1, 62), trial('a', 1, 64), trial('x', 3, 90), trial('c', 5, 70), trial('c', 5, 70), trial('c', 5, 70)];
  assert.equal(FT.progress.previousSet(h, 'c').set, 'a');
});

test('common-pair timing comes from relaxed practice only, weighted by intervals', () => {
  const h = [
    { type: 'relaxed', t: D(10), words: 200, pairMs: 100, pairN: 200 },
    { type: 'relaxed', t: D(10, 12), words: 200, pairMs: 140, pairN: 20 },
    { type: 'warmup', t: D(10, 8), words: 100, pairMs: 60, pairN: 300 },
    { type: 'warmup', t: D(10, 9), words: 100, pairMs: 50, pairN: 300 },
  ];
  assert.deepEqual(plain(FT.progress.series(h).pairMs.map((p) => p.ms)), [100]);
});

test('an exercise too short to count gets no comparison', () => {
  const h = [50, 52, 51].map((wpm) => ({ type: 'relaxed', wpm, faa: 0.99, effort: 3, words: 200 }));
  const cur = { type: 'relaxed', wpm: 90, faa: 1, effort: 3, words: 3 };
  assert.equal(FT.progress.compare(h, cur), null);
});
