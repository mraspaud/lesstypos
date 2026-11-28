// Difficulty controller for the vocabulary frontier (continuous rank R).
// A staircase with a dead band (Levitt 1971's transformed up-down idea),
// judged on relaxed practice's unbiased words only (evidence(), below),
// pooled across exercises:
//   the pool keeps the less common words (rank 100 and beyond) of the most
//   recent exercises that hold maxWords of them, by weight, and never more
//   than maxExercises; after a step, every exercise stays at keptAfterStep
//   of its weight, with only its words inside the new vocabulary (not its
//   look-ahead);
//   the reference is the typist's own first-try error rate on the 100 most
//   common words of the same exercises, so a trend moves both alike; where
//   those hold fewer than easiestKept, it reaches further back until it does,
//   so at a large vocabulary, where an exercise holds few of them, it still
//   fills; the easiest words keep their full weight over a step and are
//   collected with a fixed vocabulary too;
//   with fewer than minWords less common words or easiestMinWords easiest
//   words, nothing is decided;
//   each first-try error rate has a beta posterior with a uniform prior (the
//   conjugate beta-binomial model: Gelman et al. 2013, Bayesian Data
//   Analysis, ch. 2);
//   P(less common < growAtMost x easiest) > credible, or
//   P(less common < fewErrors) > credible   -> advance (R * step), unless
//      held by hesitation or rhythm (CV of within-word IKI) clearly worse
//      than the median of recent decisions, or by perceived effort
//      >= effortHold since the last decision;
//   P(less common > shrinkAbove x easiest) > credible   -> retreat (R / step);
//   otherwise hold, and keep pooling.
// The pool is large enough for evidence, not chance, to step: a typist with
// exactly 1.7x the errors reaches P > 0.9 after about 11 exercises of relaxed
// practice at 220 words. Design choice, and its cost: every exercise tests
// the pool again, so a typist exactly on a bound steps across it far more
// often than the 1 in 10 of a single test: within 20 exercises, about 4 in 10
// typists on the 2x bound grow the vocabulary, and about 1 in 3 on the 3x
// bound shrink it (test/difficulty-simulation.test.js).
// User decisions: the ratio band against the typist's own easiest words, its
// 2x bound for growth, under 0.5% errors growing too, the credibility (0.9),
// the floor of 200 words, no WPM criterion. Design choices: the 3x bound for
// shrinking; fewErrors at the old controller's advance bound, since two error
// rates near zero have no credible ratio; the pool sizes, how much evidence a
// step keeps, and the step. Every decision is logged with its reasons.
(function (FT) {
  'use strict';
  var TUNING = { min: 200, max: 30000, minWords: 300, maxWords: 2000, easiestMinWords: 150, easiestKept: 500, maxExercises: 50,
    growAtMost: 2, shrinkAbove: 3, fewErrors: 0.005, credible: 0.9,
    step: 1.1, keptAfterStep: 0.5, hesTol: 1.25, hesAbs: 0.02, rhythmTol: 1.15, effortHold: 4, baselineN: 5 };
  var START_FRONTIER = 200, EASIEST_RANKS = 100;
  // What the reasons call the easiest words, always by the same name.
  var EASIEST = 'your ' + EASIEST_RANKS + ' most common words';

  // state: what was learned (stored in the profile); opts: { max } and tuning
  // overrides for tests.
  function create(state, opts) {
    var init = state || {};
    var cfg = Object.assign({}, TUNING, opts || {});
    var st = { frontier: init.frontier != null ? init.frontier : START_FRONTIER, manual: !!init.manual,
      history: init.history || [], windows: init.windows || [], pending: init.pending || null, pool: init.pool || [], easiest: init.easiest || [] };

    function clamp(f) { return Math.min(Math.max(f, cfg.min), cfg.max); }
    st.frontier = clamp(st.frontier);

    // What the exercises felt like, pooled since the last decision, each
    // exercise weighed by its words.
    function addConditions(p, w) {
      var n = w.words || 0;
      if (!p) p = { hes: 0, hesN: 0, rhy: 0, rhyN: 0, effort: null };
      if (w.hesitationRate != null) { p.hes += w.hesitationRate * n; p.hesN += n; }
      if (w.rhythmCv != null) { p.rhy += w.rhythmCv * n; p.rhyN += n; }
      if (w.effort != null) p.effort = Math.max(p.effort || 0, w.effort);
      return p;
    }
    // Adds an exercise's unbiased words: the less common ones to the pool
    // (none with a fixed vocabulary), one [rank, chars, errors] each, and the
    // tally [words, chars, errors] of the easiest to their own list. Then
    // drops the oldest exercises of the pool while the others still hold
    // maxWords less common words, by weight, or while there are more than
    // maxExercises; and the easiest words of the oldest exercises the pool
    // no longer holds, while the others still hold easiestKept.
    function addExercise(vocabulary, easiest) {
      if (!vocabulary.length && !easiest.length) return;
      if (!st.manual) {
        st.pool.push({ weight: 1, vocabulary: copy(vocabulary) });
        pooled.less = plus(pooled.less, weighted(st.pool.slice(-1)));
      }
      st.easiest.push(easiestTally(easiest));
      pooled.easiest = plus(pooled.easiest, reference(st.easiest.slice(-1)));
      while (st.pool.length > cfg.maxExercises || (st.pool.length > 1 && pooled.less.words - wordsOf(st.pool[0]) >= cfg.maxWords)) {
        pooled.less = minus(pooled.less, weighted(st.pool.splice(0, 1)));
      }
      while (st.easiest.length > Math.max(st.pool.length, 1) && pooled.easiest.words - st.easiest[0][0] >= cfg.easiestKept) {
        pooled.easiest = minus(pooled.easiest, reference(st.easiest.splice(0, 1)));
      }
    }
    // The running tallies of the pool's less common words, by weight, and of
    // the easiest words.
    var pooled = { less: weighted(st.pool), easiest: reference(st.easiest) };
    // After a step, the pooled less common words stay at keptAfterStep of
    // their weight, only those inside the new vocabulary, not its look-ahead.
    function carryOver(after) {
      st.pool.forEach(function (x) {
        x.weight *= cfg.keptAfterStep;
        x.vocabulary = x.vocabulary.filter(function (w) { return w[0] < after; });
      });
      pooled.less = weighted(st.pool);
    }

    function update(w) {
      addExercise(st.manual ? [] : w.vocabulary || [], w.easiest || []);
      if (st.manual) return { action: 'manual', frontier: st.frontier, reasons: ['manual vocabulary selection'] };
      st.pending = addConditions(st.pending, w);
      var less = pooled.less, easy = pooled.easiest;
      if (less.words < cfg.minWords) return waiting(Math.floor(less.words) + ' of the ' + cfg.minWords + ' words needed');
      if (easy.words < cfg.easiestMinWords) {
        return waiting(Math.floor(easy.words) + ' of the ' + cfg.easiestMinWords + ' words needed among ' + EASIEST + ', to compare with');
      }
      return decide(less, easy, w.at);
    }
    function waiting(reason) { return { action: 'wait', frontier: st.frontier, reasons: [reason] }; }

    function decide(less, easy, at) {
      var felt = conditions(st.pending), measured = { accuracy: accuracy(less), reference: accuracy(easy) };
      var judged = byErrors(less, easy), held = judged.action === 'advance' ? holdsBack(felt) : [];
      var rule = held.length ? GROWS[judged.rule] + ' would grow the vocabulary' : RULES[judged.rule];
      var reasons = [errorsCompared(less, easy) + ' (' + rule + ')', accuracies(measured)].concat(held.map(function (x) { return 'held back: ' + x; }));
      var before = st.frontier, stepped = step({ action: held.length ? 'hold' : judged.action, reasons: reasons });
      if (st.frontier !== before) carryOver(st.frontier);
      st.windows.push({ hes: felt.hes, rhy: felt.rhy });
      if (st.windows.length > 50) st.windows.shift();
      var rec = { action: stepped.action, from: before, to: st.frontier, accuracy: measured.accuracy, reference: measured.reference,
        words: less.words, reasons: stepped.reasons, at: at || null };
      st.history.push(rec);
      if (st.history.length > 500) st.history.shift();
      st.pending = null;
      return rec;
    }

    // The rules a decision on the error rates follows, as its reasons say them.
    var GROWS = { ratioGrows: cfg.growAtMost + '\u00d7 or less', fewErrorsGrow: 'fewer than ' + pct1(cfg.fewErrors) + ' errors on the less common words' };
    var RULES = {
      ratioGrows: GROWS.ratioGrows + ' grows the vocabulary',
      fewErrorsGrow: GROWS.fewErrorsGrow + ' grows the vocabulary',
      ratioShrinks: 'more than ' + cfg.shrinkAbove + '\u00d7 shrinks the vocabulary',
      unclear: 'not yet clearly ' + cfg.growAtMost + '\u00d7 or less, which grows the vocabulary, or more than ' + cfg.shrinkAbove + '\u00d7, which shrinks it',
    };
    // What the error rates alone say: retreat, advance or hold, by which
    // rule. Neither bound can be credibly passed while P(ratio > growAtMost)
    // lies between 1 - credible and credible, so the shrink bound is checked
    // only above.
    function byErrors(less, easy) {
      var verdict = function (action, rule) { return { action: action, rule: rule }; };
      var credibly = function (p) { return p > cfg.credible; };
      var aboveGrow = pRatioAbove(less, easy, cfg.growAtMost);
      if (credibly(1 - aboveGrow)) return verdict('advance', 'ratioGrows');
      if (credibly(pFewErrors(less))) return verdict('advance', 'fewErrorsGrow');
      if (credibly(aboveGrow) && credibly(pRatioAbove(less, easy, cfg.shrinkAbove))) return verdict('retreat', 'ratioShrinks');
      return verdict('hold', 'unclear');
    }
    // P(error rate on the less common words > ratio * error rate on the easiest).
    function pRatioAbove(less, easy, ratio) {
      var l = errorPosterior(less), e = errorPosterior(easy);
      return FT.stats.betaRatioAbove(l[0], l[1], e[0], e[1], ratio);
    }
    // P(error rate on the less common words < fewErrors).
    function pFewErrors(less) {
      var l = errorPosterior(less);
      return FT.stats.betaCdf(cfg.fewErrors, l[0], l[1]);
    }

    // How the exercises since the last decision felt, against the median of
    // recent decisions.
    function conditions(p) {
      var recent = st.windows.slice(-cfg.baselineN);
      var baseline = function (key) { return FT.stats.median(recent.map(function (x) { return x[key]; }).filter(function (x) { return x != null; })); };
      return { hes: p.hesN ? p.hes / p.hesN : null, rhy: p.rhyN ? p.rhy / p.rhyN : null, effort: p.effort,
        hesBase: baseline('hes'), rhyBase: baseline('rhy') };
    }
    // The reasons that hold an advance back.
    function holdsBack(c) {
      var reasons = [];
      if (c.hes != null && c.hesBase != null && c.hes > c.hesBase * cfg.hesTol && c.hes - c.hesBase > cfg.hesAbs) {
        reasons.push('hesitation ' + pct1(c.hes) + ' above recent ' + pct1(c.hesBase));
      }
      if (c.rhy != null && c.rhyBase != null && c.rhy > c.rhyBase * cfg.rhythmTol) {
        reasons.push('rhythm less even than recently (CV ' + c.rhy.toFixed(2) + ' vs ' + c.rhyBase.toFixed(2) + ')');
      }
      if (c.effort != null && c.effort >= cfg.effortHold) reasons.push('perceived effort ' + c.effort + ' is high');
      return reasons;
    }

    // Moves the frontier as judged; a step the bounds stop is a hold.
    function step(judged) {
      var before = st.frontier;
      if (judged.action === 'advance') st.frontier = clamp(st.frontier * cfg.step);
      if (judged.action === 'retreat') st.frontier = clamp(st.frontier / cfg.step);
      if (judged.action === 'hold' || st.frontier !== before) return judged;
      var bound = judged.action === 'retreat' ? 'the vocabulary never goes below ' + cfg.min + ' words' : 'the vocabulary is the whole word list';
      return { action: 'hold', reasons: judged.reasons.concat(bound) };
    }

    // Fixes the vocabulary at f, or releases it (f null). Either starts the
    // pool of less common words afresh: they belong to the vocabulary they
    // were typed in.
    function override(f) {
      if (f == null && !st.manual) return;
      st.pool = [];
      pooled.less = tally();
      st.pending = null;
      st.manual = f != null;
      if (st.manual) st.frontier = clamp(f);
    }

    return { update: update, override: override, state: function () { return st; }, toJSON: function () { return st; } };
  }

  function tally() { return { words: 0, chars: 0, errors: 0 }; }
  function copy(list) { return list.map(function (w) { return w.slice(); }); }
  // The weighted tally of the pooled less common words.
  function weighted(pool) {
    var t = tally();
    pool.forEach(function (x) {
      x.vocabulary.forEach(function (w) { t.words += x.weight; t.chars += x.weight * w[1]; t.errors += x.weight * w[2]; });
    });
    return t;
  }
  function wordsOf(x) { return x.weight * x.vocabulary.length; }
  function plus(a, b) { return { words: a.words + b.words, chars: a.chars + b.chars, errors: a.errors + b.errors }; }
  function minus(a, b) { return { words: a.words - b.words, chars: a.chars - b.chars, errors: a.errors - b.errors }; }
  // An exercise's easiest words as one [words, chars, errors].
  function easiestTally(words) {
    return words.reduce(function (t, w) { return [t[0] + 1, t[1] + w[1], t[2] + w[2]]; }, [0, 0, 0]);
  }
  // The tally of the easiest words of the exercises listed.
  function reference(list) {
    return list.reduce(function (t, x) { t.words += x[0]; t.chars += x[1]; t.errors += x[2]; return t; }, tally());
  }
  function accuracy(t) { return 1 - t.errors / t.chars; }
  function errorRate(t) { return t.errors / t.chars; }
  // The beta posterior of a first-try error rate, with a uniform prior.
  function errorPosterior(t) { return [1 + t.errors, 1 + t.chars - t.errors]; }
  function errorsCompared(less, easy) {
    if (!easy.errors) return less.errors ? 'the less common words had errors, ' + EASIEST + ' none' : 'no errors on the less common words or on ' + EASIEST;
    return 'the less common words had ' + (errorRate(less) / errorRate(easy)).toFixed(1) + '\u00d7 the errors of ' + EASIEST;
  }
  function accuracies(measured) {
    return 'accuracy (first try) ' + pct2(measured.accuracy) + ' on the less common words, ' + pct2(measured.reference) + ' on ' + EASIEST;
  }
  // Two decimals, so a decision never reads as "98.5% below 98.5%".
  function pct2(x) { return (100 * x).toFixed(2) + '%'; }
  function pct1(x) { return (100 * x).toFixed(1) + '%'; }

  // The evidence an exercise gives: first-try errors on its unbiased words
  // (FT.generator.UNBIASED), one [rank, chars, errors] per word, the easiest
  // (rank below EASIEST_RANKS) apart from the less common ones (vocabulary).
  // A word the word list does not hold (rank -1) belongs to neither.
  // words: the typed words with their meta; analyses: FT.align's, in the
  // same order; rankOf(word) -> rank.
  function evidence(words, analyses, rankOf) {
    var out = { vocabulary: [], easiest: [] };
    words.forEach(function (w, i) {
      if (!w.meta || FT.generator.UNBIASED.indexOf(w.meta.source) < 0) return;
      var rank = rankOf(w.target), targets = analyses[i].targets;
      if (rank < 0) return;
      var errors = targets.reduce(function (n, x) { return n + x.err; }, 0);
      (rank < EASIEST_RANKS ? out.easiest : out.vocabulary).push([rank, targets.length, errors]);
    });
    return out;
  }

  FT.difficulty = { create: create, evidence: evidence, TUNING: TUNING, EASIEST_RANKS: EASIEST_RANKS };
})(globalThis.FT);
