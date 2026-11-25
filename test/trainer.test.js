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
      keys.push({ k: 'd', c: 'Key' + ch, t }, { k: 'u', c: 'Key' + ch, t: t + 150 });
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
