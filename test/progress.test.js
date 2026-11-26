'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: progress is judged at matched effort and accuracy. The same
// speed at lower effort counts as progress, like more speed at the same effort.

const FT = load();
const h = (wpm, effort, firstAttemptAccuracy = 0.99, type = 'relaxed') => ({ type, wpm, effort, firstAttemptAccuracy, words: 200 });

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
  assert.ok(FT.fmt.comparison(c).includes('less effort'));
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
const D = (d, h = 9) => new Date(2026, 0, d, h).getTime();   // local time: days are local days
const HIST = [
  { type: 'relaxed', startedAt: D(1), wpm: 50, firstAttemptAccuracy: 0.98, effort: 3, words: 200, commonPairMs: 120, wordStartMs: 90, rhythmCv: 0.5 },
  { type: 'relaxed', startedAt: D(1, 18), wpm: 54, firstAttemptAccuracy: 0.99, effort: 2, words: 200, commonPairMs: 110, wordStartMs: 80, rhythmCv: 0.4 },
  { type: 'bursts', startedAt: D(1), wpm: 80, firstAttemptAccuracy: 0.95, words: 100, commonPairMs: 70 },
  { type: 'relaxed', startedAt: D(3), wpm: 56, firstAttemptAccuracy: 0.99, effort: null, words: 200, commonPairMs: 105, wordStartMs: 70, rhythmCv: 0.4 },
  { type: 'relaxed', startedAt: D(4), wpm: 99, firstAttemptAccuracy: 1, words: 20 },                         // too short to count
  ...[60, 64, 62].map((wpm, i) => ({ type: 'benchmark', benchmarkSet: 'a', startedAt: D(2, 9 + i), wpm, firstAttemptAccuracy: 0.98, commonPairMs: 100 })),
  ...[70, 66].map((wpm, i) => ({ type: 'benchmark', benchmarkSet: 'b', startedAt: D(5, 9 + i), wpm, firstAttemptAccuracy: 0.98 })), // incomplete set
];

test('relaxed practice is summarised per day', () => {
  const r = plain(FT.progress.series(HIST).relaxed);
  assert.deepEqual(r.map((p) => [p.day, p.wpm, p.exercises]), [['2026-01-01', 52, 2], ['2026-01-03', 56, 1]]);
  assert.equal(r[0].effort, 2.5);
  assert.equal(r[1].effort, null);
});

test('benchmarks count only complete sets of three trials', () => {
  const b = plain(FT.progress.series(HIST).benchmark);
  assert.deepEqual(b.map((p) => [p.set, p.wpm, p.min, p.max]), [['a', 62, 60, 64]]);
});

test('common-pair timing per day comes from relaxed practice', () => {
  const p = plain(FT.progress.series(HIST).commonPairMs);
  assert.deepEqual(p.map((x) => [x.day, x.commonPairMs]), [['2026-01-01', 110], ['2026-01-03', 105]]);
});

// Benchmark sets: only complete sets of 3 full-length trials count, for the
// series, the "due" state and the comparison with the previous benchmark.
const trial = (benchmarkSet, d, wpm, durationMs = 60000) => ({ type: 'benchmark', benchmarkSet, startedAt: D(d, 10), wpm, firstAttemptAccuracy: 0.98, durationMs, plannedMs: 60000 });

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
    { type: 'relaxed', startedAt: D(10), words: 200, commonPairMs: 100, commonPairIntervals: 200 },
    { type: 'relaxed', startedAt: D(10, 12), words: 200, commonPairMs: 140, commonPairIntervals: 20 },
    { type: 'warmup', startedAt: D(10, 8), words: 100, commonPairMs: 60, commonPairIntervals: 300 },
    { type: 'warmup', startedAt: D(10, 9), words: 100, commonPairMs: 50, commonPairIntervals: 300 },
  ];
  assert.deepEqual(plain(FT.progress.series(h).commonPairMs.map((p) => p.commonPairMs)), [100]);
});

test('an exercise too short to count gets no comparison', () => {
  const h = [50, 52, 51].map((wpm) => ({ type: 'relaxed', wpm, firstAttemptAccuracy: 0.99, effort: 3, words: 200 }));
  const cur = { type: 'relaxed', wpm: 90, firstAttemptAccuracy: 1, effort: 3, words: 3 };
  assert.equal(FT.progress.compare(h, cur), null);
});

// Functionality: the experimental fluency index over time, and its check
// against every complete benchmark set (the prediction made before the set).
const predicted = (entry, fluencyWpm, effortlessWpm, fluencyCoverage = 0.8) => Object.assign(entry, { fluencyWpm, effortlessWpm, fluencyCoverage });
const relaxedAt = (d, h) => ({ type: 'relaxed', startedAt: D(d, h), wpm: 50, words: 200, firstAttemptAccuracy: 0.99 });

