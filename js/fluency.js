// Fluency index (experimental; design choice, our own synthesis): the relaxed
// speed that the current sequence statistics predict on a fixed reference
// text, so that speed compares over time while the training keeps changing
// what is typed.
// - Keystroke-level prediction, in the spirit of Card, Moran & Newell (1980):
//   the time of a text is the sum of the times of its keystrokes.
// - A keystroke's time depends on the letters before it (Gentner 1983;
//   Salthouse 1986): its longest context with enough timed keystrokes
//   (FT.model.timedContext) gives its time ratio to a session's centre.
// - The scale, in ms per keystroke at ratio 1 for each population (within
//   words and word-initial), is an arithmetic mean, since durations add up
//   arithmetically: the pace, measured on what is left of each clean
//   interval once its context's ratio is taken out (see pace). Applying the
//   model's ratios (taken against the geometric centre) to it is a design
//   choice that keeps the model's relative shape.
// - An error costs the time a correction takes, measured: errors slow typing
//   around the mistake (Salthouse 1986; post-error slowing, Kalfaoğlu &
//   Stafford 2014), and faster typists mainly make fewer errors (Dhakal et
//   al. 2018). Each keystroke adds its context's error rate times the cost of
//   an error (FT.timing correction time over the errors).
// - Measured speed includes pauses over 5 s, which timing leaves out
//   (Dhakal et al. 2018), so each keystroke adds its share of the measured
//   pause time too (design choice; FT.timing.pauseTime): the prediction and
//   the benchmark it is checked against then count the same time.
// - The scale comes from recent relaxed practice: variant A, predicted speed,
//   from all of it; variant B, effortless speed, only from exercises rated
//   effort 1-2.
// Not validated: each benchmark is compared with the prediction made before it
// (FT.progress.fluencyCheck), and that error is all the index can claim.
(function (FT) {
  'use strict';
  // Design choices: the reference's size and seed (its draw is frozen).
  var REFERENCE_WORDS = 1000, REFERENCE_SEED = 20261126;

  // The keystrokes of a text of words, each followed by a space: the context
  // key the model judges (up to MAX_ORDER characters ending at it), whether
  // it starts a word, and whether it comes with the keystroke before it as one
  // press of a declared multi-letter key (macros; FT.presses.ofTarget); and
  // those keys.
  function referenceOf(words, macros) {
    var text = words.join(' ') + ' ', order = FT.evidence.MAX_ORDER, press = FT.presses.ofTarget(text, macros), keystrokes = [];
    for (var i = 0; i < text.length; i++) {
      keystrokes.push({ key: text.slice(Math.max(0, i - order + 1), i + 1), initial: i === 0 || text[i - 1] === ' ',
        sameKey: i > 0 && press[i] === press[i - 1] });
    }
    return { words: words, keystrokes: keystrokes, keys: (macros || []).slice() };
  }

  // The reference text of a corpus: drawn once, seeded, as the benchmark
  // draws its words (FT.exercises.benchmarkSampler); its keystrokes for each
  // set of declared keys.
  var references = new Map();
  function reference(corpus, macros) {
    if (!references.has(corpus)) references.set(corpus, { words: FT.exercises.benchmarkSampler(corpus, FT.rng(REFERENCE_SEED))(REFERENCE_WORDS), keyed: {} });
    var drawn = references.get(corpus), keys = (macros || []).join('\n');
    if (!drawn.keyed[keys]) drawn.keyed[keys] = referenceOf(drawn.words, macros);
    return drawn.keyed[keys];
  }

  // Predicted WPM on the reference (FT.metrics' WPM: characters / 5 per
  // minute) and its coverage, the share of keystrokes timed from a context of
  // two characters or more (the rest rests on single letters, or on nothing).
  // evaluation: FT.judgement.evaluate's; scale: { within, initial,
  // errorCostMs, pauseMs } in ms (see scale);
  // opts.minN: timed keystrokes a context needs (the model's).
  // A keystroke takes exp(mu) x scale of its population, plus its error rate
  // x the cost of an error, plus the pause time per press; one without a
  // timed context takes the scale and the overall error rate (design choice).
  // The later letters of a declared key come with its first: no time, and no
  // part of the coverage.
  var MIN_COVERED_ORDER = 2;
  function predict(evaluation, scale, ref, opts) {
    var minN = FT.valueOr(opts && opts.minN, FT.model.DEFAULTS.minN), totalMs = 0, covered = 0, pressed = 0;
    ref.keystrokes.forEach(function (k) {
      if (k.sameKey) return;
      pressed++;
      var c = FT.model.timedContext(evaluation, k.key, minN);
      var ratio = c ? Math.exp(c.mu) : 1, errorRate = c ? c.errorRate : evaluation.global.rate;
      totalMs += ratio * (k.initial ? scale.initial : scale.within) + errorRate * scale.errorCostMs + scale.pauseMs;
      if (c && c.key.length >= MIN_COVERED_ORDER) covered++;
    });
    return { wpm: ref.keystrokes.length / 5 / (totalMs / 60000), coverage: covered / pressed };
  }

  // A session's pace per population (within words, word-initial): the ms a
  // keystroke takes at ratio 1, or null without clean intervals. Design
  // choice: the residual within each context, the mean of each clean interval
  // divided by its context's expected ratio (expectedRatio(record), from the
  // model before this session), i.e. centre x mean(exp(logRatio - mu)). The
  // arithmetic mean itself already holds the spread between contexts, which
  // the prediction applies again through exp(mu).
  function pace(records, expectedRatio) {
    var within = [], initial = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? initial : within).push(r.iki / expectedRatio(r)); });
    return { within: FT.stats.mean(within), initial: FT.stats.mean(initial) };
  }

  var meanOf = function (entries, value) { return FT.stats.mean(entries.map(value)); };
  var sumOf = function (entries, value) { return entries.reduce(function (sum, h) { return sum + value(h); }, 0); };
  // The cost per error of exercises, pooled: all their correction time over
  // all their first-try errors (FT.timing correction), or null without errors.
  function errorCostMs(entries) {
    var errors = sumOf(entries, function (h) { return h.errors; });
    return errors > 0 ? sumOf(entries, function (h) { return h.correctionMs; }) / errors : null;
  }
  // The pause time per press of exercises, pooled (FT.timing.pauseTime).
  function pauseMsPerPress(entries) {
    var presses = sumOf(entries, function (h) { return h.presses; });
    return presses > 0 ? sumOf(entries, function (h) { return h.pauseMs; }) / presses : 0;
  }

  // The scale, from the recent relaxed exercises (FT.history.recentRelaxed)
  // that pass filter: per population, their mean pace; their cost per error
  // (0 when none had an error) and pause time per press; null before
  // MIN_SCALE_EXERCISES of them (design choice: 3).
  var MIN_SCALE_EXERCISES = 3;
  function scale(history, filter) {
    var picked = FT.history.recentRelaxed(history, filter);
    if (picked.length < MIN_SCALE_EXERCISES) return null;
    return {
      within: meanOf(picked, function (h) { return h.paceMs.within; }),
      initial: meanOf(picked, function (h) { return h.paceMs.initial; }),
      errorCostMs: FT.valueOr(errorCostMs(picked), 0),
      pauseMs: pauseMsPerPress(picked),
    };
  }

  // Where the time of the same recent relaxed exercises goes, measured, not
  // predicted: correctionShare, the share of the time that corrections cost
  // (FT.timing correction); pauseShare, the share pauses over 5 s take
  // (FT.timing.pauseTime); flowWpm, the speed of the same characters without
  // either; errorCostMs, the cost per error (null without errors). Null
  // before a measured relaxed exercise.
  function breakdown(history) {
    var recent = FT.history.recentRelaxed(history);
    if (!recent.length) return null;
    var typedMs = sumOf(recent, function (h) { return h.durationMs; }), correctionMs = sumOf(recent, function (h) { return h.correctionMs; });
    var pauseMs = sumOf(recent, function (h) { return h.pauseMs; }), wpmMs = sumOf(recent, function (h) { return h.wpm * h.durationMs; });
    return { exercises: recent.length, flowWpm: wpmMs / (typedMs - correctionMs - pauseMs), correctionShare: correctionMs / typedMs, pauseShare: pauseMs / typedMs,
      errorCostMs: errorCostMs(recent) };
  }

  // Variant B's exercises: rated effort 1 or 2 of 5.
  var EFFORTLESS_MAX = 2;
  function effortless(h) { return h.effort != null && h.effort <= EFFORTLESS_MAX; }

  // Both variants, the coverage and the declared keys the reference was
  // typed with, or null before A has a scale.
  function index(evaluation, history, ref, opts) {
    var all = scale(history);
    if (!all) return null;
    var a = predict(evaluation, all, ref, opts), low = scale(history, effortless);
    return { wpm: a.wpm, effortlessWpm: low ? predict(evaluation, low, ref, opts).wpm : undefined, coverage: a.coverage, keys: ref.keys };
  }

  FT.fluency = { reference: reference, referenceOf: referenceOf, predict: predict, pace: pace, scale: scale, breakdown: breakdown, effortless: effortless, index: index,
    REFERENCE_WORDS: REFERENCE_WORDS, MIN_SCALE_EXERCISES: MIN_SCALE_EXERCISES, EFFORTLESS_MAX: EFFORTLESS_MAX };
})(globalThis.FT);
