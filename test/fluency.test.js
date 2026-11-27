'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load, plain } = require('./helpers/load');
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
// A scale: ms per keystroke at ratio 1 in both populations, ms per error and
// ms of pauses per press.
const evenly = (ms, errorCostMs = 0, pauseMs = 0) => ({ within: ms, initial: ms, errorCostMs, pauseMs });
const AB = FT.fluency.referenceOf(['ab', 'ab']);           // keystrokes: a b space a b space
const LETTERS = { a: {}, b: {}, ' ': {} };
const withLetters = (contexts) => judged(Object.assign({}, LETTERS, contexts));
const wpmOf = (keystrokes, totalMs) => keystrokes / 5 / (totalMs / 60000);

test('typing every context at the centre, without errors, a keystroke takes the scale: 12,000 / scale WPM', () => {
  assert.equal(FT.fluency.predict(withLetters({}), evenly(200), AB).wpm, 12000 / 200);
});

test('word-initial keystrokes take the word-initial scale', () => {
  const p = FT.fluency.predict(withLetters({}), { within: 100, initial: 400, errorCostMs: 0, pauseMs: 0 }, AB);
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

// Measured speed includes pauses over 5 s, so the prediction does too.
test('each press takes its share of the pause time', () => {
  near(FT.fluency.predict(withLetters({}), evenly(200, 0, 50), AB).wpm, wpmOf(6, 6 * 250));
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

// A session's pace: the time of a keystroke at ratio 1, measured on what is
// left of each clean interval once its context's ratio is taken out, so the
// spread between contexts, which the prediction applies, is not counted twice.
const timed = (iki, more = {}) => Object.assign({ clean: true, wordInitial: false, iki, ch: 'b', ctx: 'a' }, more);

test('without context ratios, the pace is the arithmetic mean of the clean intervals', () => {
  const p = FT.fluency.pace([timed(100), timed(300), timed(400, { wordInitial: true }), timed(5000, { clean: false })], () => 1);
  assert.deepEqual(plain(p), { within: 200, initial: 400 });
});

test('the pace takes each clean interval relative to its context’s ratio', () => {
  const slowAfterX = (r) => (r.ctx === 'x' ? 4 : 1);
  const p = FT.fluency.pace([timed(100), timed(400, { ctx: 'x' }), timed(200, { wordInitial: true })], slowAfterX);
  assert.deepEqual(plain(p), { within: 100, initial: 200 });
});

test('a population without clean intervals has no pace', () => {
  assert.equal(FT.fluency.pace([timed(100)], () => 1).initial, null);
});

// History entries of relaxed practice with their pace (ms per keystroke at
// ratio 1, FT.fluency.pace), corrections, errors and pauses.
const relaxed = (within, initial, more = {}) => Object.assign({ type: 'relaxed', words: 100, wpm: 50, effort: 3, paceMs: { within, initial },
  correctionMs: 0, errors: 0, pauseMs: 0, presses: 500 }, more);

test('the scale is the arithmetic mean of the paces of the last 5 relaxed exercises', () => {
  const history = [relaxed(999, 999), relaxed(100, 200), relaxed(400, 800), relaxed(100, 200), relaxed(400, 800), relaxed(200, 400)];
  const s = FT.fluency.scale(history);
  near(s.within, 240);
  near(s.initial, 480);
});

test('the cost of an error is those exercises’ correction time over their errors', () => {
  const history = [relaxed(100, 100, { correctionMs: 50000, errors: 1 }), relaxed(100, 100, { correctionMs: 800, errors: 1 }),
    relaxed(100, 100, { correctionMs: 3200, errors: 3 }), relaxed(100, 100), relaxed(100, 100), relaxed(100, 100)];
  near(FT.fluency.scale(history).errorCostMs, 1000);
});

test('errors cost nothing in a scale whose exercises had none', () => {
  assert.equal(FT.fluency.scale([relaxed(100, 100), relaxed(100, 100), relaxed(100, 100)]).errorCostMs, 0);
});

test('correction time without errors costs no error anything', () => {
  assert.equal(FT.fluency.scale([relaxed(100, 100, { correctionMs: 900 }), relaxed(100, 100), relaxed(100, 100)]).errorCostMs, 0);
});

test('the pause time of those exercises is spread over their presses', () => {
  const history = [relaxed(100, 100, { pauseMs: 6000, presses: 400 }), relaxed(100, 100, { pauseMs: 0, presses: 600 }), relaxed(100, 100, { pauseMs: 9000, presses: 1000 })];
  near(FT.fluency.scale(history).pauseMs, 15000 / 2000);
});

test('the scale leaves out other exercise types and exercises under 50 words', () => {
  const history = [relaxed(200, 400), relaxed(200, 400), relaxed(200, 400),
    relaxed(50, 50, { type: 'warmup' }), relaxed(50, 50, { words: 49 }), relaxed(50, 50, { paceMs: undefined })];
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

// Functionality: where the time of recent relaxed typing goes, measured: the
// flow of keystrokes without corrections or pauses, the time corrections
// cost (FT.timing correction) with their cost per error, and the time pauses
// over 5 s take (FT.timing.pauseTime).
const typed = (wpm, durationMs, correctionMs, errors, more = {}) => relaxed(150, 200, Object.assign({ wpm, durationMs, correctionMs, errors }, more));

test('recent relaxed typing splits into flow speed and the share of time corrections cost', () => {
  const b = plain(FT.fluency.breakdown([typed(60, 60000, 6000, 6), typed(50, 120000, 24000, 20)]));
  assert.equal(b.exercises, 2);
  assert.equal(b.flowWpm, (60 * 60000 + 50 * 120000) / (54000 + 96000));   // the same characters without the correction time
  assert.equal(b.correctionShare, 30000 / 180000);
  assert.equal(b.errorCostMs, 30000 / 26);                                 // pooled, not the mean of 1,000 and 1,200 ms
});

test('pauses over 5 s are taken out of the flow speed too, with their own share', () => {
  const b = FT.fluency.breakdown([typed(60, 60000, 6000, 6, { pauseMs: 12000 }), typed(60, 60000, 0, 0)]);
  assert.equal(b.flowWpm, (60 * 60000 * 2) / (120000 - 6000 - 12000));
  assert.equal(b.pauseShare, 0.1);
  assert.equal(b.correctionShare, 0.05);
});

test('the breakdown takes the last 5 comparable relaxed exercises', () => {
  const old = typed(10, 60000, 30000, 3), other = { type: 'warmup' }, short = { words: 20 };
  const b = FT.fluency.breakdown([old].concat([1, 2, 3, 4, 5].map(() => typed(60, 60000, 6000, 6)),
    [typed(10, 60000, 30000, 3, other), typed(10, 60000, 30000, 3, short)]));
  assert.equal(b.exercises, 5);
  assert.equal(b.correctionShare, 0.1);
  assert.equal(b.errorCostMs, 1000);
});

test('typing without errors has no cost per error', () => {
  const b = FT.fluency.breakdown([typed(60, 60000, 0, 0)]);
  assert.equal(b.correctionShare, 0);
  assert.equal(b.pauseShare, 0);
  assert.equal(b.flowWpm, 60);
  assert.equal(b.errorCostMs, null);
});

test('correction time without errors counts in the share, with no cost per error', () => {
  const b = FT.fluency.breakdown([typed(60, 60000, 6000, 0)]);
  assert.equal(b.correctionShare, 0.1);
  assert.equal(b.errorCostMs, null);
});

test('there is no breakdown before a relaxed exercise was measured', () => {
  assert.equal(FT.fluency.breakdown([typed(60, 60000, 6000, 6, { paceMs: undefined, correctionMs: undefined })]), null);
});

// Sanity check, in sample: a model and a scale built from a typist's
// exercises predict the speed of the very text the typist typed last. Out of
// sample, only the benchmark check can tell (FT.progress.fluencyCheck).
// The simulated typist: each pair of letters has its own pace (by default
// 90-210 ms), which varies from keystroke to keystroke; words start 80 ms
// later; th is one declared key; a share of the other letters slip (by
// default 3%), and the slip is noticed after 350 ms, erased and retyped 200 ms
// later, with the next keystroke 250 ms slower (post-error slowing); every
// pauseEvery-th keystroke, if given, comes after a pause of 8 s.
const DAY = 864e5, DAY0 = Date.UTC(2026, 0, 1), TH = ['th'];
function simulatedTypist(seed, { slip = 0.03, fastestMs = 90, spreadMs = 120, pauseEvery = 0 } = {}) {
  const rng = FT.rng(seed), noise = () => (rng() + rng() + rng() - 1.5) * 2;   // mean 0, sd 1
  const pace = (a, b) => fastestMs + ((a.charCodeAt(0) * 31 + b.charCodeAt(0) * 17) % (spreadMs + 1)) + (a === ' ' ? 80 : 0);
  const NOTICE_MS = 350, RETYPE_MS = 200, SLOWER_MS = 250, PAUSE_MS = 8000;
  // The presses (test/helpers/typing.js notation) and the gap before each.
  return function type(targets) {
    const text = targets.map((w) => w + ' ').join(''), gaps = [];
    let notation = '', prev = ' ', slowed = 0;
    for (let i = 0; i < text.length; i++) {
      const gap = pace(prev, text[i]) * Math.exp(0.25 * noise()) + slowed + (pauseEvery && i > 0 && i % pauseEvery === 0 ? PAUSE_MS : 0);
      slowed = 0;
      if (text.startsWith('th', i)) { notation += '[th]'; gaps.push(gap); prev = 'h'; i++; continue; }
      if (text[i] !== ' ' && rng() < slip) {
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
  return trainer.finish({ type: 'relaxed', startedAt: DAY0 + day * DAY, durationMs: hands.t - gaps[0], words, effort: 2 });
}
// Days of practice; the index on the text typed last, and its measure. The
// vocabulary stays at its smallest, so the words typed do not depend on the
// vocabulary controller.
function inSample(seed, typeText, days = 5) {
  const tr = FT.trainer.create({ seed, settings: { macros: TH } });
  tr.difficulty.override(FT.difficulty.TUNING.min);
  let last;
  for (let day = 0; day < days; day++) last = practise(tr, typeText, day);
  const text = FT.fluency.referenceOf(last.raw.words.map((w) => w.target), last.raw.macros);
  const predicted = FT.fluency.index(tr.model.evaluate({ day: last.raw.day }), tr.history(), text, { minN: tr.model.config.minN }).wpm;
  return { predicted, typed: tr.history().at(-1) };
}
// The in-sample error, in percent, of `seeds` simulated practices: trainer
// seeds 40, 53, ... and typist(s) for s = 0, 3, 6, ...; check(run) checks
// each run is the case it is meant to be.
const SEEDS = 6;
function errorsInSample(typist, check, days) {
  return Array.from({ length: SEEDS }, (_, s) => {
    const run = inSample(40 + 13 * s, typist(3 * s), days);
    check(run.typed);
    return 100 * (run.predicted / run.typed.wpm - 1);
  });
}
// The mean is within `tolerance` points of `expected`. Each tolerance is
// three standard errors of a 6-seed mean, from the spread measured over 20
// seeds (standard deviations: 1.8, 1.0 and 1.4 points).
function meanNear(errors, expected, tolerance) {
  const mean = FT.stats.mean(errors);
  assert.ok(Math.abs(mean - expected) < tolerance, 'mean ' + mean.toFixed(2) + '% (' + errors.map((x) => x.toFixed(2)).join(', ') + ')');
}

test('in sample, the index predicts the speed of the very text it was built from to within 2.3% on average', () => {
  const withRealCosts = (typed) => assert.ok(typed.firstAttemptAccuracy < 0.99 && typed.correctionMs / typed.errors > 500, JSON.stringify(typed));
  meanNear(errorsInSample((s) => simulatedTypist(7 + s), withRealCosts), 0, 2.3);
});

// The spread between contexts is in the model's ratios only, not in the
// scale as well. Each session's pace is measured against the model before
// it, so the model needs some sessions to learn the spread first. Known
// bias: such a typist is predicted 1.3% too slow on average over 20 seeds
// (a follow-up in the plan); the test holds it there until it is explained.
test('in sample, a typist whose letter pairs range from 60 to 460 ms, without errors, is predicted 1.3% too slow on average', () => {
  const errorFree = (typed) => assert.equal(typed.errors, 0);
  meanNear(errorsInSample((s) => simulatedTypist(8 + s, { slip: 0, fastestMs: 60, spreadMs: 400 }), errorFree, 10), -1.3, 1.2);
});

test('in sample, a typist who pauses for 8 s now and then is predicted to within 1.8% on average', () => {
  const pausing = (typed) => assert.ok(typed.pauseMs > 10000, JSON.stringify(typed));
  meanNear(errorsInSample((s) => simulatedTypist(9 + s, { slip: 0, pauseEvery: 150 }), pausing), 0, 1.8);
});
