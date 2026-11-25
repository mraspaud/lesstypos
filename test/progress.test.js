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

// Functionality: a per-word timeline of the exercise (like Monkeytype's
// result chart): speed of each word, running average speed, and the words
// whose first attempt had an error.
function typedWords(script) {
  const s = FT.session.create(script.map((x) => x[0]));
  let t = 0;
  for (const [, typed, dt] of script) for (const ch of typed) {
    t += dt;
    s.input(ch === '<' ? { kind: 'back', t } : { kind: 'text', data: ch, t });
  }
  return s.state().words.filter((w) => w.committed);
}

test('the timeline gives per-word and running speed and marks errors', () => {
  // "abcd " = 5 chars; at 100 ms per key a word takes 0.5 s -> 5/5 / (0.5/60) = 120 WPM
  const words = typedWords([['abcd', 'abcd ', 100], ['efgh', 'efgh ', 200], ['ijkl', 'ixjkl<<jkl ', 100]]);
  const tl = plain(FT.progress.timeline(words));
  assert.equal(tl.length, 3);
  assert.equal(tl[0].word, 'abcd');
  assert.equal(Math.round(tl[1].burst), 60);
  assert.equal(tl[0].error, false);
  assert.equal(tl[2].error, true);
  // running WPM after word 2: 10 correct chars in 0.4 s + 1.0 s = 1.4 s ... measured from the first keystroke
  assert.ok(tl[1].running > 60 && tl[1].running < 120);
});

test('the first word is timed from its first keystroke', () => {
  const words = typedWords([['abcd', 'abcd ', 100]]);
  const tl = FT.progress.timeline(words);
  assert.equal(Math.round(tl[0].burst), 150); // 5 chars over 0.4 s between first and last keydown
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

test('common-pair timing leaves out speed bursts', () => {
  const p = plain(FT.progress.series(HIST).pairMs);
  assert.deepEqual(p.map((x) => [x.day, x.ms]), [['2026-01-01', 115], ['2026-01-02', 100], ['2026-01-03', 105]]);
});

// Functionality: per-key error statistics for the heatmap. A multi-letter key
// (th) is one press; where wrong presses land is counted too.
// Words as typed: [target, typed], where [..] in typed is one multi-character input event.
function analysed(pairs) {
  return pairs.map(([p, typed]) => {
    const stream = [];
    let g = 0, t = 0;
    for (const part of (typed + ' ').match(/\[[^\]]+\]|./g)) {
      g++; t += 100;
      if (part === '<') { stream.push({ k: 'b', t }); continue; }
      for (const ch of part.replace(/^\[|\]$/g, '')) stream.push({ k: 'c', ch, t, g });
    }
    return { target: p, stream, analysis: FT.align.analyzeWord(p + ' ', stream) };
  });
}

test('key statistics count presses, with multi-letter keys as one press', () => {
  const ks = plain(FT.progress.keyStats(analysed([['the', 'the'], ['then', 'tgen'], ['art', 'art']]), ['th']));
  assert.deepEqual(ks.keys.th, [2, 1]);       // two presses of the th key, one wrong first attempt
  assert.deepEqual(ks.keys.t, [1, 0]);        // the t in "art" is a plain t press
  assert.deepEqual(ks.keys.e, [2, 0]);
  assert.deepEqual(ks.keys[' '], [3, 0]);
  assert.deepEqual(ks.land, { g: 1 });         // the wrong press landed on g
});

test('without declared multi-letter keys every character is its own press', () => {
  const ks = plain(FT.progress.keyStats(analysed([['the', 'thx<e']]), []));
  assert.deepEqual(ks.keys.t, [1, 0]);
  assert.deepEqual(ks.keys.e, [1, 1]);
  assert.deepEqual(ks.land, { x: 1 });
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

test('a wrong press of a multi-letter key lands on that key', () => {
  const ks = plain(FT.progress.keyStats(analysed([['to', '[th]<<to']]), ['th']));
  assert.deepEqual(ks.land, { th: 1 });
});

test('multi-letter keys match regardless of capitals', () => {
  const ks = plain(FT.progress.keyStats(analysed([['The', 'The']]), ['th']));
  assert.deepEqual(ks.keys.th, [1, 0]);
});
