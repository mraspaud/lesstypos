'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { typist, typedWords, typeCorrectly, correctly, slipOnTh } = require('./helpers/typing');
const { near } = require('./helpers/assert');

// Functionality: a relaxed exercise end to end — words are generated, typed,
// analysed; the model, substitution statistics and difficulty are updated; a
// summary reports overall and unbiased-sample results; and replaying the raw
// sessions rebuilds exactly the same profile.

const FT = load();

// Simulated typist: types each word correctly at 120 ms/key, except (with err)
// substitutes 'n' for 'h' after 't', then corrects it. opts: { err, instant
// (characters whose key comes up at once), effort, type, dt }.
function simulate(trainer, nWords, t0, opts = {}) {
  const type = opts.type || 'relaxed';
  const ex = trainer.newExercise({ type });
  const s = FT.session.create(ex.words.slice(0, nWords));
  const keys = [];
  let t = t0;
  for (const w of s.state().words.slice(0, nWords)) {
    let prev = '';
    for (const ch of w.target + ' ') {
      t += opts.dt || 120;
      if (opts.err && ch === 'h' && prev === 't') {
        s.input({ kind: 'text', data: 'n', t }); t += 150;
        s.input({ kind: 'back', t }); t += 150;
      }
      s.input({ kind: 'text', data: ch, t });
      const hold = opts.instant && opts.instant.includes(ch) ? 0.5 : 150;
      keys.push({ k: 'd', c: 'Key' + ch, t }, { k: 'u', c: 'Key' + ch, t: t + hold });
      prev = ch;
    }
  }
  const words = s.state().words.filter((w) => w.committed);
  return trainer.finish({ type, startedAt: t0, durationMs: t - t0, words, keys, effort: opts.effort ?? null });
}

test('finishing an exercise yields a raw record and a summary', () => {
  const tr = FT.trainer.create({ seed: 1 });
  const { raw, summary } = simulate(tr, 60, Date.UTC(2026, 0, 1));
  assert.equal(raw.type, 'relaxed');
  assert.equal(raw.words.length, 60);
  assert.ok(raw.words.every((w) => w.meta && w.meta.source));
  assert.ok(summary.metrics.wpm > 0);
  assert.ok(summary.metrics.firstAttemptAccuracy === 1);
  assert.ok(summary.random && summary.random.words > 0 && summary.random.words < 60);
  assert.ok(summary.rollover > 0.5); // 150 ms holds vs 120 ms gaps overlap
});

test('weaknesses observed in exercises become training targets in later exercises', () => {
  const tr = FT.trainer.create({ seed: 2 });
  let day = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 6; i++) simulate(tr, 150, day + i * 3600e3, { err: true });
  const tg = tr.targets().map((x) => x.key);
  assert.ok(tg.some((k) => k.endsWith('th')), JSON.stringify(tg.slice(0, 5)));
  const ex = tr.newExercise({ type: 'relaxed' });
  assert.ok(ex.words.some((w) => w.source === 'target' && w.word.includes('th')));
});

test('difficulty decisions appear in the summary', () => {
  const tr = FT.trainer.create({ seed: 3 });
  const first = simulate(tr, 400, Date.UTC(2026, 0, 1)).summary;
  assert.equal(first.difficulty.action, 'wait');
  const { summary } = simulate(tr, 400, Date.UTC(2026, 0, 2));
  assert.equal(summary.difficulty.action, 'advance');
  assert.ok(summary.difficulty.reasons.length);
});

// Functionality: only relaxed practice's unbiased words decide the
// vocabulary; the carriers chosen for training targets never do.
test('slips in target carriers leave the vocabulary evidence untouched', () => {
  const tr = FT.trainer.create({ seed: 31 });
  const ex = tr.newExercise({ type: 'relaxed', pinned: ['ing'] });
  const targets = ex.words.slice(0, 300);
  const script = targets.map((w) => (w.source === 'target' ? 'x<' : '') + w.word + ' ').join('');
  const words = typedWords(FT, targets, script, { at: 100 });
  const { summary } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: 60000, words });
  assert.ok(summary.metrics.firstAttemptAccuracy < 0.99);
  const { pool, easiest } = plain(tr.difficulty.state());
  const lessCommon = pool.flatMap((x) => x.vocabulary), [easiestWords, , easiestErrors] = easiest[0];
  const unbiased = targets.filter((w) => w.source === 'random' || w.source === 'frontier').length;
  assert.equal(lessCommon.length + easiestWords, unbiased);
  assert.equal(lessCommon.reduce((n, w) => n + w[2], 0) + easiestErrors, 0);
});

