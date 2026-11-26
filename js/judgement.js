// Judgement of every typing context from its evidence (FT.evidence): which
// contexts are genuinely weak (error-prone) or hesitant (slow), judged
// against their backoff parent.
//
// Parent of a context = its shorter suffix (n-gram backoff hierarchy; Chen &
// Goodman 1998). Unigram parent = global.
// Errors: beta-binomial with empirical-Bayes prior strength per order (Efron &
// Morris 1975), centred on the parent's rate computed WITHOUT this context's own
// data. Flag when P(rate > parent) > 0.95 and the excess is practically
// meaningful.
// Latency: normal model on per-keystroke log IKI ratio (timing.js), prior
// centred on the parent, prior variance by method of moments.
// Explaining away (design choice): if a flagged child accounts for its
// parent's deficit, the parent is not flagged.
// Replication (design choice, user decision): a context is flagged only when
// the deficit also shows in at least `minSessions` separate sessions (each with
// >= minSessionN observations, compared with the parent in the same session).
// Credible but unreplicated deficits are reported as 'emerging'.
// Late keys (design choice): a key the keyboard sends late (FT.keyevents.lateKeys)
// has shifted timestamps. Its longer contexts are judged against a parent
// ending on the same key, so the shift cancels; the single key is judged
// against all keys, so its latency is not judged (lateKey). Errors are.
// Redundancy (design choice): a child whose parent has (almost) no data
// besides the child's own is not judged separately; it carries no information
// beyond its parent and must not explain the parent away.
(function (FT) {
  'use strict';
  var S = FT.stats, E = FT.evidence;
  // Design choice: a parent's error rate is bounded to [MIN_RATE, MAX_RATE]
  // before it centres a prior (so a context is never judged against 0).
  var MIN_RATE = 1e-4, MAX_RATE = 0.5;
  // Design choices for the hyperparameters' estimation: which contexts inform
  // it, the defaults when too few do, and the bounds the estimates keep to.
  var HYPER = {
    errorsMinCount: 30, latencyMinCount: 10, minContexts: 5,
    kappa: { fallback: 200, unbounded: 2000, min: 20, max: 2000 },
    sigma2: { fallback: 0.1, min: 1e-3 },
    tau2: { fallback: 0.05, min: 0.0025, max: 0.5 },
  };
  function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

  // Judges one context's evidence against its parent's estimate (made
  // without that evidence): error rate (beta-binomial) and mean log time
  // ratio (normal), each shrunk towards the parent. meansOnly: only the
  // shrunk estimates.
  function judge(evidence, parentRate, parentMu, hyper, cfg, meansOnly) {
    var kappa = hyper.kappa, m = clamp(parentRate, MIN_RATE, MAX_RATE);
    var alpha = kappa * m + evidence.errors, beta = kappa * (1 - m) + (evidence.count - evidence.errors);
    var rate = alpha / (alpha + beta);
    var sigma2 = hyper.sigma2, tau2 = hyper.tau2;
    var precision = 1 / tau2 + evidence.latencyCount / sigma2;
    var mu = (parentMu / tau2 + evidence.latencySum / sigma2) / precision;
    if (meansOnly) return { errorRate: rate, mu: mu };
    var pWorse = 1 - S.betaCdf(m, alpha, beta);
    var sd = Math.sqrt(1 / precision);
    var pSlower = evidence.latencyCount > 0 ? S.normCdf((mu - parentMu) / sd) : 0.5;
    var insufficient = evidence.count < cfg.minN;
    var weak = !insufficient && pWorse > cfg.pFlag && rate - m >= cfg.minErrAbs && rate / m >= cfg.minErrRel;
    var latRel = Math.exp(mu - parentMu);
    var hesitant = evidence.latencyCount >= cfg.minN && pSlower > cfg.pFlag && latRel >= cfg.minLatRel;
    return { errorRate: rate, parentErrorRate: m, pWorse: pWorse, mu: mu, muSd: sd, parentMu: parentMu,
      latRel: latRel, pSlower: pSlower, weak: weak, hesitant: hesitant, insufficient: insufficient };
  }

  // Method-of-moments hyperparameters of one order: kappa, the prior strength
  // of error rates; sigma2, the keystroke variance of log time ratios; tau2,
  // the variance of contexts' mean log ratios around their parents'.
  // items: [{ evidence, parentRate, parentMu }].
  function hyperFor(items) {
    var sigma2 = keystrokeVariance(items);
    return { kappa: priorStrength(items), sigma2: sigma2, tau2: contextVariance(items, sigma2) };
  }
  function priorStrength(items) {
    var big = items.filter(function (x) { return x.evidence.count >= HYPER.errorsMinCount; });
    var kappa = HYPER.kappa.fallback;
    if (big.length >= HYPER.minContexts) {
      var spread = 0, sampling = 0, binomial = 0;
      big.forEach(function (x) {
        var r = x.evidence.errors / x.evidence.count, m = Math.max(x.parentRate, MIN_RATE);
        spread += (r - m) * (r - m); sampling += m * (1 - m) / x.evidence.count; binomial += m * (1 - m);
      });
      spread /= big.length; sampling /= big.length; binomial /= big.length;
      kappa = spread - sampling > 1e-9 ? binomial / (spread - sampling) - 1 : HYPER.kappa.unbounded;
    }
    return clamp(kappa, HYPER.kappa.min, HYPER.kappa.max);
  }
  function keystrokeVariance(items) {
    var squares = 0, df = 0;
    items.forEach(function (x) {
      var e = x.evidence;
      if (e.latencyCount >= 2) { squares += e.latencySquares - e.latencySum * e.latencySum / e.latencyCount; df += e.latencyCount - 1; }
    });
    return df > 0 ? Math.max(squares / df, HYPER.sigma2.min) : HYPER.sigma2.fallback;
  }
  function contextVariance(items, sigma2) {
    var timed = items.filter(function (x) { return x.evidence.latencyCount >= HYPER.latencyMinCount; });
    var tau2 = HYPER.tau2.fallback;
    if (timed.length >= HYPER.minContexts) {
      var observed = 0, sampling = 0;
      timed.forEach(function (x) {
        var d = x.evidence.latencySum / x.evidence.latencyCount - x.parentMu;
        observed += d * d; sampling += sigma2 / x.evidence.latencyCount;
      });
      tau2 = (observed - sampling) / timed.length;
    }
    return clamp(tau2, HYPER.tau2.min, HYPER.tau2.max);
  }

  // Judgement of every context on `day`, in steps:
  //   aggregate evidence -> global prior -> judge each order against its
  //   parent -> confirm across sessions -> explain parents away -> label.
  // Reads the state, never changes it.
  function evaluate(state, cfg, day) {
    var agg = aggregateAll(state, cfg, day);
    var prior = globalPrior(agg);
    var j = judgeByOrder(state, cfg, agg, prior, day);
    confirmAcrossSessions(state, cfg, j.out);
    explainAway(state, cfg, j.out, agg, j.hypers, day);
    labelStates(j.out);
    return { get: function (k) { return j.out[k]; }, all: j.out, hyper: j.hypers, global: prior,
      late: Object.keys(state.late || {}).sort() };
  }

  function aggregateAll(state, cfg, day) {
    var agg = {};
    Object.keys(state.contexts).forEach(function (k) { agg[k] = E.aggregate(state.contexts[k], day, cfg); });
    return agg;
  }

  // Unigrams are judged against all typing: the pooled unigram evidence.
  function globalPrior(agg) {
    var all = { count: 0, errors: 0, latencyCount: 0, latencySum: 0 };
    Object.keys(agg).forEach(function (k) { if (k.length === 1) addEvidence(all, agg[k]); });
    return { rate: (all.errors + 1) / (all.count + 2), mu: all.latencyCount ? all.latencySum / all.latencyCount : 0 };
  }
  function addEvidence(sum, e) {
    sum.count += e.count; sum.errors += e.errors; sum.latencyCount += e.latencyCount; sum.latencySum += e.latencySum;
  }

  // Ascending order, so each parent is judged before its children.
  function judgeByOrder(state, cfg, agg, prior, day) {
    var out = {}, hypers = {}, keys = Object.keys(agg);
    for (var order = 1; order <= E.MAX_ORDER; order++) {
      var items = keys.filter(function (k) { return k.length === order; })
        .map(function (k) { return parentEstimate(state, cfg, k, order, agg, out, hypers, prior, day); });
      var hyper = hypers[order] = hyperFor(items);
      items.forEach(function (x) {
        var r = judge(x.evidence, x.parentRate, x.parentMu, hyper, cfg), e = x.evidence;
        r.key = x.key; r.order = order; r.parent = order > 1 ? x.key.slice(1) : null;
        r.n = e.count; r.errors = e.errors; r.latN = e.latencyCount;
        r.rawMu = e.latencyCount ? e.latencySum / e.latencyCount : null; // measured mean log ratio (no shrinkage)
        if (x.redundant) { r.redundant = true; r.weak = false; r.hesitant = false; }
        if (order === 1 && state.late && state.late[x.key]) { r.lateKey = true; r.hesitant = false; }
        out[x.key] = r;
      });
    }
    return { out: out, hypers: hypers };
  }

  // The parent's estimate without this child's own data, weighted with the
  // child's weights (a comparison matched in time).
  function parentEstimate(state, cfg, k, order, agg, out, hypers, prior, day) {
    var item = { key: k, evidence: agg[k], parentRate: prior.rate, parentMu: prior.mu, redundant: false };
    var parentKey = k.slice(1), parent = order > 1 && out[parentKey];
    if (!parent) return item;
    var parentWithout = E.minus(E.aggregateWith(state.contexts[parentKey], E.weightsFor(state.contexts[k], day, cfg)), agg[k]);
    var estimate = judge(parentWithout, parent.parentErrorRate, parent.parentMu, hypers[order - 1], cfg, true);
    item.parentRate = estimate.errorRate; item.parentMu = estimate.mu; item.redundant = parentWithout.count < cfg.minN;
    return item;
  }

  // Sessions in which the context did worse than its parent in that same
  // session (parent without the context's own data, FT.evidence.deficit):
  // judged now for the recent sessions, counted when merged for the older
  // ones.
  function replication(state, cfg, k, parentKey, globalByBucket) {
    var parentByKey = {};
    if (parentKey) state.contexts[parentKey].buckets.forEach(function (b) { parentByKey[E.bucketKey(b)] = b; });
    var err = 0, lat = 0;
    state.contexts[k].buckets.forEach(function (b) {
      if (b.block != null) { err += b.errorDeficits || 0; lat += b.latencyDeficits || 0; return; }
      var p = parentKey ? E.parentBucket(parentByKey, b, cfg) : globalByBucket[E.bucketKey(b)];
      if (!p) return;
      var d = E.deficit(b, p, cfg);
      err += +d.errors; lat += +d.latency;
    });
    return { err: err, lat: lat };
  }

  // All typing per bucket: the unigram buckets pooled.
  function globalByBucket(state) {
    var pooled = {};
    Object.keys(state.contexts).forEach(function (k) {
      if (k.length !== 1) return;
      state.contexts[k].buckets.forEach(function (b) {
        var key = E.bucketKey(b);
        E.addSums(pooled[key] || (pooled[key] = E.emptySums()), b);
      });
    });
    return pooled;
  }

  function confirmAcrossSessions(state, cfg, out) {
    var pooled = globalByBucket(state);
    Object.keys(out).forEach(function (k) {
      var c = out[k];
      if (!(c.weak || c.hesitant)) { c.errSessions = c.latSessions = null; return; }
      var r = replication(state, cfg, k, c.parent, pooled);
      c.errSessions = r.err; c.latSessions = r.lat;
      var w = c.weak && r.err >= cfg.minSessions, h = c.hesitant && r.lat >= cfg.minSessions;
      if ((c.weak && !w) || (c.hesitant && !h)) c.emerging = !(w || h);
      c.weak = w; c.hesitant = h;
    });
  }

  // A flagged parent whose deficit is accounted for by its flagged children
  // is not flagged itself. Highest order first.
  function explainAway(state, cfg, out, agg, hypers, day) {
    var flagged = function (c) { return c && (c.weak || c.hesitant); };
    for (var order = E.MAX_ORDER; order >= 2; order--) {
      var kidsByParent = {};
      Object.keys(out).forEach(function (k) {
        var c = out[k];
        if (c.order === order && flagged(c)) (kidsByParent[c.parent] = kidsByParent[c.parent] || []).push(k);
      });
      Object.keys(kidsByParent).forEach(function (parentKey) {
        var p = out[parentKey];
        if (!flagged(p)) return;
        var kids = kidsByParent[parentKey], parentWeights = E.weightsFor(state.contexts[parentKey], day, cfg), rest = agg[parentKey];
        kids.forEach(function (kid) { rest = E.minus(rest, E.aggregateWith(state.contexts[kid], parentWeights)); });
        var r = judge(rest, p.parentErrorRate, p.parentMu, hypers[order - 1], cfg);
        if (p.weak && !r.weak) { p.weak = false; p.explainedBy = kids; }
        if (p.hesitant && !r.hesitant) { p.hesitant = false; p.explainedBy = kids; }
      });
    }
  }

  function labelStates(out) {
    Object.keys(out).forEach(function (k) {
      var c = out[k];
      c.state = c.insufficient ? 'insufficient' : c.redundant ? 'redundant'
        : c.weak ? 'weak' : c.hesitant ? 'hesitant' : c.emerging ? 'emerging' : 'ok';
    });
  }

  // Why a context is judged as it is (the Sequences page).
  function explain(state, cfg, evaluation, key) {
    var c = evaluation.get(key);
    var ctx = state.contexts[key];
    if (!c) return null;
    return {
      key: key, parent: c.parent, order: c.order, state: c.state, stage: ctx.stage,
      n: c.n, errors: c.errors, errorRate: c.errorRate, parentErrorRate: c.parentErrorRate, pWorse: c.pWorse,
      latency: { n: c.latN, ratio: Math.exp(c.mu), parentRatio: Math.exp(c.parentMu), relative: c.latRel, pSlower: c.pSlower },
      explainedBy: c.explainedBy || null, redundant: !!c.redundant, lateKey: !!c.lateKey,
      sessionsWithDeficit: Math.max(c.errSessions || 0, c.latSessions || 0),
      errorSessions: c.errSessions, latencySessions: c.latSessions, minSessions: cfg.minSessions,
      examples: ctx.examples.slice().reverse(),
      sessions: ctx.buckets.reduce(function (n, b) { return n + E.sessionsIn(b); }, 0),
    };
  }

  FT.judgement = { evaluate: evaluate, explain: explain };
})(globalThis.FT);