test('the fluency index per day is the last prediction of the day with enough coverage', () => {
  const h = [predicted(relaxedAt(1, 9), 50, 45), predicted(relaxedAt(1, 18), 52, undefined, 0.7), predicted(relaxedAt(2, 9), 70, 60, 0.3), predicted(relaxedAt(3, 9), 55, 48)];
  const days = plain(FT.progress.series(h).fluency);
  assert.deepEqual(days.map((p) => [p.day, p.wpm, p.effortlessWpm, p.coverage]), [['2026-01-01', 52, null, 0.7], ['2026-01-03', 55, 48, 0.8]]);
});

test('each complete benchmark set is checked against the prediction made before its first trial', () => {
  const h = [
    predicted(trial('a', 1, 60), 66, 70), predicted(trial('a', 1, 62), 67, 71), predicted(trial('a', 1, 64), 67, 71),
    predicted(trial('b', 8, 70), 60, undefined), predicted(trial('b', 8, 72), 60, undefined), predicted(trial('b', 8, 74), 60, undefined),
    predicted(trial('c', 9, 80), 60, 60),                                                            // incomplete set
  ];
  const check = plain(FT.progress.fluencyCheck(h));
  assert.deepEqual(check.rows.map((r) => [r.set, r.measured, r.fluencyWpm, r.effortlessWpm]), [['a', 62, 66, 70], ['b', 72, 60, null]]);
  assert.deepEqual(check.fluency, { sets: 2, meanAbsoluteError: 8, meanError: -4 });        // (+4, -12): under-predicting on the whole
  assert.deepEqual(check.effortless, { sets: 1, meanAbsoluteError: 8, meanError: 8 });
});

test('a benchmark predicted with too little coverage is not checked', () => {
  const h = [60, 62, 64].map((wpm) => predicted(trial('a', 1, wpm), 66, 70, 0.4));
  const check = plain(FT.progress.fluencyCheck(h));
  assert.deepEqual(check.rows, []);
  assert.equal(check.fluency, null);
});

// Functionality: where the time of recent relaxed typing goes, measured: the
// flow of keystrokes without errors, and the time corrections cost
// (FT.timing correction) with their cost per error.
const typed = (wpm, durationMs, correctionMs, errors, more = {}) => Object.assign({ type: 'relaxed', words: 200, wpm, durationMs,
  paceMs: { within: 150, initial: 200 }, correctionMs, errors, pauseMs: 0, presses: 1000 }, more);

test('recent relaxed typing splits into flow speed and the share of time corrections cost', () => {
  const b = plain(FT.progress.timeBreakdown([typed(60, 60000, 6000, 6), typed(50, 120000, 24000, 20)]));
  assert.equal(b.exercises, 2);
  assert.equal(b.flowWpm, (60 * 60000 + 50 * 120000) / (54000 + 96000));   // the same characters without the correction time
  assert.equal(b.correctionShare, 30000 / 180000);
  assert.equal(b.errorCostMs, 30000 / 26);                                 // pooled, not the mean of 1,000 and 1,200 ms
});

test('the breakdown takes the last 5 comparable relaxed exercises', () => {
  const old = typed(10, 60000, 30000, 3), other = { type: 'warmup' }, short = { words: 20 };
  const b = FT.progress.timeBreakdown([old].concat([1, 2, 3, 4, 5].map(() => typed(60, 60000, 6000, 6)),
    [typed(10, 60000, 30000, 3, other), typed(10, 60000, 30000, 3, short)]));
  assert.equal(b.exercises, 5);
  assert.equal(b.correctionShare, 0.1);
  assert.equal(b.errorCostMs, 1000);
});

test('typing without errors has no cost per error', () => {
  const b = FT.progress.timeBreakdown([typed(60, 60000, 0, 0)]);
  assert.equal(b.correctionShare, 0);
  assert.equal(b.flowWpm, 60);
  assert.equal(b.errorCostMs, null);
});

test('correction time without errors counts in the share, with no cost per error', () => {
  const b = FT.progress.timeBreakdown([typed(60, 60000, 6000, 0)]);
  assert.equal(b.correctionShare, 0.1);
  assert.equal(b.errorCostMs, null);
});

test('there is no breakdown before a relaxed exercise was measured', () => {
  assert.equal(FT.progress.timeBreakdown([typed(60, 60000, 6000, 6, { paceMs: undefined, correctionMs: undefined })]), null);
});