test('rebuilding replays the vocabulary decisions exactly', () => {
  const tr = FT.trainer.create({ seed: 32 });
  const raws = [];
  for (let i = 0; i < 4; i++) raws.push(simulate(tr, 400, Date.UTC(2026, 0, 1) + i * 864e5, { err: i % 2 === 1 }).raw);
  assert.ok(tr.difficulty.state().history.some((h) => h.action !== 'wait'));
  const rebuilt = FT.trainer.rebuild(JSON.parse(JSON.stringify(raws)), { seed: 32 });
  assert.deepEqual(plain(rebuilt.profile().difficulty), plain(tr.profile().difficulty));
});

test('substitutions are recorded with context', () => {
  const tr = FT.trainer.create({ seed: 4 });
  for (let i = 0; i < 4; i++) simulate(tr, 150, Date.UTC(2026, 0, 1) + i * 1e6, { err: true });
  const top = tr.substitutions({ minOpp: 20 })[0];
  assert.equal(top.expected, 'h');
  assert.equal(top.actual, 'n');
});

test('the trainer confirms a slip pair once it recurs in a second session', () => {
  const tr = FT.trainer.create({ seed: 4 });
  const confirmed = () => plain(tr.confirmedPairs().map((r) => r.expected + r.actual));
  simulate(tr, 150, Date.UTC(2026, 0, 1), { err: true });
  assert.deepEqual(confirmed(), []);
  simulate(tr, 150, Date.UTC(2026, 0, 2), { err: true });
  assert.deepEqual(confirmed(), ['hn']);
});

test('the trainer reports premature slips apart', () => {
  const tr = FT.trainer.create({ seed: 4 });
  const s = FT.session.create(['sun', 'sun']);
  const t = typist(s, { at: 120, dt: 120 }).type('n<sun sun ').t;
  tr.finish({ type: 'relaxed', startedAt: 0, durationMs: t, words: s.state().words.filter((w) => w.committed), keys: [] });
  assert.deepEqual(plain(tr.prematureSlips({ minOpp: 1 }).map((r) => [r.expected, r.actual, r.count])), [['s', 'n', 1]]);
  assert.equal(tr.substitutions({ minOpp: 1 }).length, 0);
});

test('replaying raw sessions rebuilds the same profile', () => {
  const tr = FT.trainer.create({ seed: 5 });
  const raws = [];
  for (let i = 0; i < 3; i++) raws.push(simulate(tr, 120, Date.UTC(2026, 0, 1) + i * 864e5, { err: i === 1 }).raw);
  const rebuilt = FT.trainer.rebuild(JSON.parse(JSON.stringify(raws)), { seed: 5 });
  assert.deepEqual(plain(rebuilt.profile().model), plain(tr.profile().model));
  assert.deepEqual(plain(rebuilt.profile().difficulty.frontier), plain(tr.profile().difficulty.frontier));
});

test('a profile survives serialisation', () => {
  const tr = FT.trainer.create({ seed: 6 });
  simulate(tr, 100, Date.UTC(2026, 0, 1), { err: true });
  const tr2 = FT.trainer.create({ seed: 6, profile: JSON.parse(JSON.stringify(tr.profile())) });
  assert.deepEqual(plain(tr2.profile()), plain(tr.profile()));
});

test('a pinned-sequence exercise focuses on that sequence and does not move difficulty', () => {
  const tr = FT.trainer.create({ seed: 7 });
  const ex = tr.newExercise({ type: 'targeted', pinned: ['ing'] });
  const share = ex.words.filter((w) => w.target === 'ing').length / ex.words.length;
  assert.ok(share > 0.35, String(share));
  assert.ok(ex.words.every((w) => w.target == null || w.target === 'ing'));
  const { words, t } = typeCorrectly(FT, ex.words.slice(0, 160));
  const { summary } = tr.finish({ type: 'targeted', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words });
  assert.equal(summary.difficulty, null);
  assert.equal(tr.difficulty.state().frontier, 200);
});

