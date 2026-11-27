'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { near } = require('./helpers/assert');

// Functionality: the difficulty controller moves the vocabulary frontier only
// on credible relaxed-practice evidence, pooled across exercises. The error
// rate on the less common words is judged against the typist's own error rate
// on the 100 most common: at most 2x grows the vocabulary, more than 3x
// shrinks it. Hesitation, rhythm and perceived effort can hold an advance;
// there is no WPM floor. Every decision carries its reasons.

const FT = load();
const T = FT.difficulty.TUNING;
// First-try evidence, one [rank, chars, errors] per word: `words` words of 5
// characters at the given accuracy, or with the given error rate, the
// errors spread evenly. The easiest words have rank 50, the less common
// ones 150 unless said.
const perWord = (words, errors, rank) => Array.from({ length: words }, (_, i) =>
  [rank, 5, Math.floor((i + 1) * errors / words) - Math.floor(i * errors / words)]);
const atAccuracy = (rank) => (words, accuracy = 1) => perWord(words, Math.round(5 * words * (1 - accuracy)), rank);
const common = atAccuracy(50);
const commonRated = (words, errorRate) => common(words, 1 - errorRate);
const lessCommon = (words, accuracy = 1, rank = 150) => atAccuracy(rank)(words, accuracy);
const lessRated = (words, errorRate, rank = 150) => lessCommon(words, 1 - errorRate, rank);
const exercise = (o = {}) => Object.assign({ words: 1000, vocabulary: lessCommon(T.minWords, 0.995), easiest: common(T.easiestMinWords * 4, 0.99),
  hesitationRate: 0.05, rhythmCv: 0.3, effort: null, wpm: 40 }, o);
// The less common words with `ratio` times the errors of the easiest words,
// which come twice as many.
const errorsTimes = (ratio, words = 1000, easiestRate = 0.02, rank = 150) =>
  exercise({ vocabulary: lessRated(words, ratio * easiestRate, rank), easiest: commonRated(2 * words, easiestRate) });
// Half the less common words a decision needs.
const halfPool = (o = {}) => exercise(Object.assign({ vocabulary: lessCommon(T.minWords / 2, 0.995) }, o));
const controller = (frontier = 500, state = {}) => FT.difficulty.create(Object.assign({ frontier }, state));
const repeat = (d, n, ex) => { let r; for (let i = 0; i < n; i++) r = d.update(ex); return r; };

test('no decision until the vocabulary words reach the minimum', () => {
  const d = controller();
  const r = d.update(halfPool());
  assert.equal(r.action, 'wait');
  assert.match(r.reasons.join(), new RegExp(T.minWords / 2 + ' of the ' + T.minWords + ' words'));
  assert.equal(d.state().frontier, 500);
});

test('evidence pools across exercises until there is enough', () => {
  const d = controller();
  d.update(halfPool());
  const r = d.update(halfPool());
  assert.equal(r.action, 'advance');
  assert.equal(r.words, T.minWords);
});

// Design choice: after a step, the pooled words inside both the old and the
// new vocabulary stay, at half their weight, so a clear trend can step again
// soon.
test('an advance keeps the pooled words inside the old vocabulary, at half weight', () => {
  const d = controller();
  const inside = lessRated(600, 0.01, 300), beyond = lessRated(400, 0.01, 520);
  assert.equal(d.update(exercise({ vocabulary: inside.concat(beyond) })).action, 'advance');
  const r = d.update(exercise({ vocabulary: lessCommon(100, 0.995) }));
  assert.equal(r.words, 600 / 2 + 100);
  assert.equal(r.action, 'advance');
});

test('a retreat keeps the pooled words inside the new vocabulary, at half weight', () => {
  const d = controller();
  const ex = errorsTimes(3.5);
  ex.vocabulary = lessRated(600, 0.07, 300).concat(lessRated(400, 0.07, 480));
  assert.equal(d.update(ex).action, 'retreat');
  assert.equal(d.update(exercise({ vocabulary: lessCommon(0) })).words, 600 / 2);
});

