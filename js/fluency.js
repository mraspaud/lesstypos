// Fluency index (experimental; design choice, our own synthesis): the relaxed
// speed that the current sequence statistics predict on a fixed reference
// text, so that speed compares over time while the training keeps changing
// what is typed.
// - Keystroke-level prediction, in the spirit of Card, Moran & Newell (1980):
//   the time of a text is the sum of the times of its keystrokes.
// - A keystroke's time depends on the letters before it (Gentner 1983;
//   Salthouse 1986): its longest context with enough timed keystrokes
//   (FT.model.timedContext) gives its time ratio to a session's centre.
// - An error costs extra keystrokes, the slip and its backspace, as in the
//   keystrokes-per-character measure of Soukoreff & MacKenzie (2003).
// - The scale, in ms per keystroke at ratio 1 for each population (within
//   words and word-initial), comes from recent relaxed practice: variant A,
//   predicted speed, from all of it; variant B, effortless speed, only from
//   exercises rated effort 1-2.
// Not validated: each benchmark is compared with the prediction made before it
// (FT.progress.fluencyCheck), and that error is all the index can claim.
(function (FT) {
  'use strict';
  // Design choices: the reference's size and seed (its draw is frozen).
  var REFERENCE_WORDS = 1000, REFERENCE_SEED = 20261126;

  // The keystrokes of a text of words, each followed by a space: the context
  // key the model judges (up to MAX_ORDER characters ending at it) and
  // whether it starts a word.
  function referenceOf(words) {
    var text = words.join(' ') + ' ', order = FT.evidence.MAX_ORDER, keystrokes = [];
    for (var i = 0; i < text.length; i++) {
      keystrokes.push({ key: text.slice(Math.max(0, i - order + 1), i + 1), initial: i === 0 || text[i - 1] === ' ' });
    }
    return { words: words, keystrokes: keystrokes };
  }

  // The reference text of a corpus: drawn once, seeded, as the benchmark
  // draws its words (FT.exercises.benchmarkSampler).
  var references = new Map();
  function reference(corpus) {
    if (!references.has(corpus)) {
      var words = FT.exercises.benchmarkSampler(corpus, FT.rng(REFERENCE_SEED))(REFERENCE_WORDS);
      references.set(corpus, referenceOf(words));
    }
    return references.get(corpus);
  }

  // Predicted WPM on the reference (FT.metrics' WPM: characters / 5 per
  // minute) and its coverage, the share of keystrokes timed from a context of
  // two characters or more (the rest rests on single letters, or on nothing).
  // evaluation: FT.judgement.evaluate's; scale: { within, initial } in ms;
  // opts.minN: timed keystrokes a context needs (the model's).
  // A keystroke takes exp(mu) x scale of its population; one without a timed
  // context takes the scale and the overall error rate (design choice).
  // Each error adds two keystrokes of the same time.
  var SLIP_AND_BACKSPACE = 2, MIN_COVERED_ORDER = 2;
  function predict(evaluation, scale, ref, opts) {
    var minN = FT.valueOr(opts && opts.minN, FT.model.DEFAULTS.minN), totalMs = 0, covered = 0;
    ref.keystrokes.forEach(function (k) {
      var c = FT.model.timedContext(evaluation, k.key, minN);
      var ratio = c ? Math.exp(c.mu) : 1, errorRate = c ? c.errorRate : evaluation.global.rate;
      totalMs += ratio * (k.initial ? scale.initial : scale.within) * (1 + SLIP_AND_BACKSPACE * errorRate);
      if (c && c.key.length >= MIN_COVERED_ORDER) covered++;
    });
    var n = ref.keystrokes.length;
    return { wpm: n / 5 / (totalMs / 60000), coverage: covered / n };
  }

  // The scale: per population, the geometric mean of the session centres
  // (FT.timing centreMs) of the last SCALE_EXERCISES comparable relaxed
  // exercises that pass filter; null before MIN_SCALE_EXERCISES of them.
  // Design choices: 5 and 3. Relaxed practice is the pace the index is about.
  var SCALE_EXERCISES = 5, MIN_SCALE_EXERCISES = 3;
  function scale(history, filter) {
    var picked = history.filter(function (h) {
      return FT.history.isComparableRelaxed(h) && h.centreMs && h.centreMs.within != null && h.centreMs.initial != null && (!filter || filter(h));
    }).slice(-SCALE_EXERCISES);
    if (picked.length < MIN_SCALE_EXERCISES) return null;
    var geometricMean = function (population) {
      return Math.exp(FT.stats.meanLog(picked.map(function (h) { return h.centreMs[population]; })));
    };
    return { within: geometricMean('within'), initial: geometricMean('initial') };
  }
  // Variant B's exercises: rated effort 1 or 2 of 5.
  function effortless(h) { return h.effort != null && h.effort <= 2; }

  // Both variants and the coverage, or null before A has a scale.
  function index(evaluation, history, ref, opts) {
    var all = scale(history);
    if (!all) return null;
    var a = predict(evaluation, all, ref, opts), low = scale(history, effortless);
    return { wpm: a.wpm, effortlessWpm: low ? predict(evaluation, low, ref, opts).wpm : undefined, coverage: a.coverage };
  }

  FT.fluency = { reference: reference, referenceOf: referenceOf, predict: predict, scale: scale, effortless: effortless, index: index,
    REFERENCE_WORDS: REFERENCE_WORDS };
})(globalThis.FT);