test('profiles built by an older model version are rebuilt from raw sessions', () => {
  const fresh = FT.trainer.create({ seed: 8 }).profile();
  assert.equal(FT.trainer.needsRebuild(fresh), false);
  assert.equal(FT.trainer.needsRebuild(Object.assign({}, fresh, { modelVersion: undefined })), true);
  assert.equal(FT.trainer.needsRebuild(Object.assign({}, fresh, { modelVersion: FT.MODEL_VERSION - 1 })), true);
  assert.equal(FT.trainer.needsRebuild(null), false);
});

test('rebuild does not depend on the current accent setting: each raw session keeps its own', () => {
  const tr = FT.trainer.create({ seed: 12, settings: { accents: true } });
  const text = { id: 't', words: Array.from({ length: 40 }, (_, i) => (i % 2 ? 'café' : 'word')), pos: 0 };
  const ex = tr.newExercise({ type: 'prose', text });
  const s = FT.session.create(ex.words.slice(0, 30));
  let t = 0;
  for (const w of s.state().words.slice(0, 30)) for (const ch of w.target.replace('é', 'e') + ' ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { raw, summary } = tr.finish({ type: 'prose', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed), text: { id: 't', from: 0 } });
  assert.equal(summary.metrics.firstAttemptAccuracy, 1);
  assert.equal(raw.accents, true);
  const rebuilt = FT.trainer.rebuild([JSON.parse(JSON.stringify(raw))], { seed: 12, settings: { accents: false } });
  assert.equal(rebuilt.history()[0].firstAttemptAccuracy, 1);
});

test('a fixed vocabulary level survives a rebuild', () => {
  const tr = FT.trainer.create({ seed: 14 });
  tr.difficulty.override(2000);
  const ex = tr.newExercise({ type: 'relaxed' });
  const { words, t } = typeCorrectly(FT, ex.words.slice(0, 60));
  const { raw } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words });
  const rebuilt = FT.trainer.rebuild([raw], { seed: 14, previous: tr.profile() });
  assert.equal(rebuilt.difficulty.state().manual, true);
  assert.equal(rebuilt.difficulty.state().frontier, 2000);
});

// A programme run (or a standalone exercise) is one session for the
// sequence statistics: replication needs two runs, not two exercises.
function sloppyTh(tr, type, run, t0) {
  const s = FT.session.create(tr.newExercise({ type, run }).words.slice(0, 220));
  const t = typist(s, { at: t0 + 120, dt: 120 }).type(slipOnTh(correctly(s.state().words))).t;
  return tr.finish({ type, run, startedAt: t0, durationMs: t - t0, words: s.state().words.filter((w) => w.committed) });
}

test('exercises of one programme run count as one session', () => {
  const tr = FT.trainer.create({ seed: 15 });
  const day = Date.UTC(2026, 0, 1);
  sloppyTh(tr, 'warmup', 'run1', day);
  sloppyTh(tr, 'relaxed', 'run1', day + 6e5);
  const th = tr.evaluate().get('th');
  assert.equal(th.state, 'emerging');          // one run is one session: not yet confirmed
  const { raw } = sloppyTh(tr, 'relaxed', 'run2', day + 864e5);
  assert.equal(raw.run, 'run2');
  assert.equal(tr.evaluate().get('th').state, 'weak');
});

test('speed bursts do not advance the session clock', () => {
  const tr = FT.trainer.create({ seed: 16 });
  const before = tr.profile().sessionCount;
  const { words, t } = typeCorrectly(FT, tr.newExercise({ type: 'bursts' }).words.slice(0, 30), { dt: 80 });
  tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words, rounds: [{ start: 0, end: t }] });
  assert.equal(tr.profile().sessionCount, before);
});

