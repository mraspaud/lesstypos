// Difficulty controller for the vocabulary frontier (continuous rank R).
// A staircase with a dead band (Levitt 1971's transformed up-down idea),
// judged on relaxed practice's unbiased words only (evidence(), below):
//   the less common words (rank 100 and beyond) are pooled across exercises
//   until there are minWords of them; since the last step the pool keeps the
//   most recent exercises, about maxWords;
//   the reference is the typist's own first-try error rate on the 100 most
//   common words, the most recent easiestMaxWords of them, kept across steps;
//   with fewer than easiestMinWords of them, nothing is decided;
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
// User decisions: the ratio band against the typist's own easiest words, its
// 2x bound for growth, the credibility (0.9), the floor of 200 words, no WPM
// criterion. Design choices: the 3x bound for shrinking; fewErrors (0.5%,
// the old controller's advance bound), since two error rates near zero have
// no credible ratio; the pool sizes and the step. Every decision is logged
// with its reasons.
(function (FT) {
  'use strict';
  var TUNING = { min: 200, max: 30000, minWords: 300, maxWords: 1000, easiestMinWords: 150, easiestMaxWords: 1000,
    growAtMost: 2, shrinkAbove: 3, fewErrors: 0.005, credible: 0.9,
    step: 1.1, hesTol: 1.25, hesAbs: 0.02, rhythmTol: 1.15, effortHold: 4, baselineN: 5 };
  var START_FRONTIER = 200, EASIEST_RANKS = 100;

  // state: what was learned (stored in the profile); opts: { max } and tuning
  // overrides for tests.
  function create(state, opts) {
    var init = state || {};
    var cfg = Object.assign({}, TUNING, opts || {});
    var st = { frontier: init.frontier != null ? init.frontier : START_FRONTIER, manual: !!init.manual,
      history: init.history || [], windows: init.windows || [], pending: init.pending || null,
      pool: init.pool || [], easiest: init.easiest || [] };

    function clamp(f) { return Math.min(Math.max(f, cfg.min), cfg.max); }
    st.frontier = clamp(st.frontier);

    // What the exercises felt like, pooled since the last decision.
    function addConditions(p, w, n) {
      if (!p) p = { words: 0, hes: 0, hesN: 0, rhy: 0, rhyN: 0, effort: null };
      p.words += n;
      if (w.hesitationRate != null) { p.hes += w.hesitationRate * n; p.hesN += n; }
      if (w.rhythmCv != null) { p.rhy += w.rhythmCv * n; p.rhyN += n; }
      if (w.effort != null) p.effort = Math.max(p.effort || 0, w.effort);
      return p;
    }
    // Adds an exercise's tally to a pool, then drops the oldest exercises
    // while the others still hold at least max words.
    function addTally(pool, t, max) {
      if (t && t.words > 0) pool.push({ words: t.words, chars: t.chars, errors: t.errors });
      while (pool.length > 1 && total(pool).words - pool[0].words >= max) pool.shift();
    }

    function update(w) {
      if (st.manual) return { action: 'manual', frontier: st.frontier, reasons: ['manual vocabulary selection'] };
      addTally(st.pool, w.vocabulary, cfg.maxWords);
      addTally(st.easiest, w.easiest, cfg.easiestMaxWords);
      st.pending = addConditions(st.pending, w, w.vocabulary ? w.vocabulary.words : 0);
      var less = total(st.pool), easy = total(st.easiest);
      if (less.words < cfg.minWords) return waiting(less.words + ' of the ' + cfg.minWords + ' words needed');
      if (easy.words < cfg.easiestMinWords) {
        return waiting(easy.words + ' of the ' + cfg.easiestMinWords + ' words needed among the ' + EASIEST_RANKS + ' most common, to compare with');
      }
      return decide(less, easy, w.at);
    }
    function waiting(reason) { return { action: 'wait', frontier: st.frontier, reasons: [reason] }; }

    function decide(less, easy, at) {
      var felt = conditions(st.pending), measured = { accuracy: accuracy(less), reference: accuracy(easy) };
      var judged = byErrors(less, easy, measured);
      if (judged.action === 'advance') {
        var held = holdsBack(felt);
        if (held.length) judged = { action: 'hold', reasons: judged.reasons.concat(held) };
      }
      var before = st.frontier, stepped = step(judged);
      if (st.frontier !== before) st.pool = [];
      st.windows.push({ hes: felt.hes, rhy: felt.rhy, acc: measured.accuracy });
      if (st.windows.length > 50) st.windows.shift();
      var rec = { action: stepped.action, from: before, to: st.frontier, accuracy: measured.accuracy, reference: measured.reference,
        words: less.words, reasons: stepped.reasons, at: at || null };
      st.history.push(rec);
      if (st.history.length > 500) st.history.shift();
      st.pending = null;
      return rec;
    }

    // The rules a decision on the error rates follows, as its reasons say them.
    var RULES = {
      ratioGrows: cfg.growAtMost + '\u00d7 or less grows the vocabulary',
      fewErrorsGrow: 'fewer than ' + pct1(cfg.fewErrors) + ' errors on them grows the vocabulary',
      ratioShrinks: 'more than ' + cfg.shrinkAbove + '\u00d7 shrinks the vocabulary',
      unclear: 'not yet clearly ' + cfg.growAtMost + '\u00d7 or less, which grows the vocabulary, or more than ' + cfg.shrinkAbove + '\u00d7, which shrinks it',
    };
    // What the error rates alone say: retreat, advance or hold, with its
    // reasons. Neither bound can be credibly passed while P(ratio > growAtMost)
    // lies between 1 - credible and credible, so the shrink bound is checked
    // only above.
    function byErrors(less, easy, measured) {
      var accuracies = 'accuracy (first try) ' + pct2(measured.accuracy) + ' on the less common words, ' + pct2(measured.reference) + ' on the ' + EASIEST_RANKS + ' most common';
      var compared = errorsCompared(less, easy);
      var verdict = function (action, rule) { return { action: action, reasons: [compared + ' (' + rule + ')', accuracies] }; };
      var credibly = function (p) { return p > cfg.credible; };
      var aboveGrow = pRatioAbove(less, easy, cfg.growAtMost);
      if (credibly(1 - aboveGrow)) return verdict('advance', RULES.ratioGrows);
      if (credibly(pFewErrors(less))) return verdict('advance', RULES.fewErrorsGrow);
      if (credibly(aboveGrow) && credibly(pRatioAbove(less, easy, cfg.shrinkAbove))) return verdict('retreat', RULES.ratioShrinks);
      return verdict('hold', RULES.unclear);
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
      var pct = function (x) { return (100 * x).toFixed(1) + '%'; }, reasons = [];
      if (c.hes != null && c.hesBase != null && c.hes > c.hesBase * cfg.hesTol && c.hes - c.hesBase > cfg.hesAbs) {
        reasons.push('hesitation ' + pct(c.hes) + ' above recent ' + pct(c.hesBase));
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

    function override(f) {
      if (f == null) { st.manual = false; return; }
      st.manual = true; st.frontier = clamp(f);
    }

    return { update: update, override: override, state: function () { return st; }, toJSON: function () { return st; } };
  }

  function tally() { return { words: 0, chars: 0, errors: 0 }; }
  function total(pool) {
    return pool.reduce(function (a, t) { return { words: a.words + t.words, chars: a.chars + t.chars, errors: a.errors + t.errors }; }, tally());
  }
  function accuracy(t) { return 1 - t.errors / t.chars; }
  function errorRate(t) { return t.errors / t.chars; }
  // The beta posterior of a first-try error rate, with a uniform prior.
  function errorPosterior(t) { return [1 + t.errors, 1 + t.chars - t.errors]; }
  function errorsCompared(less, easy) {
    if (!easy.errors) return less.errors ? 'errors on the less common words, none on your easiest words' : 'no errors on the less common words or on your easiest words';
    return 'errors on the less common words: ' + (errorRate(less) / errorRate(easy)).toFixed(1) + '\u00d7 your easiest words';
  }
  // Two decimals, so a decision never reads as "98.5% below 98.5%".
  function pct2(x) { return (100 * x).toFixed(2) + '%'; }
  function pct1(x) { return (100 * x).toFixed(1) + '%'; }

  // The evidence an exercise gives: first-try errors per character on its
  // unbiased words (FT.generator.UNBIASED), the easiest (rank below
  // EASIEST_RANKS) apart from the rest. words: the typed words with their
  // meta; analyses: FT.align's, in the same order; rankOf(word) -> rank.
  function evidence(words, analyses, rankOf) {
    var out = { vocabulary: tally(), easiest: tally() };
    words.forEach(function (w, i) {
      if (!w.meta || FT.generator.UNBIASED.indexOf(w.meta.source) < 0) return;
      var rank = rankOf(w.target), t = rank >= 0 && rank < EASIEST_RANKS ? out.easiest : out.vocabulary;
      t.words++;
      analyses[i].targets.forEach(function (x) { t.chars++; t.errors += x.err; });
    });
    return out;
  }

  FT.difficulty = { create: create, evidence: evidence, TUNING: TUNING, EASIEST_RANKS: EASIEST_RANKS };
})(globalThis.FT);
