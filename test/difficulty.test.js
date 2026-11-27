'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: the difficulty controller moves the vocabulary frontier only
// on credible relaxed-practice evidence, pooled across exercises. Accuracy on
// the less common words is judged against the typist's own accuracy on the
// 100 most common; hesitation, rhythm and perceived effort can hold an
// advance; there is no WPM floor. Every decision carries its reasons.

const FT = load();
const T = FT.difficulty.TUNING;
// First-try evidence: `words` words of 5 characters at the given accuracy.
const tally = (words, accuracy = 1) => ({ words, chars: 5 * words, errors: Math.round(5 * words * (1 - accuracy)) });
const exercise = (o = {}) => Object.assign({ vocabulary: tally(T.minWords, 0.995), easiest: tally(T.easiestMinWords * 4, 0.99),
  hesitationRate: 0.05, rhythmCv: 0.3, effort: null, wpm: 40 }, o);
const asGood = (accuracy, words = 1000) => exercise({ vocabulary: tally(words, accuracy), easiest: tally(words, accuracy) });
const lower = (points, words = 1000) => exercise({ vocabulary: tally(words, 0.99 - points / 100), easiest: tally(words, 0.99) });
const controller = (frontier = 500, state = {}) => FT.difficulty.create(Object.assign({ frontier }, state));
const repeat = (d, n, ex) => { let r; for (let i = 0; i < n; i++) r = d.update(ex); return r; };

test('no decision until the vocabulary words reach the minimum', () => {
  const d = controller();
  const r = d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995) }));
  assert.equal(r.action, 'wait');
  assert.match(r.reasons.join(), new RegExp(T.minWords / 2 + ' of the ' + T.minWords + ' words'));
  assert.equal(d.state().frontier, 500);
});

test('evidence pools across exercises until there is enough', () => {
  const d = controller();
  d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995) }));
  const r = d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995) }));
  assert.equal(r.action, 'advance');
  assert.equal(r.words, T.minWords);
});

test('a step starts a new pool: evidence from the old vocabulary does not decide the new one', () => {
  const d = controller();
  assert.equal(d.update(exercise()).action, 'advance');
  assert.equal(d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995) })).action, 'wait');
});

test('a hold keeps pooling, up to the most recent words the pool keeps', () => {
  const d = controller();
  assert.equal(d.update(lower(1, T.minWords)).action, 'hold');
  assert.equal(d.update(lower(1, T.minWords)).words, 2 * T.minWords);
  const r = repeat(d, 10, lower(1, T.minWords));
  assert.ok(r.words >= T.maxWords && r.words < T.maxWords + T.minWords, String(r.words));
});

test('accuracy as good as on the easiest words advances, however low both are', () => {
  const d = controller();
  assert.equal(d.update(asGood(0.982)).action, 'advance');
  const f = d.state().frontier;
  assert.ok(f > 500 && f < 600, String(f));
});

test('accuracy credibly more than 1.5 points below the easiest words retreats', () => {
  const d = controller();
  assert.equal(d.update(lower(3)).action, 'retreat');
  assert.ok(d.state().frontier < 500);
});

test('accuracy credibly between the two bounds holds', () => {
  const d = controller();
  assert.equal(d.update(lower(1)).action, 'hold');
  assert.equal(d.state().frontier, 500);
});

test('noise around a bound does not step', () => {
  for (const bound of [T.advanceWithin, T.retreatBelow]) {
    const d = controller();
    for (let i = 0; i < 8; i++) {
      const r = d.update(lower(100 * bound + (i % 2 ? 0.3 : -0.3), T.minWords));
      assert.equal(r.action, 'hold', 'bound ' + bound + ', exercise ' + i + ': ' + r.reasons.join('; '));
    }
    assert.equal(d.state().frontier, 500);
  }
});

test('the vocabulary never goes below the 200 most common words', () => {
  assert.equal(T.min, 200);
  assert.equal(controller(113).state().frontier, 200);
  const d = controller(210);
  assert.equal(d.update(lower(3)).action, 'retreat');
  const r = d.update(lower(3));
  assert.equal(r.action, 'hold');
  assert.match(r.reasons.join('; '), /never goes below 200 words/);
  assert.equal(d.state().frontier, 200);
});

test('without enough of the easiest words to compare with, the vocabulary waits', () => {
  const d = controller();
  const r = d.update(exercise({ easiest: tally(T.easiestMinWords - 1, 0.99) }));
  assert.equal(r.action, 'wait');
  assert.match(r.reasons.join(), new RegExp((T.easiestMinWords - 1) + ' of the ' + T.easiestMinWords + ' words .*100 most common'));
  assert.equal(d.state().frontier, 500);
});

test('the easiest words pool across exercises and outlive a step', () => {
  const d = controller();
  const half = tally(T.easiestMinWords / 2, 0.99);
  assert.equal(d.update(exercise({ easiest: half })).action, 'wait');
  assert.equal(d.update(exercise({ vocabulary: tally(0), easiest: half })).action, 'advance');
  assert.equal(d.update(exercise({ easiest: tally(0) })).action, 'advance');
});

test('the easiest words kept are the most recent, up to a maximum', () => {
  const d = controller();
  repeat(d, 10, exercise({ easiest: tally(T.easiestMinWords, 0.9) }));
  const r = d.update(exercise({ easiest: tally(T.easiestMaxWords, 0.995) }));
  assert.ok(r.reference > 0.99, String(r.reference)); // the old 90% words are gone
});

