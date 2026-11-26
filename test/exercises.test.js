'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: each exercise type draws its words from the right source.
const FT = load();

function typeAll(items, t0 = 0) {
  const s = FT.session.create(items);
  let t = t0;
  for (const w of s.state().words) for (const ch of w.target + ' ') s.input({ kind: 'text', data: ch, t: (t += 110) });
  return { words: s.state().words.filter((w) => w.committed), t };
}

test('warm-up uses familiar words below the current vocabulary frontier', () => {
  const tr = FT.trainer.create({ seed: 1 });
  tr.difficulty.override(1000); tr.difficulty.override(null);
  const ex = tr.newExercise({ type: 'warmup' });
  const ranks = ex.words.map((w) => tr.corpus.rankOf(w.word));
  assert.ok(Math.max(...ranks) < 1000, String(Math.max(...ranks)));
  assert.ok(ex.words.every((w) => !w.target));
});

test('speed bursts use familiar words', () => {
  const tr = FT.trainer.create({ seed: 2 });
  tr.difficulty.override(1000); tr.difficulty.override(null);
  const ranks = tr.newExercise({ type: 'bursts' }).words.map((w) => tr.corpus.rankOf(w.word));
  assert.ok(Math.max(...ranks) < 1000);
});

test('targeted practice is denser in training sequences than relaxed practice', () => {
  const tr = FT.trainer.create({ seed: 3 });
  // two sessions with errors on "h" after "t" so "th" becomes a training target
  for (let i = 0; i < 2; i++) {
    const ex = tr.newExercise({ type: 'relaxed' });
    const s = FT.session.create(ex.words.slice(0, 200));
    let t = i * 1e7;
    for (const w of s.state().words.slice(0, 200)) {
      let prev = '';
      for (const ch of w.target + ' ') {
        if (ch === 'h' && prev === 't') { s.input({ kind: 'text', data: 'n', t: (t += 120) }); s.input({ kind: 'back', t: (t += 150) }); }
        s.input({ kind: 'text', data: ch, t: (t += 120) }); prev = ch;
      }
    }
    tr.finish({ type: 'relaxed', startedAt: Date.UTC(2026, 0, 1) + i * 864e5, durationMs: 1, words: s.state().words.filter((w) => w.committed) });
  }
  const share = (type) => { const w = tr.newExercise({ type }).words; return w.filter((x) => x.source === 'target').length / w.length; };
  assert.ok(share('targeted') > share('relaxed') + 0.1);
});

test('targeted practice without any training target says so', () => {
  const tr = FT.trainer.create({ seed: 4 });
  assert.equal(tr.newExercise({ type: 'targeted' }).noTargets, true);
});

test('prose continues from the saved position and more() follows on', () => {
  const tr = FT.trainer.create({ seed: 5 });
  const text = { id: 't1', words: ['It', 'was', 'the', 'best', 'of', 'times,', 'it', 'was', 'the', 'worst'], pos: 3 };
  const ex = tr.newExercise({ type: 'prose', text, batch: 4 });
  assert.deepEqual(plain(ex.words.map((w) => w.word)), ['best', 'of', 'times,', 'it']);
  assert.ok(ex.words.every((w) => w.source === 'prose'));
  assert.deepEqual(plain(ex.more(10).map((w) => w.word)), ['was', 'the', 'worst']);
});

test('a finished prose exercise records how far the text advanced', () => {
  const tr = FT.trainer.create({ seed: 6 });
  const text = { id: 't1', words: 'one two three four five six seven eight nine ten eleven twelve'.split(' '), pos: 2 };
  const ex = tr.newExercise({ type: 'prose', text });
  const { words, t } = typeAll(ex.words.slice(0, 5));
  const { raw } = tr.finish({ type: 'prose', startedAt: Date.UTC(2026, 0, 1), durationMs: t, words, text: { id: 't1', from: 2 } });
  assert.deepEqual(plain(raw.text), { id: 't1', from: 2, to: 7 });
});