test('replaying a mixed programme rebuilds exactly the same profile', () => {
  const tr = FT.trainer.create({ seed: 17 });
  const text = { id: 'book', words: Array.from({ length: 400 }, (_, i) => ['The', 'cat’s', 'well—known', 'café.'][i % 4]), pos: 0 };
  const raws = [];
  let t0 = Date.UTC(2026, 0, 1);
  for (const run of ['r1', 'r2']) {
    for (const type of ['warmup', 'relaxed', 'bursts', 'prose', 'targeted', 'benchmark']) {
      const ex = tr.newExercise({ type, run, text });
      const s = FT.session.create(ex.words.slice(0, 60));
      let t = t0;
      for (const w of s.state().words.slice(0, 60)) {
        for (const ch of w.target + ' ') {
          if (ch === 'e' && t % 7 === 0) { s.input({ kind: 'text', data: 'r', t: (t += 90) }); s.input({ kind: 'back', t: (t += 90) }); }
          s.input({ kind: 'text', data: ch, t: (t += 110 + (t % 37)) });
        }
      }
      const words = s.state().words.filter((w) => w.committed);
      const input = { type, run, startedAt: t0, durationMs: t - t0, words, effort: 2 };
      if (type === 'bursts') input.rounds = [{ start: t0, end: t0 + (t - t0) / 2 }, { start: t0 + (t - t0) / 2, end: t }];
      if (type === 'prose') { input.text = { id: 'book', from: text.pos }; }
      if (type === 'benchmark') { input.set = 'set-' + run; input.planMs = t - t0; }
      const { raw } = tr.finish(input);
      if (type === 'prose') text.pos = raw.text.to;
      raws.push(JSON.parse(JSON.stringify(raw)));
      t0 += 3600e3;
    }
    t0 += 864e5;
  }
  const rebuilt = FT.trainer.rebuild(raws, { seed: 17 });
  assert.deepEqual(plain(rebuilt.profile()), plain(tr.profile()));
});

test('history entries carry common-pair timing and the word-start penalty', () => {
  const tr = FT.trainer.create({ seed: 18 });
  const ex = tr.newExercise({ type: 'relaxed' });
  const s = FT.session.create(ex.words.slice(0, 150));
  let t = 0;
  for (const w of s.state().words.slice(0, 150)) for (const [k, ch] of Array.from(w.target + ' ').entries()) s.input({ kind: 'text', data: ch, t: (t += k === 0 ? 300 : 100) });
  tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  const h = tr.history()[0];
  assert.equal(h.commonPairMs, 100);
  assert.equal(h.wordStartMs, 200);
});

test('exercises record per-key statistics with the multi-letter keys they were typed with', () => {
  const tr = FT.trainer.create({ seed: 19, settings: { macros: ['th'] } });
  const s = FT.session.create(['the', 'then', 'art']);
  const t = typist(s, { at: 100 }).type('the tgen art ').t;
  const { summary } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  assert.deepEqual(plain(summary.keyStats.keys.th), [2, 1]);
  assert.deepEqual(plain(tr.history()[0].keyPresses.th), [2, 1]);
  assert.deepEqual(plain(tr.history()[0].wrongPressLandings), { g: 1 });
});

test('key statistics add up across history', () => {
  const total = plain(FT.progress.sumKeys([{ keyPresses: { a: [2, 1] }, wrongPressLandings: { x: 1 } }, { keyPresses: { a: [3, 0], b: [1, 1] } }, {}]));
  assert.deepEqual(total, { keys: { a: [5, 1], b: [1, 1] }, land: { x: 1 } });
});

test('an exercise counts a wrong th press as one error (multi-letter keys of the session)', () => {
  const tr = FT.trainer.create({ seed: 23, settings: { macros: ['th'] } });
  const s = FT.session.create(['you', 'are']);
  const t = typist(s, { at: 100 }).type('[th]ou are ').t;   // the th key, where y was meant
  const { summary } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  const m = summary.metrics;
  near(m.chars * (1 - m.firstAttemptAccuracy), 1, 1e-9, String(m.firstAttemptAccuracy));
});

// Functionality: keys the keyboard sends late reach the model (their
// single-key speed is not judged) and are left out of the rollover measure.
test('late keys found in the key log reach the model and leave the rollover measure', () => {
  const tr = FT.trainer.create({ seed: 3 });
  const { raw, summary } = simulate(tr, 80, Date.UTC(2026, 0, 1), { instant: ['e'] });
  assert.deepEqual(plain(summary.lateKeys), ['e']);
  assert.deepEqual(plain(tr.evaluate().late), ['e']);
  const without = FT.keyevents.rollover(raw.keys.filter((k) => k.c !== 'Keye'));
  assert.equal(summary.rollover, without);
  const re = FT.trainer.rebuild([raw]);
  assert.deepEqual(plain(re.evaluate().late), ['e']);
});

test('the trainer reports swapped letter pairs from its exercises', () => {
  const tr = FT.trainer.create({ seed: 4 });
  const s = FT.session.create(['people', 'people']);
  const t = typist(s, { at: 120, dt: 120 }).type('poe<<eople people ').t;
  tr.finish({ type: 'relaxed', startedAt: 0, durationMs: t, words: s.state().words.filter((w) => w.committed), keys: [] });
  const sw = tr.swaps({ minOpp: 1 });
  assert.equal(sw[0].expected, 'eo');
  assert.equal(sw[0].count, 1);
});

