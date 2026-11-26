'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./helpers/load');
const { near } = require('./helpers/assert');

// Functionality: an experimental fluency index (design choice), the relaxed
// speed that the sequence statistics predict on a fixed reference text.

const FT = load();

// The reference text never changes silently: a change of the word list or of
// the benchmark's sampling shows here, and old predictions would then no
// longer compare with new ones.
test('the reference text is 1,000 frozen words drawn like the benchmark’s', () => {
  const corpus = FT.corpus.get('en'), reference = FT.fluency.reference(corpus);
  assert.equal(reference.words.length, 1000);
  assert.ok(reference.words.every((w) => corpus.rankOf(w) >= 0 && corpus.rankOf(w) < 5000));
  const checksum = crypto.createHash('sha256').update(reference.words.join(' ')).digest('hex');
  assert.equal(checksum, '666d7dbcba4201f856eebf53c8df7ee6827193d2d3fbd04d401d37950a66b5a3');
  assert.equal(FT.fluency.reference(corpus), reference);
});

// An evaluation as FT.judgement.evaluate gives it, for the contexts listed
// (key -> { mu, latN, errorRate }); every other context is unseen.
function judged(contexts, globalRate = 0) {
  const all = {};
  for (const [key, c] of Object.entries(contexts)) all[key] = Object.assign({ key, order: key.length, mu: 0, latN: 100, errorRate: 0 }, c);
  return { get: (k) => all[k], all, global: { rate: globalRate } };
}
const evenly = (ms) => ({ within: ms, initial: ms });
const AB = FT.fluency.referenceOf(['ab', 'ab']);           // keystrokes: a b space a b space
const LETTERS = { a: {}, b: {}, ' ': {} };
const withLetters = (contexts) => judged(Object.assign({}, LETTERS, contexts));
const wpmOf = (keystrokes, totalMs) => keystrokes / 5 / (totalMs / 60000);

test('typing every context at the centre, without errors, predicts 12,000 / scale WPM', () => {
  assert.equal(FT.fluency.predict(withLetters({}), evenly(200), AB).wpm, 12000 / 200);
});

test('word-initial keystrokes take the word-initial scale', () => {
  const p = FT.fluency.predict(withLetters({}), { within: 100, initial: 400 }, AB);
  near(p.wpm, wpmOf(6, 2 * 400 + 4 * 100));
});

test('a slower context lowers the predicted speed by its share of the time', () => {
  const p = FT.fluency.predict(withLetters({ b: { mu: Math.log(2) } }), evenly(200), AB);
  near(p.wpm, wpmOf(6, 4 * 200 + 2 * 400));
});

test('each error costs two keystrokes more, the slip and its backspace', () => {
  const rate = { errorRate: 0.1 };
  const p = FT.fluency.predict(judged({ a: rate, b: rate, ' ': rate }), evenly(200), AB);
  near(p.wpm, 60 / 1.2);
});

test('a context with too few timed keystrokes falls back to its parent', () => {
  const sparse = FT.fluency.predict(withLetters({ b: { mu: Math.log(2) }, ab: { mu: Math.log(4), latN: 3 } }), evenly(200), AB);
  assert.equal(sparse.wpm, FT.fluency.predict(withLetters({ b: { mu: Math.log(2) } }), evenly(200), AB).wpm);
});

test('a keystroke with no timed context takes the centre and the overall error rate', () => {
  const p = FT.fluency.predict(judged({}, 0.1), evenly(200), AB);
  near(p.wpm, 60 / 1.2);
  assert.equal(p.coverage, 0);
});

test('coverage is the share of keystrokes timed from a context of two characters or more', () => {
  assert.equal(FT.fluency.predict(withLetters({ ab: {} }), evenly(200), AB).coverage, 2 / 6);
});

// History entries of relaxed practice with their centres (ms).
const relaxed = (within, initial, more = {}) => Object.assign({ type: 'relaxed', words: 100, wpm: 50, effort: 3, centreMs: { within, initial } }, more);

test('the scale is the geometric mean of the centres of the last 5 relaxed exercises', () => {
  const history = [relaxed(999, 999), relaxed(100, 200), relaxed(400, 800), relaxed(100, 200), relaxed(400, 800), relaxed(200, 400)];
  const s = FT.fluency.scale(history);
  near(s.within, 200);
  near(s.initial, 400);
});

test('the scale leaves out other exercise types and exercises under 50 words', () => {
  const history = [relaxed(200, 400), relaxed(200, 400), relaxed(200, 400),
    relaxed(50, 50, { type: 'warmup' }), relaxed(50, 50, { words: 49 }), relaxed(50, 50, { centreMs: undefined })];
  near(FT.fluency.scale(history).within, 200);
});

test('there is no scale before 3 such exercises', () => {
  assert.equal(FT.fluency.scale([relaxed(200, 400), relaxed(200, 400)]), null);
});

test('the effortless scale takes only exercises rated effort 1 or 2', () => {
  const history = [relaxed(100, 100, { effort: 1 }), relaxed(100, 100, { effort: 2 }), relaxed(900, 900, { effort: 3 }), relaxed(100, 100, { effort: null })];
  assert.equal(FT.fluency.scale(history, FT.fluency.effortless), null);
  near(FT.fluency.scale(history.concat(relaxed(100, 100, { effort: 2 })), FT.fluency.effortless).within, 100);
});
