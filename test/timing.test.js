'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: per-character timing records with cleaning and normalisation.
// IKI = gap between successive keydowns. Cleaning: >5 s is a pause (Dhakal et
// al. 2018); only correct keystrokes following a correct keystroke with no
// edits in between are timed (Behmer & Crump 2017; post-error slowing,
// Salthouse 1986). Word-initial transitions form their own population.

const FT = load();

// Build committed words from a typing script: [[target, typedScript, dt]...]
function run(script, opts) {
  const s = FT.session.create(script.map((x) => x[0]));
  let t = 0;
  for (const [, typed, dts] of script) {
    Array.from(typed).forEach((ch, i) => {
      t += Array.isArray(dts) ? dts[i] : dts;
      if (ch === '<') s.input({ kind: 'back', t });
      else s.input({ kind: 'text', data: ch, t });
    });
  }
  return FT.timing.extract(s.state().words.filter((w) => w.committed), opts);
}

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
  const r = FT.timing.extract(s.state().words, { macros: ['th'] });
  assert.equal(r.records[1].reason, 'macro');
  assert.equal(r.records[1].macro, true);
  assert.equal(r.records[2].iki, 120);
});

test('a declared macro arriving as separate fast keystrokes is merged', () => {
  const r = run([['the', 'the ', [100, 4, 120, 100]]], { macros: ['th'] });
  assert.equal(r.records[1].reason, 'macro');
});

test('fast keystrokes that are not declared macros keep their timing', () => {
  const r = run([['the', 'the ', [100, 4, 120, 100]]]);
  assert.equal(r.records[1].clean, true);
  assert.equal(r.records[1].iki, 4);
});

test('timing is normalised by population baselines', () => {
  const r = run([['abc', 'abc ', [300, 100, 100, 100]], ['def', 'def ', [200, 100, 100, 200]]]);
  assert.equal(r.baseline.within, 100);
  assert.equal(r.baseline.initial, 200);
  const d = r.records[4];
  assert.equal(d.ch, 'd');
  assert.equal(d.ratio, 1);
  const f = r.records[7];
  assert.equal(f.ratio, 2);
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
  const r = FT.timing.extract(w);
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
  assert.equal(FT.timing.commonPairMs(recs), 112);
});

test('common-pair timing needs enough intervals', () => {
  const recs = Array.from({ length: 10 }, () => ({ clean: true, wordInitial: false, ctx: 'h', ch: 'e', iki: 100 }));
  assert.equal(FT.timing.commonPairMs(recs), null);
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
