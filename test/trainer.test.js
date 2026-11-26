'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: a relaxed exercise end to end — words are generated, typed,
// analysed; the model, substitution statistics and difficulty are updated; a
// summary reports overall and unbiased-sample results; and replaying the raw
// sessions rebuilds exactly the same profile.

const FT = load();

// Simulated typist: types each word correctly at 120 ms/key, except (with err)
// substitutes 'n' for 'h' after 't', then corrects it.
function simulate(trainer, nWords, t0, opts = {}) {
  const ex = trainer.newExercise({ type: 'relaxed' });
  const s = FT.session.create(ex.words.slice(0, nWords));
  const keys = [];
  let t = t0;
  for (const w of s.state().words.slice(0, nWords)) {
    let prev = '';
    for (const ch of w.target + ' ') {
      t += 120;
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
  return trainer.finish({ type: 'relaxed', startedAt: t0, durationMs: t - t0, words, keys, effort: opts.effort ?? null });
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
  const { summary } = simulate(tr, 160, Date.UTC(2026, 0, 1));
  assert.equal(summary.difficulty.action, 'advance');
  assert.ok(summary.difficulty.reasons.length);
});

test('substitutions are recorded with context', () => {
  const tr = FT.trainer.create({ seed: 4 });
  for (let i = 0; i < 4; i++) simulate(tr, 150, Date.UTC(2026, 0, 1) + i * 1e6, { err: true });
  const top = tr.substitutions({ minOpp: 20 })[0];
  assert.equal(top.expected, 'h');
  assert.equal(top.actual, 'n');
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
  const s = FT.session.create(ex.words.slice(0, 160));
  let t = 0;
  for (const w of s.state().words.slice(0, 160)) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { summary } = tr.finish({ type: 'targeted', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
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
  FT.text.setOptions({ accents: true });
  const tr = FT.trainer.create({ seed: 12 });
  const text = { id: 't', words: Array.from({ length: 40 }, (_, i) => (i % 2 ? 'café' : 'word')), pos: 0 };
  const ex = tr.newExercise({ type: 'prose', text });
  const s = FT.session.create(ex.words.slice(0, 30));
  let t = 0;
  for (const w of s.state().words.slice(0, 30)) for (const ch of w.target.replace('é', 'e') + ' ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { raw, summary } = tr.finish({ type: 'prose', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed), text: { id: 't', from: 0 } });
  assert.equal(summary.metrics.firstAttemptAccuracy, 1);
  assert.equal(raw.accents, true);
  FT.text.setOptions({ accents: false });
  try {
    const rebuilt = FT.trainer.rebuild([JSON.parse(JSON.stringify(raw))], { seed: 12 });
    assert.equal(rebuilt.history()[0].faa, 1);
  } finally { FT.text.setOptions({ accents: true }); }
});

test('a fixed vocabulary level survives a rebuild', () => {
  const tr = FT.trainer.create({ seed: 14 });
  tr.difficulty.override(2000);
  const ex = tr.newExercise({ type: 'relaxed' });
  const s = FT.session.create(ex.words.slice(0, 60));
  let t = 0;
  for (const w of s.state().words.slice(0, 60)) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { raw } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  const rebuilt = FT.trainer.rebuild([raw], { seed: 14, previous: tr.profile() });
  assert.equal(rebuilt.difficulty.state().manual, true);
  assert.equal(rebuilt.difficulty.state().frontier, 2000);
});

// A programme run (or a standalone exercise) is one session for the
// sequence statistics: replication needs two runs, not two exercises.
function sloppyTh(tr, type, run, t0) {
  const ex = tr.newExercise({ type, run });
  const s = FT.session.create(ex.words.slice(0, 220));
  let t = t0;
  for (const w of s.state().words.slice(0, 220)) {
    let prev = '';
    for (const ch of w.target + ' ') {
      if (ch === 'h' && prev === 't') { s.input({ kind: 'text', data: 'n', t: (t += 120) }); s.input({ kind: 'back', t: (t += 150) }); }
      s.input({ kind: 'text', data: ch, t: (t += 120) }); prev = ch;
    }
  }
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
  const s = FT.session.create(tr.newExercise({ type: 'bursts' }).words.slice(0, 30));
  let t = 0;
  for (const w of s.state().words.slice(0, 30)) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 80) });
  tr.finish({ type: 'bursts', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed), rounds: [{ start: 0, end: t }] });
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
  assert.equal(h.pairMs, 100);
  assert.equal(h.startMs, 200);
});

test('exercises record per-key statistics with the multi-letter keys they were typed with', () => {
  const tr = FT.trainer.create({ seed: 19, settings: { macros: ['th'] } });
  const s = FT.session.create(['the', 'then', 'art']);
  let t = 0;
  for (const ch of 'the tgen art ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { summary } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  assert.deepEqual(plain(summary.keyStats.keys.th), [2, 1]);
  assert.deepEqual(plain(tr.history()[0].keys.th), [2, 1]);
  assert.deepEqual(plain(tr.history()[0].land), { g: 1 });
});

test('key statistics add up across history', () => {
  const total = plain(FT.progress.sumKeys([{ keys: { a: [2, 1] }, land: { x: 1 } }, { keys: { a: [3, 0], b: [1, 1] } }, {}]));
  assert.deepEqual(total, { keys: { a: [5, 1], b: [1, 1] }, land: { x: 1 } });
});

test('profiles from before the progress fields are rebuilt (model version 4)', () => {
  assert.ok(FT.MODEL_VERSION >= 4);
  assert.equal(FT.trainer.needsRebuild({ modelVersion: 3 }), true);
});

test('an exercise counts a wrong th press as one error (multi-letter keys of the session)', () => {
  const tr = FT.trainer.create({ seed: 23, settings: { macros: ['th'] } });
  const s = FT.session.create(['you', 'are']);
  let t = 0;
  s.input({ kind: 'text', data: 'th', t: (t += 100) });            // the th key, where y was meant
  for (const ch of 'ou are ') s.input({ kind: 'text', data: ch, t: (t += 100) });
  const { summary } = tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) });
  const m = summary.metrics;
  assert.ok(Math.abs(m.chars * (1 - m.firstAttemptAccuracy) - 1) < 1e-9, String(m.firstAttemptAccuracy));
  assert.ok(FT.MODEL_VERSION >= 5);
});

// Functionality: keys the keyboard sends late reach the model (their
// single-key speed is not judged) and are left out of the rollover measure.
test('late keys found in the key log reach the model and leave the rollover measure', () => {
  const tr = FT.trainer.create({ seed: 3 });
  const { raw, summary } = simulate(tr, 80, Date.UTC(2026, 0, 1), { instant: ['e'] });
  assert.deepEqual(plain(summary.lateKeys), ['e']);
  assert.deepEqual(plain(tr.evaluate().late), ['e']);
  const without = FT.timing.rollover(raw.keys.filter((k) => k.c !== 'Keye'));
  assert.equal(summary.rollover, without);
  const re = FT.trainer.rebuild([raw]);
  assert.deepEqual(plain(re.evaluate().late), ['e']);
});

test('the trainer reports swapped letter pairs from its exercises', () => {
  const tr = FT.trainer.create({ seed: 4 });
  const s = FT.session.create(['people', 'people']);
  let t = 0;
  for (const ch of 'poe<<eople people ') { t += 120; s.input(ch === '<' ? { kind: 'back', t } : { kind: 'text', data: ch, t }); }
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