test('the weight halves again at every step', () => {
  const d = controller();
  assert.equal(d.update(errorsTimes(1.2, 1200)).action, 'advance');
  assert.equal(d.update(errorsTimes(1.2, 0)).words, 1200 / 2);
  assert.equal(d.update(errorsTimes(1.2, 0)).words, 1200 / 4);
});

test('a hold keeps pooling, up to the most recent words the pool keeps', () => {
  const d = controller();
  assert.equal(d.update(errorsTimes(2.5, T.minWords)).action, 'hold');
  assert.equal(d.update(errorsTimes(2.5, T.minWords)).words, 2 * T.minWords);
  const r = repeat(d, 10, errorsTimes(2.5, T.minWords));
  assert.ok(r.words >= T.maxWords && r.words < T.maxWords + T.minWords, String(r.words));
});

test('less common words with 1.7x the errors of the easiest words advance, given enough words', () => {
  const d = controller();
  assert.equal(d.update(errorsTimes(1.7)).action, 'advance');
  const f = d.state().frontier;
  assert.ok(f > 500 && f < 600, String(f));
});

test('less common words with 1.7x the errors of the easiest words, on few words, hold', () => {
  assert.equal(controller().update(errorsTimes(1.7, T.minWords)).action, 'hold');
});

test('less common words with 3.5x the errors of the easiest words retreat', () => {
  const d = controller();
  assert.equal(d.update(errorsTimes(3.5)).action, 'retreat');
  assert.ok(d.state().frontier < 500);
});

test('less common words with 2.5x the errors of the easiest words hold', () => {
  const d = controller();
  assert.equal(d.update(errorsTimes(2.5)).action, 'hold');
  assert.equal(d.state().frontier, 500);
});

test('the ratio of the error rates decides, however high both are', () => {
  assert.equal(controller().update(errorsTimes(1.5, 1000, 0.05)).action, 'advance');
  assert.equal(controller().update(errorsTimes(1.5, 1000, 0.003)).action, 'hold'); // too few errors to be sure
});

// Two error rates near zero have no credible ratio, so a typist with almost no
// errors on the less common words grows on that alone.
test('less common words credibly under 0.5% errors advance, whatever the ratio', () => {
  assert.equal(controller().update(exercise({ vocabulary: lessCommon(1000), easiest: common(1000) })).action, 'advance');
  assert.equal(controller().update(exercise({ vocabulary: lessRated(1000, 0.002), easiest: common(1000) })).action, 'advance');
  assert.equal(controller().update(exercise({ vocabulary: lessRated(1000, 0.004), easiest: commonRated(1000, 0.002) })).action, 'hold');
});

test('the vocabulary never goes below the 200 most common words', () => {
  assert.equal(T.min, 200);
  assert.equal(controller(113).state().frontier, 200);
  const d = controller(210);
  assert.equal(d.update(errorsTimes(3.5)).action, 'retreat');
  const r = d.update(errorsTimes(3.5));
  assert.equal(r.action, 'hold');
  assert.match(r.reasons.join('; '), /never goes below 200 words/);
  assert.equal(d.state().frontier, 200);
});

test('without enough of the easiest words to compare with, the vocabulary waits', () => {
  const d = controller();
  const r = d.update(exercise({ easiest: common(T.easiestMinWords - 1, 0.99) }));
  assert.equal(r.action, 'wait');
  assert.match(r.reasons.join(), new RegExp((T.easiestMinWords - 1) + ' of the ' + T.easiestMinWords + ' words .*100 most common'));
  assert.equal(d.state().frontier, 500);
});

