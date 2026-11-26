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

  // Judge one context's aggregate g against a parent aggregate (excluding g).
  function judge(g, parentRate, parentMu, hyper, cfg, meansOnly) {
    var kappa = hyper.kappa, m = Math.min(Math.max(parentRate, 1e-4), 0.5);
    var a = kappa * m + g.errors, b = kappa * (1 - m) + (g.count - g.errors);
    var rate = a / (a + b);
    var sigma2 = hyper.sigma2, tau2 = hyper.tau2;
    var prec = 1 / tau2 + g.latencyCount / sigma2;
    var mu = (parentMu / tau2 + g.latencySum / sigma2) / prec;
    if (meansOnly) return { errorRate: rate, mu: mu };
    var pWorse = 1 - S.betaCdf(m, a, b);
    var sd = Math.sqrt(1 / prec);
    var pSlower = g.latencyCount > 0 ? S.normCdf((mu - parentMu) / sd) : 0.5;
    var insufficient = g.count < cfg.minN;
    var weak = !insufficient && pWorse > cfg.pFlag && rate - m >= cfg.minErrAbs && rate / m >= cfg.minErrRel;
    var latRel = Math.exp(mu - parentMu);
    var hesitant = g.latencyCount >= cfg.minN && pSlower > cfg.pFlag && latRel >= cfg.minLatRel;
    return { errorRate: rate, parentErrorRate: m, pWorse: pWorse, mu: mu, muSd: sd, parentMu: parentMu,
      latRel: latRel, pSlower: pSlower, weak: weak, hesitant: hesitant, insufficient: insufficient };
  }

  // Method-of-moments hyperparameters per order.
  // items: [{g, m, mu}] with parent rate m and parent mean mu
  function hyperFor(items) {
    var big = items.filter(function (x) { return x.g.count >= 30; });
    var kappa = 200;
    if (big.length >= 5) {
      var V = 0, B = 0, Q = 0;
      big.forEach(function (x) {
        var r = x.g.errors / x.g.count, m = Math.max(x.m, 1e-4);
        V += (r - m) * (r - m); B += m * (1 - m) / x.g.count; Q += m * (1 - m);
      });
      V /= big.length; B /= big.length; Q /= big.length;
      kappa = V - B > 1e-9 ? Q / (V - B) - 1 : 2000;
    }
    kappa = Math.min(Math.max(kappa, 20), 2000);
    var num = 0, den = 0;
    items.forEach(function (x) {
      var g = x.g;
      if (g.latencyCount >= 2) { num += g.latencySquares - g.latencySum * g.latencySum / g.latencyCount; den += g.latencyCount - 1; }
    });
    var sigma2 = den > 0 ? Math.max(num / den, 1e-3) : 0.1;
    var lat = items.filter(function (x) { return x.g.latencyCount >= 10; });
    var tau2 = 0.05;
    if (lat.length >= 5) {
      var D = 0, Ev = 0;
      lat.forEach(function (x) { var d = x.g.latencySum / x.g.latencyCount - x.mu; D += d * d; Ev += sigma2 / x.g.latencyCount; });
      tau2 = (D - Ev) / lat.length;
    }
    tau2 = Math.min(Math.max(tau2, 0.0025), 0.5);
    return { kappa: kappa, sigma2: sigma2, tau2: tau2 };
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
    labelStates(state, j.out);
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
    var g = { count: 0, errors: 0, latencyCount: 0, latencySum: 0 };
    Object.keys(agg).forEach(function (k) {
      if (k.length !== 1) return;
      g.count += agg[k].count; g.errors += agg[k].errors; g.latencyCount += agg[k].latencyCount; g.latencySum += agg[k].latencySum;
    });
    return { rate: (g.errors + 1) / (g.count + 2), mu: g.latencyCount ? g.latencySum / g.latencyCount : 0 };
  }

  // Ascending order, so each parent is judged before its children.
  function judgeByOrder(state, cfg, agg, prior, day) {
    var out = {}, hypers = {}, keys = Object.keys(agg);
    for (var order = 1; order <= E.MAX_ORDER; order++) {
      var items = keys.filter(function (k) { return k.length === order; })
        .map(function (k) { return parentEstimate(state, cfg, k, order, agg, out, hypers, prior, day); });
      var hyper = hypers[order] = hyperFor(items);
      items.forEach(function (x) {
        var r = judge(x.g, x.m, x.mu, hyper, cfg);
        r.key = x.k; r.order = order; r.parent = order > 1 ? x.k.slice(1) : null;
        r.n = x.g.count; r.errors = x.g.errors; r.latN = x.g.latencyCount;
        r.rawMu = x.g.latencyCount ? x.g.latencySum / x.g.latencyCount : null; // measured mean log ratio (no shrinkage)
        if (x.redundant) { r.redundant = true; r.weak = false; r.hesitant = false; }
        if (order === 1 && state.late && state.late[x.k]) { r.lateKey = true; r.hesitant = false; }
        out[x.k] = r;
      });
    }
    return { out: out, hypers: hypers };
  }

  // The parent's estimate without this child's own data, weighted with the
  // child's weights (a comparison matched in time).
  function parentEstimate(state, cfg, k, order, agg, out, hypers, prior, day) {
    var item = { k: k, g: agg[k], m: prior.rate, mu: prior.mu, redundant: false };
    var pk = k.slice(1), pe = order > 1 && out[pk];
    if (!pe) return item;
    var pg = E.minus(E.aggregateWith(state.contexts[pk], E.weightsFor(state.contexts[k], day, cfg)), agg[k]);
    var pj = judge(pg, pe.parentErrorRate, pe.parentMu, hypers[order - 1], cfg, true);
    item.m = pj.errorRate; item.mu = pj.mu; item.redundant = pg.count < cfg.minN;
    return item;
  }

  // Sessions in which the context did worse than its parent in that same
  // session (parent without the context's own data).
  function replication(state, cfg, k, pk, globalByBucket) {
    var c = state.contexts[k], parentByKey = {};
    if (pk) state.contexts[pk].buckets.forEach(function (b) { parentByKey[E.bucketKey(b)] = b; });
    var err = 0, lat = 0;
    c.buckets.forEach(function (b) {
      if (b.count < cfg.minSessionN) return;
      var p = pk ? E.parentBucket(parentByKey, b, cfg) : globalByBucket[E.bucketKey(b)];
      if (!p) return;
      var pn = p.count - b.count, pe = p.errors - b.errors, pln = p.latencyCount - b.latencyCount, pls = p.latencySum - b.latencySum;
      if (pn > 0 && b.errors / b.count > Math.max(pe, 0) / pn) err++;
      if (b.latencyCount >= cfg.minSessionN && pln > 0 && b.latencySum / b.latencyCount > pls / pln) lat++;
    });
    return { err: err, lat: lat };
  }

  // All typing per bucket: the unigram buckets pooled.
  function globalByBucket(state) {
    var pooled = {};
    Object.keys(state.contexts).forEach(function (k) {
      if (k.length !== 1) return;
      state.contexts[k].buckets.forEach(function (b) {
        var key = E.bucketKey(b), g = pooled[key] || (pooled[key] = { count: 0, errors: 0, latencyCount: 0, latencySum: 0 });
        g.count += b.count; g.errors += b.errors; g.latencyCount += b.latencyCount; g.latencySum += b.latencySum;
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
      Object.keys(kidsByParent).forEach(function (pk) {
        var p = out[pk];
        if (!flagged(p)) return;
        var kids = kidsByParent[pk], parentWeights = E.weightsFor(state.contexts[pk], day, cfg), rest = agg[pk];
        kids.forEach(function (kk) { rest = E.minus(rest, E.aggregateWith(state.contexts[kk], parentWeights)); });
        var r = judge(rest, p.parentErrorRate, p.parentMu, hypers[order - 1], cfg);
        if (p.weak && !r.weak) { p.weak = false; p.explainedBy = kids; }
        if (p.hesitant && !r.hesitant) { p.hesitant = false; p.explainedBy = kids; }
      });
    }
  }

  function labelStates(state, out) {
    Object.keys(out).forEach(function (k) {
      var c = out[k];
      c.state = c.insufficient ? 'insufficient' : c.redundant ? 'redundant'
        : c.weak ? 'weak' : c.hesitant ? 'hesitant' : c.emerging ? 'emerging' : 'ok';
      c.stage = state.contexts[k].stage ? state.contexts[k].stage.name : null;
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
      sessions: ctx.buckets.length,
    };
  }

  FT.judgement = { evaluate: evaluate, explain: explain };
})(globalThis.FT);