// Functionality: timestamps are stored at 0.01 ms (design choice: below the
// browsers' own timer coarsening), so stored sessions encode exactly.
test('finishing an exercise rounds its timestamps to 0.01 ms without touching the input', () => {
  const tr = FT.trainer.create({ seed: 5 });
  const stream = [{ k: 'c', ch: 'a', t: 100.123456, g: 1 }, { k: 'c', ch: 't', t: 250.987654, g: 2 }, { k: 'c', ch: ' ', t: 400.0000001, g: 3 }];
  const keys = [{ k: 'd', c: 'KeyA', t: 99.999999 }, { k: 'u', c: 'KeyA', t: 180.555555 }];
  const { raw } = tr.finish({ type: 'relaxed', startedAt: 0, durationMs: 500, words: [{ target: 'at', stream }], keys });
  assert.deepEqual(plain(raw.words[0].stream.map((e) => e.t)), [100.12, 250.99, 400]);
  assert.deepEqual(plain(raw.keys.map((e) => e.t)), [100, 180.56]);
  assert.equal(stream[0].t, 100.123456);
  assert.equal(keys[0].t, 99.999999);
});

// Functionality: a fixed vocabulary is part of what happened, so a rebuild
// from raw exercises reproduces periods when the user fixed it.
test('rebuilding reproduces a period of fixed vocabulary', () => {
  const tr = FT.trainer.create({ seed: 6 });
  const raws = [];
  tr.difficulty.override(2000);
  for (let i = 0; i < 3; i++) raws.push(simulate(tr, 80, Date.UTC(2026, 0, 1 + i)).raw);
  tr.difficulty.override(null);
  raws.push(simulate(tr, 80, Date.UTC(2026, 0, 5)).raw);
  const re = FT.trainer.rebuild(raws);
  assert.deepEqual(plain(re.history().map((h) => h.frontier)), plain(tr.history().map((h) => h.frontier)));
  assert.equal(re.difficulty.state().frontier, tr.difficulty.state().frontier);
  assert.equal(re.difficulty.state().manual, false);
});

// Functionality: every exercise gets fresh text, so repeating an exercise
// (or two exercises in one daily training) never shows the same words or
// the same random sample.
test('consecutive exercises get different words, also within one daily training', () => {
  const tr = FT.trainer.create({ seed: 8 });
  const words = (ex) => ex.words.slice(0, 40).map((w) => w.word).join(' ');
  assert.notEqual(words(tr.newExercise({ type: 'bursts' })), words(tr.newExercise({ type: 'bursts' })));
  const run = 'run-1';
  assert.notEqual(words(tr.newExercise({ type: 'relaxed', run })), words(tr.newExercise({ type: 'relaxed', run })));
  const randoms = (ex) => ex.words.filter((w) => w.source === 'random').slice(0, 10).map((w) => w.word).join(' ');
  assert.notEqual(randoms(tr.newExercise({ type: 'relaxed', run })), randoms(tr.newExercise({ type: 'targeted', run })));
});

test('a benchmark on a one-word corpus does not loop forever', () => {
  const tr = FT.trainer.create({ seed: 1, corpus: FT.corpus.fromList(['only']) });
  assert.ok(tr.newExercise({ type: 'benchmark' }).words.length > 0);
});

// Functionality: fixing or releasing the vocabulary is raw data too, an
// event with its time, so a rebuild applies each in order, also when no
// exercise came between them.
test('rebuilding applies fixing and releasing the vocabulary in order, also with no exercise between them', () => {
  const tr = FT.trainer.create({ seed: 32 });
  const raws = [simulate(tr, 400, Date.UTC(2026, 0, 1)).raw];
  assert.ok(tr.difficulty.state().pool.length);
  const events = [tr.setVocabulary(800, Date.UTC(2026, 0, 1, 12)), tr.setVocabulary(null, Date.UTC(2026, 0, 1, 13))];
  assert.deepEqual(plain(events), [{ at: Date.UTC(2026, 0, 1, 12), frontier: 800 }, { at: Date.UTC(2026, 0, 1, 13), frontier: null }]);
  raws.push(simulate(tr, 400, Date.UTC(2026, 0, 2)).raw);
  const rebuilt = FT.trainer.rebuild(JSON.parse(JSON.stringify(raws)), { seed: 32, vocabularyEvents: JSON.parse(JSON.stringify(events)) });
  assert.deepEqual(plain(rebuilt.profile().difficulty), plain(tr.profile().difficulty));
});