test('the easiest words pool across exercises and outlive a step, at half weight like the rest', () => {
  const d = controller();
  assert.equal(d.update(exercise({ easiest: common(100, 0.99) })).action, 'wait');
  assert.equal(d.update(exercise({ vocabulary: lessCommon(0), easiest: common(100, 0.99) })).action, 'advance');
  const r = d.update(exercise({ easiest: common(0) }));
  assert.equal(r.action, 'wait');
  assert.match(r.reasons[0], new RegExp('^100 of the ' + T.easiestMinWords + ' words'));
});

// Design choice: the reference is the easiest words of the very exercises
// pooled for the less common words, weighed alike, so a trend moves both
// alike and the ratio stays fair while the typist improves.
const holding = (errorRate, easiest = 600) => exercise({ vocabulary: lessRated(1000, 2.5 * errorRate), easiest: commonRated(easiest, errorRate) });
test('an improved typist is compared with their recent accuracy on the easiest words', () => {
  const d = controller();
  assert.equal(repeat(d, 3, holding(0.03)).action, 'hold');
  const r = d.update(holding(0.01));
  near(r.reference, 0.99, 1e-9); // the pool holds the latest exercise only
});

test('with few easiest words per exercise, the pool reaches back until it holds enough of them', () => {
  const d = controller();
  let r;
  for (let k = 0; k < 8; k++) r = d.update(holding(0.01 + 0.002 * k, 100));
  assert.equal(r.action, 'hold');
  assert.equal(r.words, 1000 * T.easiestKept / 100);
  near(r.reference, 1 - (8 + 9 + 10 + 11 + 12) / 2500, 1e-9);
});

test('the pool reaches back at most 50 exercises', () => {
  const d = controller();
  d.override(300);
  repeat(d, 60, exercise({ easiest: common(5) }));
  assert.equal(d.state().pool.length, T.maxExercises);
});

