'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { typedWords } = require('./helpers/typing');

// Functionality: per-character timing records with cleaning and normalisation.
// IKI = gap between successive keydowns. Cleaning: >5 s is a pause (Dhakal et
// al. 2018); only correct keystrokes following a correct keystroke with no
// edits in between are timed (Behmer & Crump 2017; post-error slowing,
// Salthouse 1986). Word-initial transitions form their own population.

const FT = load();

const extract = (words, analysisOpts) => FT.timing.extract(words, FT.align.analyzeWords(words, analysisOpts));

// Timing records of a typing script: [[target, typed, dt], ...] (notation:
// test/helpers/typing.js; dt: the gap before each press, or a list of them).
const run = (script, analysisOpts) => extract(typedWords(FT, script.map((x) => x[0]), script.map((x) => x.slice(1))), analysisOpts);

test('records carry the preceding context including spaces', () => {
  const r = run([['ab', 'ab ', 100], ['cd', 'cd ', 100]]);
  assert.deepEqual(plain(r.records.map((x) => x.ch)), ['a', 'b', ' ', 'c', 'd', ' ']);
  assert.equal(r.records[4].ctx, 'b c'); // up to three preceding characters
});

test('iki is the gap to the previous first attempt', () => {
  const r = run([['ab', 'ab ', [100, 150, 200]], ['cd', 'cd ', [120, 80, 90]]]);
  assert.deepEqual(plain(r.records.map((x) => x.iki)), [null, 150, 200, 120, 80, 90]);
});

test('word-initial characters are marked', () => {
  const r = run([['ab', 'ab ', 100], ['cd', 'cd ', 100]]);
  assert.deepEqual(plain(r.records.map((x) => x.wordInitial)), [true, false, false, true, false, false]);
});

test('pauses over 5 s are excluded from timing', () => {
  const r = run([['ab', 'ab ', [100, 6000, 100]]]);
  assert.equal(r.records[1].clean, false);
  assert.equal(r.records[1].reason, 'pause');
  assert.equal(r.records[2].clean, true);
});

test('errors, the keystroke after an error, and edited transitions are not timed', () => {
  const r = run([['cats', 'cx<ats ', 100]]);
  // c ok (no previous), a: first attempt was x (error), t: follows an error, s ok
  assert.deepEqual(plain(r.records.map((x) => x.reason)), ['first', 'error', 'after-error', null, null]);
});

test('a declared macro typed as one input event is one motor event', () => {
  const s = FT.session.create(['the']);
  s.input({ kind: 'text', data: 'th', t: 100 });
  s.input({ kind: 'text', data: 'e', t: 220 });
  s.input({ kind: 'text', data: ' ', t: 330 });
  const r = extract(s.state().words, { macros: ['th'] });
  assert.equal(r.records[1].reason, 'macro');
  assert.equal(r.records[1].macro, true);
  assert.equal(r.records[2].iki, 120);
});

test('a declared macro arriving as separate fast keystrokes is merged', () => {
  const r = run([['the', 'the ', [100, 4, 120, 100]]], { macros: ['th'] });
  assert.equal(r.records[1].reason, 'macro');
});

test('fast keystrokes that are not declared macros are never merged into one press', () => {
  const r = run([['the', 'the ', [100, 4, 120, 100]]]);
  assert.notEqual(r.records[1].reason, 'macro');
  assert.equal(r.records[1].iki, 4); // the raw interval is kept
  const slower = run([['the', 'the ', [100, 8, 120, 100]]]);
  assert.equal(slower.records[1].clean, true);
});

test('timing is normalised by population baselines', () => {
  const r = run([['abc', 'abc ', [300, 100, 100, 100]], ['def', 'def ', [200, 100, 100, 200]]]);
  assert.equal(r.baseline.within, 100);
  assert.equal(r.baseline.initial, 200);
  const d = r.records[4];
  assert.equal(d.ch, 'd');
  assert.equal(d.ratio, 1);
  const f = r.records[7], e = r.records[6];
  assert.ok(Math.abs(f.ratio / e.ratio - 2) < 1e-9); // twice as slow as its neighbour
  const kept = FT.stats.vjTrim([100, 100, 100, 100, 100, 200]);
  const gm = Math.exp(kept.reduce((a, x) => a + Math.log(x), 0) / kept.length);
  assert.ok(Math.abs(f.ratio - 200 / gm) < 1e-9); // against the geometric mean of the trimmed intervals
});

