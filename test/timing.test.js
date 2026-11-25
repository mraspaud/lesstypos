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