test('a vocabulary fixed after the last exercise is fixed after a rebuild', () => {
  const tr = FT.trainer.create({ seed: 33 });
  const { raw } = simulate(tr, 60, Date.UTC(2026, 0, 1));
  const event = tr.setVocabulary(1500, Date.UTC(2026, 0, 2));
  const rebuilt = FT.trainer.rebuild([raw], { vocabularyEvents: [event] });
  assert.equal(rebuilt.difficulty.state().manual, true);
  assert.equal(rebuilt.difficulty.state().frontier, 1500);
});

test('rebuilding keeps the profile language', () => {
  const tr = FT.trainer.create({ seed: 1, lang: 'en' });
  const { raw } = simulate(tr, 30, Date.UTC(2026, 0, 1));
  assert.equal(FT.trainer.rebuild([raw], { previous: tr.profile() }).profile().lang, 'en');
  assert.equal(FT.trainer.rebuild([Object.assign({}, raw, { lang: 'fr' })], { corpus: FT.corpus.fromList(['le', 'la']) }).profile().lang, 'fr');
});

test('rebuilding restores the stored vocabulary choice, fixed or released', () => {
  const tr = FT.trainer.create({ seed: 9 });
  tr.difficulty.override(1500);
  const { raw } = simulate(tr, 60, Date.UTC(2026, 0, 1));
  tr.difficulty.override(null);
  assert.equal(FT.trainer.rebuild([raw], { previous: tr.profile() }).difficulty.state().manual, false);
});

test('a rebuild takes its language from the earliest exercise', () => {
  const tr = FT.trainer.create({ seed: 1 });
  const a = simulate(tr, 30, Date.UTC(2026, 0, 2)).raw, b = simulate(tr, 30, Date.UTC(2026, 0, 1)).raw;
  const fr = Object.assign({}, b, { lang: 'fr' });
  const re = FT.trainer.rebuild([a, fr], { previous: { lang: 'sv' }, corpus: FT.corpus.fromList(['le', 'la']) });
  assert.equal(re.profile().lang, 'fr');
});

// Functionality: an exercise is recorded (with its identity) when it ends and
// processed when rated, so saving it again cannot make a second copy.
test('recording then processing equals finishing, with the identity fixed at recording', () => {
  const a = FT.trainer.create({ seed: 11 }), b = FT.trainer.create({ seed: 11 });
  const input = { type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: 1000, words: [], keys: [] };
  const raw = a.record(Object.assign({ id: 'fixed' }, input));
  assert.equal(raw.id, 'fixed');
  raw.effort = 2;
  const viaRecord = a.process(raw);
  const viaFinish = b.finish(Object.assign({ id: 'fixed', effort: 2 }, input)).summary;
  assert.deepEqual(plain(viaRecord), plain(viaFinish));
});

// Functionality: a past exercise's summary can be shown again, rebuilt from
// its raw record, without changing anything learned.
const shownAgain = (s) => plain({ metrics: s.metrics, timeline: s.timeline, keyStats: s.keyStats, hesitationRate: s.hesitationRate,
  rhythmCv: s.rhythmCv, rollover: s.rollover, difficulty: s.difficulty, frontier: s.frontier, rounds: s.rounds, random: s.random });

test('a past exercise summarised again shows what its summary showed, including that day’s vocabulary decision', () => {
  const tr = FT.trainer.create({ seed: 4 });
  const day = Date.UTC(2026, 0, 1);
  const first = simulate(tr, 160, day);
  for (let i = 1; i < 4; i++) simulate(tr, 160, day + i * 3600e3, { err: true });   // the profile moves on
  const again = tr.summarize(first.raw);
  assert.deepEqual(shownAgain(again), shownAgain(first.summary));
  assert.ok(again.difficulty);
});

test('summarising a past exercise changes nothing learned', () => {
  const tr = FT.trainer.create({ seed: 5 });
  const { raw } = simulate(tr, 120, Date.UTC(2026, 0, 1), { err: true });
  const before = JSON.stringify(tr.profile());
  tr.summarize(JSON.parse(JSON.stringify(raw)));
  assert.equal(JSON.stringify(tr.profile()), before);
});