test('only relaxed practice changes vocabulary difficulty', () => {
  for (const type of ['warmup', 'targeted', 'bursts', 'prose']) {
    const tr = FT.trainer.create({ seed: 7 });
    const text = { id: 'x', words: Array(300).fill('word'), pos: 0 };
    const ex = tr.newExercise({ type, text });
    const { words, t } = typeAll(ex.words.slice(0, 160));
    const { summary } = tr.finish({ type, startedAt: Date.UTC(2026, 0, 1), durationMs: t, words });
    assert.equal(summary.difficulty, null, type);
    assert.equal(tr.difficulty.state().frontier, 200, type);
  }
});

// Functionality: the benchmark is a pure yardstick (user decision): common
// words, unbiased, never changing statistics, difficulty or targets.
function finishTyped(tr, type, extra = {}) {
  const ex = tr.newExercise({ type });
  const s = FT.session.create(ex.words.slice(0, 120));
  let t = 0;
  for (const w of s.state().words.slice(0, 120)) {
    let prev = '';
    for (const ch of w.target + ' ') {
      if (ch === 'h' && prev === 't') { s.input({ kind: 'text', data: 'x', t: (t += 100) }); s.input({ kind: 'back', t: (t += 100) }); }
      s.input({ kind: 'text', data: ch, t: (t += 100) }); prev = ch;
    }
  }
  return tr.finish(Object.assign({ type, startedAt: Date.UTC(2026, 0, 1), durationMs: t, words: s.state().words.filter((w) => w.committed) }, extra));
}

test('benchmark words are unbiased common words', () => {
  const tr = FT.trainer.create({ seed: 20 });
  const ex = tr.newExercise({ type: 'benchmark' });
  assert.ok(ex.words.every((w) => tr.corpus.rankOf(w.word) < 5000 && w.source === 'benchmark' && !w.target));
  assert.ok(Math.max(...ex.words.map((w) => tr.corpus.rankOf(w.word))) > 1000); // not limited to the frontier
});

test('a benchmark changes no statistics, difficulty or targets', () => {
  const tr = FT.trainer.create({ seed: 21 });
  const before = JSON.stringify({ m: tr.profile().model, s: tr.profile().subs, d: tr.profile().difficulty });
  const { summary, raw } = finishTyped(tr, 'benchmark', { set: 'b1' });
  assert.equal(raw.set, 'b1');
  assert.equal(summary.difficulty, null);
  assert.equal(JSON.stringify({ m: tr.profile().model, s: tr.profile().subs, d: tr.profile().difficulty }), before);
  assert.equal(tr.history()[0].type, 'benchmark');
  assert.equal(tr.history()[0].benchmarkSet, 'b1');
});

test('a benchmark set is scored by the median of its trials', () => {
  const h = [
    { type: 'benchmark', benchmarkSet: 'b1', wpm: 60, firstAttemptAccuracy: 0.97, startedAt: 1 },
    { type: 'benchmark', benchmarkSet: 'b1', wpm: 70, firstAttemptAccuracy: 0.99, startedAt: 2 },
    { type: 'benchmark', benchmarkSet: 'b1', wpm: 64, firstAttemptAccuracy: 0.98, startedAt: 3 },
    { type: 'relaxed', wpm: 99, firstAttemptAccuracy: 1, startedAt: 4 },
  ];
  assert.deepEqual(plain(FT.progress.benchmarkResult(h, 'b1')), { set: 'b1', trials: 3, wpm: 64, firstAttemptAccuracy: 0.98, min: 60, max: 70, startedAt: 1 });
});

test('restarting a benchmark gives a fresh sample', () => {
  const tr = FT.trainer.create({ seed: 22 });
  const a = tr.newExercise({ type: 'benchmark' }).words.slice(0, 20).map((w) => w.word).join(' ');
  const b = tr.newExercise({ type: 'benchmark' }).words.slice(0, 20).map((w) => w.word).join(' ');
  assert.notEqual(a, b);
});