test('macro candidates are suggested but never merged automatically', () => {
  const words = [];
  for (let i = 0; i < 12; i++) words.push(['th', 'th ', [100, 5, 100]]);
  const r = run(words);
  const cand = FT.timing.macroCandidates([r]);
  assert.equal(cand[0].seq, 'th');
  assert.ok(cand[0].confidence > 0.9);
  assert.ok(r.records.filter((x) => x.ch === 'h').every((x) => x.reason !== 'macro'));
});

test('hesitation rate: clean keystrokes slower than twice their expected ratio', () => {
  const recs = [1, 1.5, 2.5, 3, 0.8].map((ratio, i) => ({ clean: true, ratio, ctx: '', ch: 'abcde'[i] }));
  recs.push({ clean: false, ratio: 9, ctx: '', ch: 'x' });
  assert.equal(FT.timing.hesitationRate(recs, () => 1), 2 / 5);
  assert.equal(FT.timing.hesitationRate(recs, (r) => (r.ch === 'd' ? 2 : 1)), 1 / 5);
  assert.equal(FT.timing.hesitationRate([], () => 1), null);
});

test('rhythm is the coefficient of variation of within-word intervals', () => {
  const recs = [100, 100, 100, 100].map((iki) => ({ clean: true, iki, wordInitial: false }));
  assert.equal(FT.timing.rhythmCv(recs), 0);
  recs.push({ clean: true, iki: 900, wordInitial: true }); // word starts are not part of rhythm
  assert.equal(FT.timing.rhythmCv(recs), 0);
  const v = FT.timing.rhythmCv([100, 200].map((iki) => ({ clean: true, iki, wordInitial: false })));
  assert.ok(Math.abs(v - Math.sqrt(5000) / 150) < 1e-9);
});

test('an automatic space that ends the last word of a text is not timed', () => {
  const s = FT.session.create(['ab', 'cd']);
  let t = 0;
  for (const ch of 'ab cd') s.input({ kind: 'text', data: ch, t: (t += 100) });
  s.input({ kind: 'text', data: ' ', t, auto: true });
  const w = s.state().words;
  assert.equal(w[1].committed, true);
  assert.equal(w[1].stream[w[1].stream.length - 1].auto, true);
  const r = extract(w);
  const last = r.records[r.records.length - 1];
  assert.equal(last.reason, 'auto');
  assert.equal(last.clean, false);
});

// Functionality: a stable fluency yardstick: median within-word time on a fixed
// set of very common letter pairs (stable on retest, Van Waes et al. 2021).
test('common-pair timing uses only the fixed pairs and clean keystrokes', () => {
  assert.equal(FT.timing.COMMON_PAIRS.length, 30);
  assert.equal(FT.timing.COMMON_PAIRS[0], 'th');
  const recs = [];
  for (let i = 0; i < 25; i++) recs.push({ clean: true, wordInitial: false, ctx: 'xt', ch: 'h', iki: 100 + i });  // "th"
  recs.push({ clean: true, wordInitial: false, ctx: 'zz', ch: 'q', iki: 900 });   // "zq": not a common pair
  recs.push({ clean: false, wordInitial: false, ctx: 'xt', ch: 'h', iki: 5000 }); // not clean
  assert.equal(FT.timing.commonPairStats(recs).ms, 112);
});

test('common-pair timing needs enough intervals', () => {
  const recs = Array.from({ length: 10 }, () => ({ clean: true, wordInitial: false, ctx: 'h', ch: 'e', iki: 100 }));
  assert.equal(FT.timing.commonPairStats(recs).ms, null);
});

// Functionality: extra time at the start of a word, beyond within-word timing
// (word-level planning; Crump et al. 2019): a proxy for effort, labelled as such.
test('word-start penalty is median word-initial minus median within-word interval', () => {
  const recs = [];
  for (let i = 0; i < 12; i++) recs.push({ clean: true, wordInitial: true, iki: 200 + i });
  for (let i = 0; i < 30; i++) recs.push({ clean: true, wordInitial: false, iki: 120 });
  recs.push({ clean: false, wordInitial: true, iki: 4000 });
  assert.equal(FT.timing.wordStartMs(recs), 85.5);
  assert.equal(FT.timing.wordStartMs(recs.slice(0, 3)), null);
});

test('common-pair statistics report how many intervals they rest on', () => {
  const recs = Array.from({ length: 25 }, () => ({ clean: true, wordInitial: false, ctx: 'h', ch: 'e', iki: 100 }));
  assert.deepEqual(plain(FT.timing.commonPairStats(recs)), { ms: 100, n: 25 });
});