test('a past speed-bursts summary shows its rounds and targets', () => {
  const tr = FT.trainer.create({ seed: 6 });
  const { words, t } = typeCorrectly(FT, tr.newExercise({ type: 'bursts' }).words.slice(0, 40), { dt: 90 });
  const done = tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words,
    rounds: [{ start: 0, end: t / 2 }, { start: t / 2, end: t }] });
  assert.equal(done.summary.rounds.length, 2);
  assert.deepEqual(shownAgain(tr.summarize(done.raw)).rounds, plain(done.summary.rounds));
});

// Functionality: the experimental fluency index (FT.fluency) is computed as
// training goes, from earlier exercises only, so a rebuild reproduces it.
const HOUR = 3600e3, DAY0 = Date.UTC(2026, 0, 1);
const practiseRelaxed = (tr, count, opts = {}, from = 0) => {
  for (let i = 0; i < count; i++) simulate(tr, 60, DAY0 + (from + i) * HOUR, opts);
  return tr.history();
};

test('history entries keep the pace per population, the time corrections took and the errors', () => {
  const tr = FT.trainer.create({ seed: 30 });
  const { raw } = simulate(tr, 60, DAY0, { err: true }), h = tr.history()[0];
  const slips = raw.words.reduce((n, w) => n + (w.target.match(/th/g) || []).length, 0);
  assert.ok(slips > 0);
  near(h.paceMs.within, 120, 1e-6);
  near(h.paceMs.initial, 120, 1e-6);
  near(h.correctionMs, 300 * slips, 1e-6);                      // each: n, 150 ms to erase it, 150 ms to retype h
  assert.equal(h.errors, slips);
});

test('history entries keep the time pauses over 5 s took and the presses', () => {
  const tr = FT.trainer.create({ seed: 30 });
  const { raw } = simulate(tr, 60, DAY0), h = tr.history()[0];
  const presses = raw.words.reduce((n, w) => n + w.target.length + 1, 0);
  assert.equal(h.presses, presses);
  const paused = Object.assign({}, raw, { id: 'paused', durationMs: raw.durationMs + 8000 });
  paused.words = raw.words.map((w, i) => (i < 30 ? w : Object.assign({}, w, { stream: w.stream.map((k) => Object.assign({}, k, { t: k.t + 8000 })) })));
  tr.process(paused);
  near(tr.history()[1].pauseMs - h.pauseMs, 8000, 1e-6);         // 8,120 ms where 120 is the clean pace
});

// Model on the pace before the session: the spread between contexts is in
// the model's ratios, and the pace takes it out (FT.fluency.pace).
test('the pace is measured against the model as it stood before the exercise', () => {
  const tr = FT.trainer.create({ seed: 37 });
  simulate(tr, 60, DAY0);
  const { raw } = simulate(tr, 60, DAY0 + HOUR), h = tr.history()[1];
  const fresh = FT.trainer.create({ seed: 37 });
  simulate(fresh, 60, DAY0);
  const evaluation = fresh.model.evaluate({ day: raw.day });
  const records = FT.timing.extract(raw.words, FT.align.analyzeWords(raw.words, { macros: raw.macros })).records;
  const expected = FT.fluency.pace(records, (r) => { const c = FT.model.timedContext(evaluation, r.ctx + r.ch, fresh.model.config.minN); return c ? Math.exp(c.mu) : 1; });
  assert.deepEqual(plain(h.paceMs), plain(expected));
});

test('the index takes the declared multi-letter keys of the latest exercise as one press', () => {
  const tr = FT.trainer.create({ seed: 36, settings: { macros: ['th'] } });
  let raw;
  for (let i = 0; i < 3; i++) raw = simulate(tr, 60, DAY0 + i * HOUR).raw;
  const predictOn = (macros) => FT.fluency.index(tr.model.evaluate({ day: raw.day }), tr.history(), FT.fluency.reference(tr.corpus, macros), { minN: tr.model.config.minN }).wpm;
  assert.equal(tr.history()[2].fluencyWpm, predictOn(['th']));
  assert.ok(predictOn(['th']) > predictOn([]));
});

test('exercises get the fluency index once 3 relaxed exercises set its scale', () => {
  const tr = FT.trainer.create({ seed: 31 });
  const h = practiseRelaxed(tr, 3, { effort: 3 });
  assert.equal(h[1].fluencyWpm, undefined);
  assert.ok(h[2].fluencyWpm > 0 && h[2].fluencyCoverage >= 0 && h[2].fluencyCoverage <= 1, JSON.stringify(h[2]));
  simulate(tr, 60, DAY0 + 3 * HOUR, { type: 'warmup' });
  assert.ok(tr.history()[3].fluencyWpm > 0);
});

