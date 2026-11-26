'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./helpers/load');
const { near } = require('./helpers/assert');
const { typist } = require('./helpers/typing');

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
// A scale: ms per keystroke at ratio 1 in both populations, and ms per error.
const evenly = (ms, errorCostMs = 0) => ({ within: ms, initial: ms, errorCostMs });
const AB = FT.fluency.referenceOf(['ab', 'ab']);           // keystrokes: a b space a b space
const LETTERS = { a: {}, b: {}, ' ': {} };
const withLetters = (contexts) => judged(Object.assign({}, LETTERS, contexts));
const wpmOf = (keystrokes, totalMs) => keystrokes / 5 / (totalMs / 60000);

test('typing every context at the centre, without errors, a keystroke takes the scale: 12,000 / scale WPM', () => {
  assert.equal(FT.fluency.predict(withLetters({}), evenly(200), AB).wpm, 12000 / 200);
});

test('word-initial keystrokes take the word-initial scale', () => {
  const p = FT.fluency.predict(withLetters({}), { within: 100, initial: 400, errorCostMs: 0 }, AB);
  near(p.wpm, wpmOf(6, 2 * 400 + 4 * 100));
});

test('a slower context lowers the predicted speed by its share of the time', () => {
  const p = FT.fluency.predict(withLetters({ b: { mu: Math.log(2) } }), evenly(200), AB);
  near(p.wpm, wpmOf(6, 4 * 200 + 2 * 400));
});

const erring = (errorRate) => judged({ a: { errorRate }, b: { errorRate }, ' ': { errorRate } });

test('each error costs the measured time of a correction', () => {
  near(FT.fluency.predict(erring(0.1), evenly(200, 1000), AB).wpm, wpmOf(6, 6 * (200 + 0.1 * 1000)));
});

test('doubling the error rate doubles the time errors cost', () => {
  near(FT.fluency.predict(erring(0.2), evenly(200, 1000), AB).wpm, wpmOf(6, 6 * (200 + 0.2 * 1000)));
});

test('a context with too few timed keystrokes falls back to its parent', () => {
  const sparse = FT.fluency.predict(withLetters({ b: { mu: Math.log(2) }, ab: { mu: Math.log(4), latN: 3 } }), evenly(200), AB);
  assert.equal(sparse.wpm, FT.fluency.predict(withLetters({ b: { mu: Math.log(2) } }), evenly(200), AB).wpm);
});

test('a keystroke with no timed context takes the centre and the overall error rate', () => {
  const p = FT.fluency.predict(judged({}, 0.1), evenly(200, 1000), AB);
  near(p.wpm, wpmOf(6, 6 * 300));
  assert.equal(p.coverage, 0);
});

test('coverage is the share of keystrokes timed from a context of two characters or more', () => {
  assert.equal(FT.fluency.predict(withLetters({ ab: {} }), evenly(200), AB).coverage, 2 / 6);
});

// A declared multi-letter key (such as th) is one press: its later letters
// come with the first (FT.presses.ofTarget), as when typing.
const THE = (macros) => FT.fluency.referenceOf(['the', 'the'], macros);   // t h e space, twice
const withThe = judged({ t: {}, h: {}, e: {}, ' ': {}, th: {} });

test('the later letters of a declared multi-letter key take no time', () => {
  assert.equal(FT.fluency.predict(withThe, evenly(200), THE()).wpm, wpmOf(8, 8 * 200));
  assert.equal(FT.fluency.predict(withThe, evenly(200), THE(['th'])).wpm, wpmOf(8, 6 * 200));
});

test('the later letters of a declared key are not part of the coverage', () => {
  assert.equal(FT.fluency.predict(withThe, evenly(200), THE(['th'])).coverage, 0);
});

test('the reference text of a corpus marks the declared keys it is given', () => {
  const corpus = FT.corpus.get('en'), keyed = FT.fluency.reference(corpus, ['th']);
  assert.equal(keyed.words, FT.fluency.reference(corpus).words);
  assert.ok(keyed.keystrokes.some((k) => k.sameKey) && !FT.fluency.reference(corpus).keystrokes.some((k) => k.sameKey));
  assert.equal(FT.fluency.reference(corpus, ['th']), keyed);
});

// History entries of relaxed practice with their mean clean intervals (ms).
const relaxed = (within, initial, more = {}) => Object.assign({ type: 'relaxed', words: 100, wpm: 50, effort: 3, meanMs: { within, initial }, errorCostMs: null }, more);