// Functionality: letters a keyboard sends almost together (firmware, not
// fingers) are left out of timing. Design choice: under 6 ms; the user's
// keyboard puts firmware pairs at 1–5 ms and the fastest finger interval
// at 8.6 ms.
test('an undeclared pair arriving under 6 ms apart leaves both letters out of timing', () => {
  const r = run([['bead', 'bead ', [100, 150, 2, 150, 150]]]);
  const [, e, a, d] = r.records;
  assert.equal(e.clean, false); assert.equal(e.reason, 'simultaneous');
  assert.equal(a.clean, false); assert.equal(a.reason, 'simultaneous');
  assert.equal(d.clean, true);
});

test('a fast but human interval (12 ms) stays timed', () => {
  const r = run([['bead', 'bead ', [100, 150, 12, 150, 150]]]);
  assert.ok(r.records.slice(1).every((x) => x.clean));
});

test('a declared multi-letter key sent as two fast keystrokes stays a macro, its first letter timed', () => {
  const r = run([['the', 'the ', [100, 2, 150, 150]], ['ab', 'ab ', 150]], { macros: ['th'] });
  assert.equal(r.records[0].reason, 'first');
  assert.equal(r.records[1].reason, 'macro');
  const r2 = run([['ab', 'ab ', 150], ['the', 'the ', [150, 2, 150, 150]]], { macros: ['th'] });
  assert.equal(r2.records[3].clean, true);   // t
  assert.equal(r2.records[4].reason, 'macro'); // h
});

test('a u sent together with the next vowel (deferred qu key) leaves u and the vowel out of timing', () => {
  const r = run([['ab', 'ab ', 150], ['quest', 'quest ', [150, 247, 4, 150, 150, 150]]], { macros: ['qu'] });
  const q = r.records[3], u = r.records[4], e = r.records[5], s = r.records[6];
  assert.equal(q.clean, true);
  assert.equal(u.reason, 'simultaneous');
  assert.equal(e.reason, 'simultaneous');
  assert.equal(s.clean, true);
});

test('the session baseline ignores simultaneous pairs', () => {
  const r = run([['bead', 'bead ', [100, 100, 2, 200, 200]]]);
  assert.equal(r.baseline.within, 200); // e (100) and a (2) are left out
});

test('the auto-inserted space does not take the last letter out of timing', () => {
  const s = FT.session.create(['ab', 'cd']);
  [['a', 100], ['b', 300], [' ', 500], ['c', 700], ['d', 900]].forEach(([ch, t]) => s.input({ kind: 'text', data: ch, t }));
  s.input({ kind: 'text', data: ' ', t: 900, auto: true });
  const words = s.state().words.filter((w) => w.committed);
  const last = words[1].stream[words[1].stream.length - 1];
  if (!last.auto) { last.auto = true; } // the typing screen marks it
  const r = extract(words);
  const d = r.records.find((x) => x.ch === 'd');
  assert.equal(d.clean, true);
});

// Functionality: each population (word-initial, within-word) is centred on the
// log scale the model compares on: its mean log interval (geometric mean)
// maps to ratio 1. With medians, a population skewed differently was shifted
// (about 8% for one user's word starts), biasing every word-start sequence
// against its single-letter parent. Design choice (centring per session).
test('timing ratios are centred per population on the log scale', () => {
  // within-word intervals skewed right, word starts skewed left
  const within = [100, 100, 100, 100, 300], start = [300, 300, 300, 300, 100];
  const script = within.map((dt, i) => ['ab', 'ab ', [start[i], dt, 100]]);
  const r = run(script);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const clean = r.records.filter((x) => x.clean);
  // centred on the intervals that survive trimming
  for (const init of [true, false]) {
    const pop = clean.filter((x) => x.wordInitial === init);
    const kept = FT.stats.vjTrim(pop.map((x) => x.iki));
    const logs = pop.filter((x) => kept.includes(x.iki)).map((x) => x.logRatio);
    assert.ok(Math.abs(mean(logs)) < 1e-9, String(init));
  }
  clean.forEach((x) => assert.ok(Math.abs(x.ratio - Math.exp(x.logRatio)) < 1e-12));
});

test('the centre of a population is not pulled by an outlier interval', () => {
  const base = run([['abcdefgh', 'abcdefgh ', [100, 100, 110, 90, 100, 105, 95, 100, 100]]]);
  const withOutlier = run([['abcdefgh', 'abcdefgh ', [100, 100, 110, 90, 100, 105, 95, 100, 2500]]]);
  const b = base.records.find((x) => x.ch === 'c'), o = withOutlier.records.find((x) => x.ch === 'c');
  assert.ok(Math.abs(o.ratio / b.ratio - 1) < 0.02, o.ratio + ' vs ' + b.ratio);
});