test('easiest words typed with a fixed vocabulary still count in the reference', () => {
  const d = controller();
  d.override(300);
  assert.equal(repeat(d, 3, exercise({ easiest: common(300, 0.996) })).action, 'manual');
  d.override(null);
  const r = d.update(exercise({ vocabulary: lessCommon(T.minWords, 0.995), easiest: [] }));
  near(r.reference, 0.996, 1e-9);
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

test('hesitation and rhythm since the last decision are weighed by each exercise\'s words', () => {
  const recently = { windows: [0.05, 0.05, 0.05].map((hes) => ({ hes, rhy: 0.3 })) };
  const d = controller(500, recently);
  d.update(exercise({ words: 260, vocabulary: lessCommon(250, 0.995), hesitationRate: 0.12, rhythmCv: 0.4 }));
  const r = d.update(exercise({ words: 1000, vocabulary: lessCommon(100, 0.995), hesitationRate: 0.05, rhythmCv: 0.3 }));
  assert.equal(r.action, 'advance', r.reasons.join('; ')); // 6.4% hesitation and a CV of 0.32 over all 1,260 words
});

test('high perceived effort holds advancement', () => {
  const r = controller().update(exercise({ effort: 4 }));
  assert.equal(r.action, 'hold');
  assert.ok(r.reasons.some((x) => /effort/.test(x)));
});

test('perceived effort counts from every exercise since the last decision', () => {
  const d = controller();
  d.update(halfPool({ effort: 5 }));
  assert.equal(d.update(halfPool({ effort: 2 })).action, 'hold');
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

// Functionality: the less common words belong to the vocabulary they were
// typed in, so fixing the vocabulary or releasing it starts their pool afresh.
test('fixing the vocabulary empties the pool of less common words', () => {
  const d = controller();
  d.update(halfPool({ effort: 5 }));
  d.override(800);
  d.override(null);
  const r = d.update(halfPool());
  assert.equal(r.action, 'wait');
  assert.match(r.reasons[0], new RegExp('^' + T.minWords / 2 + ' of the'));
  assert.equal(d.update(halfPool({ effort: 2 })).action, 'advance'); // not held by the effort before
});

test('releasing a fixed vocabulary empties the pool of less common words, keeping the easiest', () => {
  const d = FT.difficulty.create({ frontier: 800, manual: true, pool: [{ weight: 1, vocabulary: lessCommon(T.minWords / 2, 0.995), easiest: common(100) }] });
  d.override(null);
  assert.deepEqual(plain(d.state().pool.map((x) => [x.vocabulary.length, x.easiest.length])), [[0, 100]]);
});

test('releasing a vocabulary that is not fixed keeps the pool', () => {
  const d = controller();
  d.update(halfPool());
  d.override(null);
  assert.equal(d.update(halfPool()).words, T.minWords);
});

// Functionality: the reasons say in plain words what decided: how many times
// the errors of the easiest words the less common words have, and the band,
// with both accuracies to two decimals, so a step never reads as "98.5% below
// 98.5%".
test('the reasons compare the error rates, and both accuracies to two decimals', () => {
  const advance = controller().update(errorsTimes(1.7));
  assert.deepEqual(plain(advance.reasons), ['errors on the less common words: 1.7\u00d7 your easiest words (2\u00d7 or less grows the vocabulary)',
    'accuracy (first try) 96.60% on the less common words, 98.00% on the 100 most common']);
  const retreat = controller().update(errorsTimes(3.5));
  assert.equal(retreat.reasons[0], 'errors on the less common words: 3.5\u00d7 your easiest words (more than 3\u00d7 shrinks the vocabulary)');
  const hold = controller().update(errorsTimes(2.5));
  assert.equal(hold.reasons[0], 'errors on the less common words: 2.5\u00d7 your easiest words (not yet clearly 2\u00d7 or less, which grows the vocabulary, or more than 3\u00d7, which shrinks it)');
});

test('the reasons say when the easiest words had no errors', () => {
  const none = (vocabularyErrors) => controller().update(exercise({ vocabulary: lessCommon(300, 1 - vocabularyErrors / 1500), easiest: common(600) })).reasons[0];
  assert.equal(none(0), 'no errors on the less common words or on your easiest words (fewer than 0.5% errors on them grows the vocabulary)');
  assert.match(none(15), /^errors on the less common words, none on your easiest words \(/);
});

test('decisions are logged with reasons and survive serialisation', () => {
  const d = controller(200);
  d.update(exercise());
  const d2 = FT.difficulty.create(JSON.parse(JSON.stringify(d.toJSON())));
  const h = plain(d2.state().history);
  assert.equal(h.length, 1);
  assert.equal(h[0].action, 'advance');
  assert.match(h[0].reasons.join('; '), /grows the vocabulary/);
  assert.deepEqual(plain(d2.toJSON()), plain(d.toJSON()));
});

// Functionality: the controller's state is only what it learned; its tuning
// comes from the code, so a change of tuning reaches stored profiles.
test('the stored state holds what was learned, not the tuning', () => {
  const d = FT.difficulty.create({ frontier: 500, credible: 0.01, shrinkAbove: 10, windows: [], history: [] });
  assert.deepEqual(Object.keys(plain(d.toJSON())).sort(), ['frontier', 'history', 'manual', 'pending', 'pool', 'windows']);
  assert.equal(d.update(errorsTimes(2.5)).action, 'hold'); // the real band, not the stored one
});

test('an exercise without vocabulary words does not count as 0% accuracy', () => {
  const d = controller();
  assert.equal(d.update({ vocabulary: lessCommon(0), easiest: common(0) }).action, 'wait');
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
  assert.deepEqual(e.vocabulary, [[900, 6, 0]]);
  assert.deepEqual(e.easiest, []);
});

test('the unbiased words below rank 100 are the easiest words; the others are the vocabulary', () => {
  const e = evidenceOf([typed('the', 'random', 1), typed('and', 'frontier'), typed('house', 'random', 2), typed('window', 'frontier'), typed('the', 'target', 3)]);
  assert.deepEqual(e.easiest, [[0, 3, 1], [1, 3, 0]]);
  assert.deepEqual(e.vocabulary, [[150, 5, 2], [900, 6, 0]]);
});