test('the scale is the arithmetic mean of the mean intervals of the last 5 relaxed exercises', () => {
  const history = [relaxed(999, 999), relaxed(100, 200), relaxed(400, 800), relaxed(100, 200), relaxed(400, 800), relaxed(200, 400)];
  const s = FT.fluency.scale(history);
  near(s.within, 240);
  near(s.initial, 480);
});

test('the cost of an error is the mean of those exercises’ measured costs', () => {
  const history = [relaxed(100, 100, { errorCostMs: 5000 }), relaxed(100, 100, { errorCostMs: 800 }),
    relaxed(100, 100, { errorCostMs: 1200 }), relaxed(100, 100, { errorCostMs: null }), relaxed(100, 100), relaxed(100, 100)];
  near(FT.fluency.scale(history).errorCostMs, 1000);
});

test('errors cost nothing in a scale whose exercises had none', () => {
  assert.equal(FT.fluency.scale([relaxed(100, 100), relaxed(100, 100), relaxed(100, 100)]).errorCostMs, 0);
});

test('the scale leaves out other exercise types and exercises under 50 words', () => {
  const history = [relaxed(200, 400), relaxed(200, 400), relaxed(200, 400),
    relaxed(50, 50, { type: 'warmup' }), relaxed(50, 50, { words: 49 }), relaxed(50, 50, { meanMs: undefined })];
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

// Sanity check, in sample: a model and a scale built from a typist's
// exercises predict the speed of the very text the typist typed last. Out of
// sample, only the benchmark check can tell (FT.progress.fluencyCheck).
// The simulated typist: each pair of letters has its own pace (90-210 ms),
// which varies from keystroke to keystroke; words start 80 ms later; th is
// one declared key; about 3% of the other letters slip, and the slip is
// noticed after 350 ms, erased and retyped 200 ms later, with the next
// keystroke 250 ms slower (post-error slowing).
const DAY = 864e5, DAY0 = Date.UTC(2026, 0, 1), TH = ['th'];
function simulatedTypist(seed) {
  const rng = FT.rng(seed), noise = () => (rng() + rng() + rng() - 1.5) * 2;   // mean 0, sd 1
  const pace = (a, b) => 90 + ((a.charCodeAt(0) * 31 + b.charCodeAt(0) * 17) % 121) + (a === ' ' ? 80 : 0);
  const SLIP = 0.03, NOTICE_MS = 350, RETYPE_MS = 200, SLOWER_MS = 250;
  // The presses (test/helpers/typing.js notation) and the gap before each.
  return function type(targets) {
    const text = targets.map((w) => w + ' ').join(''), gaps = [];
    let notation = '', prev = ' ', slowed = 0;
    for (let i = 0; i < text.length; i++) {
      const gap = pace(prev, text[i]) * Math.exp(0.25 * noise()) + slowed;
      slowed = 0;
      if (text.startsWith('th', i)) { notation += '[th]'; gaps.push(gap); prev = 'h'; i++; continue; }
      if (text[i] !== ' ' && rng() < SLIP) {
        notation += (text[i] === 'q' ? 'z' : 'q') + '<' + text[i]; gaps.push(gap, NOTICE_MS, RETYPE_MS); slowed = SLOWER_MS;
      } else { notation += text[i]; gaps.push(gap); }
      prev = text[i];
    }
    return { notation, gaps };
  };
}
function practise(trainer, typeText, day) {
  const session = FT.session.create(trainer.newExercise({ type: 'relaxed' }).words.slice(0, 150), { macros: TH });
  const { notation, gaps } = typeText(session.state().words.map((w) => w.target));
  const hands = typist(session, { at: gaps[0] }).type(notation, gaps);
  const words = session.state().words.filter((w) => w.committed);
  return trainer.finish({ type: 'relaxed', startedAt: DAY0 + day * DAY, durationMs: hands.t, words, effort: 2 });
}

test('in sample, the index predicts the speed of the very text it was built from to within 5%', () => {
  const tr = FT.trainer.create({ seed: 40, settings: { macros: TH } }), typeText = simulatedTypist(7);
  let last;
  for (let day = 0; day < 5; day++) last = practise(tr, typeText, day);
  const typed = tr.history().at(-1);
  assert.ok(typed.firstAttemptAccuracy < 0.99 && typed.errorCostMs > 500, JSON.stringify(typed));   // errors with real costs
  const text = FT.fluency.referenceOf(last.raw.words.map((w) => w.target), last.raw.macros);
  const predicted = FT.fluency.index(tr.model.evaluate({ day: last.raw.day }), tr.history(), text, { minN: tr.model.config.minN }).wpm;
  assert.ok(Math.abs(predicted / typed.wpm - 1) < 0.05, 'predicted ' + predicted + ' WPM, measured ' + typed.wpm);
});
