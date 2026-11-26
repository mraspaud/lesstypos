'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: session metrics. Error rates per Soukoreff & MacKenzie (2003);
// WPM uses the 5-character word; first-attempt accuracy is the share of target
// characters whose first attempt was correct (corrected errors still count).

const FT = load();
function stream(str, t0 = 0, dt = 100) {
  return Array.from(str).map((ch, i) =>
    ch === '<' ? { k: 'b', t: t0 + i * dt } : { k: 'c', ch, t: t0 + i * dt, g: i });
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('error rates follow the C/INF/IF/F definitions', () => {
  const words = [
    FT.align.analyzeWord('cat ', stream('cx<at ')), // IF=1 F=1 C=4
    FT.align.analyzeWord('dog ', stream('dig ')), // INF=1 C=3
  ];
  const m = FT.metrics.summarize(words, { durationMs: 60000 });
  assert.equal(m.C, 7); assert.equal(m.INF, 1); assert.equal(m.IF, 1); assert.equal(m.F, 1);
  near(m.uncorrectedErrorRate, 1 / 9);
  near(m.correctedErrorRate, 1 / 9);
  near(m.totalErrorRate, 2 / 9);
  near(m.conscientiousness, 0.5);
  near(m.kspc, 10 / 8);
});

test('first-attempt accuracy counts corrected errors', () => {
  const words = [FT.align.analyzeWord('cat ', stream('cx<at ')), FT.align.analyzeWord('dog ', stream('dog '))];
  const m = FT.metrics.summarize(words, { durationMs: 60000 });
  near(m.firstAttemptAccuracy, 7 / 8);
  near(m.finalAccuracy, 1);
});

test('wpm counts correct characters in five-character words; raw counts all keystrokes', () => {
  const words = [];
  for (let i = 0; i < 10; i++) words.push(FT.align.analyzeWord('abcd ', stream('abcd ')));
  const m = FT.metrics.summarize(words, { durationMs: 30000 });
  near(m.wpm, 50 / 5 / 0.5);
  near(m.rawWpm, 50 / 5 / 0.5);
  const w2 = [FT.align.analyzeWord('abcd ', stream('abxd '))];
  const m2 = FT.metrics.summarize(w2, { durationMs: 60000 });
  near(m2.wpm, 4 / 5);
  near(m2.rawWpm, 5 / 5);
});

test('an empty session yields null metrics rather than NaN', () => {
  const m = FT.metrics.summarize([], { durationMs: 0 });
  assert.equal(m.wpm, null);
  assert.equal(m.firstAttemptAccuracy, null);
});

test('a summary without a duration reports 0 ms, not undefined', () => {
  assert.equal(FT.metrics.summarize([], {}).durationMs, 0);
});