test('high accuracy with worse hesitation than recently holds', () => {
  const d = controller(500, { windows: [0.05, 0.05, 0.05].map((hes) => ({ hes, rhy: 0.3 })) });
  const r = d.update(exercise({ hesitationRate: 0.12 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /hesitation/.test(x)));
});

test('high accuracy with less even rhythm than recently holds', () => {
  const d = controller(500, { windows: [0.3, 0.3, 0.3].map((rhy) => ({ hes: 0.05, rhy })) });
  const r = d.update(exercise({ rhythmCv: 0.5 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /rhythm/.test(x)));
});

test('high perceived effort holds advancement', () => {
  const r = controller().update(exercise({ effort: 4 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /effort/.test(x)));
});

test('perceived effort counts from every exercise since the last decision', () => {
  const d = controller();
  d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995), effort: 5 }));
  assert.equal(d.update(exercise({ vocabulary: tally(T.minWords / 2, 0.995), effort: 2 })).action, 'hold');
  assert.equal(d.update(exercise({ effort: 2 })).action, 'advance');
});

test('speed is never a criterion', () => {
  assert.equal(controller().update(exercise({ wpm: 12 })).action, 'advance');
});

test('the frontier stays below the size of the word list', () => {
  const d = FT.difficulty.create({ frontier: 950 }, { max: 1000 });
  assert.equal(d.update(exercise()).action, 'advance');
  assert.equal(d.state().frontier, 1000);
  assert.equal(d.update(exercise()).action, 'hold');
  d.override(5000);
  assert.equal(d.state().frontier, 1000);
});

test('a fixed vocabulary is respected until released', () => {
  const d = controller(300);
  d.override(800);
  assert.equal(d.state().manual, true);
  assert.equal(d.update(exercise()).action, 'manual');
  assert.equal(d.state().frontier, 800);
  d.override(null);
  assert.equal(d.state().manual, false);
});

// Functionality: the reasons say in plain words what decided, with both
// accuracies to two decimals, so a step never reads as "98.5% below 98.5%".
test('the reasons compare both accuracies, to two decimals', () => {
  const advance = controller().update(exercise({ vocabulary: tally(1000, 0.9958), easiest: tally(1000, 0.9944) }));
  assert.equal(advance.reasons[0], 'accuracy (first try) 99.58% on the less common words, close to your 99.44% on the 100 most common');
  const retreat = controller().update(lower(3));
  assert.equal(retreat.reasons[0], 'accuracy (first try) 96.00% on the less common words, clearly below your 99.00% on the 100 most common');
  const hold = controller().update(lower(1));
  assert.equal(hold.reasons[0], 'accuracy (first try) 98.00% on the less common words against 99.00% on the 100 most common, not yet clear enough to change');
});

test('decisions are logged with reasons and survive serialisation', () => {
  const d = controller(200);
  d.update(exercise());
  const d2 = FT.difficulty.create(JSON.parse(JSON.stringify(d.toJSON())));
  const h = plain(d2.state().history);
  assert.equal(h.length, 1);
  assert.equal(h[0].action, 'advance');
  assert.match(h[0].reasons.join('; '), /close to your/);
  assert.deepEqual(plain(d2.toJSON()), plain(d.toJSON()));
});

// Functionality: the controller's state is only what it learned; its tuning
// comes from the code, so a change of tuning reaches stored profiles.
test('the stored state holds what was learned, not the tuning', () => {
  const d = FT.difficulty.create({ frontier: 500, credible: 0.01, retreatBelow: 0.5, windows: [], history: [] });
  assert.deepEqual(Object.keys(plain(d.toJSON())).sort(), ['easiest', 'frontier', 'history', 'manual', 'pending', 'pool', 'windows']);
  assert.equal(d.update(lower(1)).action, 'hold'); // the real band, not the stored one
});

test('an exercise without vocabulary words does not count as 0% accuracy', () => {
  const d = controller();
  assert.equal(d.update({ vocabulary: tally(0), easiest: tally(0) }).action, 'wait');
  assert.equal(d.update({ words: 200 }).action, 'wait');
  assert.equal(d.state().frontier, 500);
});

// Functionality: the evidence for the vocabulary comes from relaxed
// practice's unbiased words only (the random sample and the frontier words),
// split into the easiest words (the reference) and the rest. Carriers chosen
// for training targets never count.
const typed = (target, source, errors = 0) => ({
  word: { target, meta: { source } },
  analysis: { targets: Array.from(target, (_, i) => ({ err: i < errors ? 1 : 0 })) },
});
const ranks = { the: 0, and: 1, house: 150, window: 900 };
const evidenceOf = (list) => plain(FT.difficulty.evidence(list.map((x) => x.word), list.map((x) => x.analysis), (w) => (w in ranks ? ranks[w] : -1)));

test('target and maintenance carriers never count as vocabulary evidence', () => {
  const e = evidenceOf([typed('window', 'target', 3), typed('house', 'maintenance', 2), typed('window', 'frontier')]);
  assert.deepEqual(e.vocabulary, { words: 1, chars: 6, errors: 0 });
  assert.deepEqual(e.easiest, { words: 0, chars: 0, errors: 0 });
});

test('the unbiased words below rank 100 are the easiest words; the others are the vocabulary', () => {
  const e = evidenceOf([typed('the', 'random', 1), typed('and', 'frontier'), typed('house', 'random', 2), typed('window', 'frontier'), typed('the', 'target', 3)]);
  assert.deepEqual(e.easiest, { words: 2, chars: 6, errors: 1 });
  assert.deepEqual(e.vocabulary, { words: 2, chars: 11, errors: 2 });
});
