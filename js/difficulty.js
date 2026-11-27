// Difficulty controller for the vocabulary frontier (continuous rank R).
// A staircase with a dead band (Levitt 1971's transformed up-down idea),
// judged on relaxed practice's unbiased words only (evidence(), below):
//   the less common words (rank 100 and beyond) are pooled across exercises
//   until there are minWords of them; since the last step the pool keeps the
//   most recent exercises, about maxWords;
//   the reference is the typist's own first-try accuracy on the 100 most
//   common words, the most recent easiestMaxWords of them, kept across steps;
//   with fewer than easiestMinWords of them, nothing is decided;
//   each first-try accuracy has a beta posterior with a uniform prior (the
//   conjugate beta-binomial model: Gelman et al. 2013, Bayesian Data
//   Analysis, ch. 2);
//   P(less common > easiest - advanceWithin) > credible  -> advance (R * step),
//      unless held by hesitation or rhythm (CV of within-word IKI) clearly
//      worse than the median of recent decisions, or by perceived effort
//      >= effortHold since the last decision;
//   P(less common < easiest - retreatBelow) > credible   -> retreat (R / step);
//   otherwise hold, and keep pooling.
// Design choices: the band relative to the typist's own accuracy on the
// easiest words, its bounds (0.5 and 1.5 points), the credibility (0.9), the
// pool sizes, the step and the floor of 200 words. No WPM criterion. Every
// decision is logged with its reasons.
(function (FT) {
  'use strict';
  var TUNING = { min: 200, max: 30000, minWords: 300, maxWords: 1000, easiestMinWords: 150, easiestMaxWords: 1000,
    advanceWithin: 0.005, retreatBelow: 0.015, credible: 0.9,
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
      var acc = accuracy(less), ref = accuracy(easy), p = st.pending;
      var hes = p.hesN ? p.hes / p.hesN : null, rhy = p.rhyN ? p.rhy / p.rhyN : null;
      var recent = st.windows.slice(-cfg.baselineN);
      var hesBase = FT.stats.median(recent.map(function (x) { return x.hes; }).filter(function (x) { return x != null; }));
      var rhyBase = FT.stats.median(recent.map(function (x) { return x.rhy; }).filter(function (x) { return x != null; }));
      var pct = function (x) { return (100 * x).toFixed(1) + '%'; };
      var both = function (link) { return 'accuracy (first try) ' + pct2(acc) + ' on the less common words' + link + pct2(ref) + ' on the ' + EASIEST_RANKS + ' most common'; };
      var action, reasons = [];
      if (credibly(less, easy, -cfg.retreatBelow, 'below')) {
        action = 'retreat';
        reasons.push(both(', clearly below your '));
      } else if (credibly(less, easy, -cfg.advanceWithin, 'above')) {
        action = 'advance';
        reasons.push(both(', close to your '));
        if (hes != null && hesBase != null && hes > hesBase * cfg.hesTol && hes - hesBase > cfg.hesAbs) {
          action = 'hold'; reasons.push('hesitation ' + pct(hes) + ' above recent ' + pct(hesBase));
        }
        if (rhy != null && rhyBase != null && rhy > rhyBase * cfg.rhythmTol) {
          action = 'hold'; reasons.push('rhythm less even than recently (CV ' + rhy.toFixed(2) + ' vs ' + rhyBase.toFixed(2) + ')');
        }
        if (p.effort != null && p.effort >= cfg.effortHold) {
          action = 'hold'; reasons.push('perceived effort ' + p.effort + ' is high');
        }
      } else {
        action = 'hold';
        reasons.push(both(' against ') + ', not yet clear enough to change');
      }
      var before = st.frontier;
      if (action === 'advance') st.frontier = clamp(st.frontier * cfg.step);
      if (action === 'retreat') st.frontier = clamp(st.frontier / cfg.step);
      if (action !== 'hold' && st.frontier === before) {
        reasons.push(action === 'retreat' ? 'the vocabulary never goes below ' + cfg.min + ' words' : 'the vocabulary is the whole word list');
        action = 'hold';
      }
      if (st.frontier !== before) st.pool = [];
      st.windows.push({ hes: hes, rhy: rhy, acc: acc });
      if (st.windows.length > 50) st.windows.shift();
      var rec = { action: action, from: before, to: st.frontier, accuracy: acc, reference: ref, words: less.words, reasons: reasons, at: at || null };
      st.history.push(rec);
      if (st.history.length > 500) st.history.shift();
      st.pending = null;
      return rec;
    }
    // Is the less common words' accuracy credibly above (or below) the
    // easiest words' accuracy plus margin?
    function credibly(less, easy, margin, side) {
      var above = FT.stats.betaDifferenceAbove(1 + less.chars - less.errors, 1 + less.errors,
        1 + easy.chars - easy.errors, 1 + easy.errors, margin);
      return (side === 'above' ? above : 1 - above) > cfg.credible;
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
  // Two decimals, so a decision never reads as "98.5% below 98.5%".
  function pct2(x) { return (100 * x).toFixed(2) + '%'; }

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