test('effortless speed is missing until 3 relaxed exercises are rated effort 1 or 2', () => {
  const tr = FT.trainer.create({ seed: 32 });
  practiseRelaxed(tr, 3, { effort: 4 });
  const h = practiseRelaxed(tr, 3, { effort: 2 }, 3);
  assert.ok(h[2].fluencyWpm > 0);
  assert.equal(h[4].effortlessWpm, undefined);
  assert.ok(h[5].effortlessWpm > 0);
});

test('a benchmark trial gets the prediction made before it, whatever its typing', () => {
  const trials = [90, 200].map((dt) => {
    const tr = FT.trainer.create({ seed: 33 });
    practiseRelaxed(tr, 3, { effort: 2 });
    simulate(tr, 60, DAY0 + 3 * HOUR, { type: 'benchmark', dt });
    return tr.history();
  });
  const [fast, slow] = trials.map((h) => h[3]);
  assert.equal(fast.type, 'benchmark');
  assert.ok(fast.fluencyWpm > 0 && fast.effortlessWpm > 0);
  assert.deepEqual([fast.fluencyWpm, fast.effortlessWpm, fast.fluencyCoverage], [slow.fluencyWpm, slow.effortlessWpm, slow.fluencyCoverage]);
  assert.equal(fast.fluencyWpm, trials[0][2].fluencyWpm);
});

test('a benchmark trial’s prediction rests only on the exercises before it', () => {
  const tr = FT.trainer.create({ seed: 33 }), at = DAY0 + 3 * HOUR;
  practiseRelaxed(tr, 3, { effort: 2 });
  const before = FT.fluency.index(tr.model.evaluate({ day: FT.days.number(at) }), tr.history().slice(), FT.fluency.reference(tr.corpus, []), { minN: tr.model.config.minN });
  simulate(tr, 60, at, { type: 'benchmark' });
  const trial = tr.history()[3];
  assert.deepEqual([trial.fluencyWpm, trial.effortlessWpm, trial.fluencyCoverage], [before.wpm, before.effortlessWpm, before.coverage]);
});

test('a benchmark before any relaxed practice gets no fluency index', () => {
  const tr = FT.trainer.create({ seed: 38 });
  simulate(tr, 60, DAY0, { type: 'benchmark' });
  const trial = tr.history()[0];
  assert.deepEqual([trial.fluencyWpm, trial.effortlessWpm, trial.fluencyCoverage], [undefined, undefined, undefined]);
});

test('the index records the multi-letter keys it was typed with', () => {
  const tr = FT.trainer.create({ seed: 36, settings: { macros: ['th'] } });
  practiseRelaxed(tr, 3);
  assert.deepEqual(plain(tr.history()[2].fluencyKeys), ['th']);
  const plainKeys = FT.trainer.create({ seed: 36 });
  assert.equal(practiseRelaxed(plainKeys, 3)[2].fluencyKeys, undefined);
});

test('speed bursts get no fluency index: they never feed the sequence model', () => {
  const tr = FT.trainer.create({ seed: 34 });
  practiseRelaxed(tr, 3);
  simulate(tr, 60, DAY0 + 3 * HOUR, { type: 'bursts' });
  assert.equal(tr.history()[3].fluencyWpm, undefined);
});

test('a rebuild reproduces the fluency index', () => {
  const tr = FT.trainer.create({ seed: 35 });
  const raws = [];
  for (let i = 0; i < 4; i++) raws.push(simulate(tr, 80, DAY0 + i * 864e5, { err: i === 1, effort: 2 }).raw);
  raws.push(simulate(tr, 60, DAY0 + 4 * 864e5, { type: 'benchmark' }).raw);
  const fields = (h) => h.map((e) => [e.paceMs, e.correctionMs, e.errors, e.pauseMs, e.presses, e.fluencyWpm, e.effortlessWpm, e.fluencyCoverage]);
  const rebuilt = FT.trainer.rebuild(JSON.parse(JSON.stringify(raws)), { seed: 35 });
  assert.ok(tr.history()[4].fluencyWpm > 0);
  assert.deepEqual(plain(fields(rebuilt.history())), plain(fields(tr.history())));
});
