// Sequence model: which typing contexts are genuinely weak (error-prone) or
// hesitant (slow), judged against their backoff parent.
//
// Context: the 1..4 characters ending at a target character (spaces included).
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
// Recency (design choices): each session bucket is weighted by
//  (a) exposure decay 0.5^(later observations of this context / halfLifeObs),
//      in the spirit of keybr's per-lesson exponential smoothing: recent
//      performance dominates once enough new evidence exists, and a context
//      that is not practised does not decay (time off does not erase mastery);
//  (b) a mild FSRS-shaped power-law decay of age in days (stats.recencyWeight).
// Redundancy (design choice): a child whose parent has (almost) no data
// besides the child's own is not judged separately; it carries no information
// beyond its parent and must not explain the parent away.
(function (FT) {
  'use strict';
  var S = FT.stats;
  var MAX_ORDER = 4;
  var DEFAULTS = {
    stabilityDays: 30, halfLifeObs: 60, minN: 8, pFlag: 0.95, minErrAbs: 0.005, minErrRel: 1.25,
    minLatRel: 1.10, maxExamples: 12,
  };

  function create(opts, state) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var st = state || { contexts: {}, sessions: 0, lastDay: 0 };

    function ctxOf(key) {
      return st.contexts[key] || (st.contexts[key] = { b: [], ex: [], stage: null });
    }

    function keysFor(rec) {
      var full = (rec.ctx || '') + rec.ch;
      var out = [];
      for (var k = 1; k <= MAX_ORDER && k <= full.length; k++) out.push(full.slice(-k));
      return out;
    }

    // Ingest one session's timing records.
    function ingest(records, meta) {
      var session = meta.session, day = meta.day;
      var acc = {};
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.t === null) continue;
        var keys = keysFor(r);
        for (var j = 0; j < keys.length; j++) {
          var a = acc[keys[j]] || (acc[keys[j]] = { n: 0, e: 0, lat: [], words: {} });
          a.n++; a.e += r.err;
          if (r.clean && r.logRatio != null && isFinite(r.logRatio)) a.lat.push(r.logRatio);
          if (r.word) a.words[r.word] = true;
        }
      }
      Object.keys(acc).forEach(function (key) {
        var a = acc[key];
        // Outlier trimming per context per session (Van Selst & Jolicoeur 1994)
        // on the ratio scale, then sufficient statistics on the log scale.
        var lat = a.lat;
        if (lat.length >= 4) {
          var kept = S.vjTrim(lat.map(Math.exp)).map(Math.log);
          lat = kept;
        }
        var ls = 0, lss = 0;
        for (var q = 0; q < lat.length; q++) { ls += lat[q]; lss += lat[q] * lat[q]; }
        var c = ctxOf(key);
        var words = Object.keys(a.words);
        c.b.push({ s: session, d: day, n: a.n, e: a.e, ln: lat.length, ls: ls, lss: lss, wd: words.length });
        for (var x = 0; x < words.length; x++) {
          var idx = c.ex.indexOf(words[x]);
          if (idx >= 0) c.ex.splice(idx, 1);
          c.ex.push(words[x]);
        }
        if (c.ex.length > cfg.maxExamples) c.ex.splice(0, c.ex.length - cfg.maxExamples);
      });
      st.sessions = Math.max(st.sessions, session);
      st.lastDay = Math.max(st.lastDay, day);
    }

    function aggregate(c, day) {
      var g = { n: 0, e: 0, ln: 0, ls: 0, lss: 0 };
      var later = 0;
      for (var i = c.b.length - 1; i >= 0; i--) {
        var b = c.b[i];
        var w = Math.pow(0.5, later / cfg.halfLifeObs) * S.recencyWeight(day - b.d, cfg.stabilityDays);
        later += b.n;
        g.n += w * b.n; g.e += w * b.e; g.ln += w * b.ln; g.ls += w * b.ls; g.lss += w * b.lss;
      }
      return g;
    }
    function minus(a, b) {
      return { n: Math.max(a.n - b.n, 0), e: Math.max(a.e - b.e, 0), ln: Math.max(a.ln - b.ln, 0),
        ls: a.ls - b.ls, lss: a.lss - b.lss };
    }

    // Judge one context's aggregate g against a parent aggregate (excluding g).
    function judge(g, parentRate, parentMu, hyper) {
      var kappa = hyper.kappa, m = Math.min(Math.max(parentRate, 1e-4), 0.5);
      var a = kappa * m + g.e, b = kappa * (1 - m) + (g.n - g.e);
      var rate = a / (a + b);
      var pWorse = 1 - S.betaCdf(m, a, b);
      var sigma2 = hyper.sigma2, tau2 = hyper.tau2;
      var prec = 1 / tau2 + g.ln / sigma2;
      var mu = (parentMu / tau2 + g.ls / sigma2) / prec;
      var sd = Math.sqrt(1 / prec);
      var pSlower = g.ln > 0 ? S.normCdf((mu - parentMu) / sd) : 0.5;
      var insufficient = g.n < cfg.minN;
      var weak = !insufficient && pWorse > cfg.pFlag && rate - m >= cfg.minErrAbs && rate / m >= cfg.minErrRel;
      var latRel = Math.exp(mu - parentMu);
      var hesitant = g.ln >= cfg.minN && pSlower > cfg.pFlag && latRel >= cfg.minLatRel;
      return { errorRate: rate, parentErrorRate: m, pWorse: pWorse, mu: mu, muSd: sd, parentMu: parentMu,
        latRel: latRel, pSlower: pSlower, weak: weak, hesitant: hesitant, insufficient: insufficient };
    }

    // Method-of-moments hyperparameters per order.
    function hyperFor(items) {
      // items: [{g, m, mu}] with parent rate m and parent mean mu
      var big = items.filter(function (x) { return x.g.n >= 30; });
      var kappa = 200;
      if (big.length >= 5) {
        var V = 0, B = 0, Q = 0;
        big.forEach(function (x) {
          var r = x.g.e / x.g.n, m = Math.max(x.m, 1e-4);
          V += (r - m) * (r - m); B += m * (1 - m) / x.g.n; Q += m * (1 - m);
        });
        V /= big.length; B /= big.length; Q /= big.length;
        kappa = V - B > 1e-9 ? Q / (V - B) - 1 : 2000;
      }
      kappa = Math.min(Math.max(kappa, 20), 2000);
      var num = 0, den = 0;
      items.forEach(function (x) {
        if (x.g.ln >= 2) { num += x.g.lss - x.g.ls * x.g.ls / x.g.ln; den += x.g.ln - 1; }
      });
      var sigma2 = den > 0 ? Math.max(num / den, 1e-3) : 0.1;
      var lat = items.filter(function (x) { return x.g.ln >= 10; });
      var tau2 = 0.05;
      if (lat.length >= 5) {
        var D = 0, E = 0;
        lat.forEach(function (x) { var d = x.g.ls / x.g.ln - x.mu; D += d * d; E += sigma2 / x.g.ln; });
        tau2 = (D - E) / lat.length;
      }
      tau2 = Math.min(Math.max(tau2, 0.0025), 0.5);
      return { kappa: kappa, sigma2: sigma2, tau2: tau2 };
    }

    function evaluate(when) {
      var day = when && when.day != null ? when.day : st.lastDay;
      var keys = Object.keys(st.contexts);
      var agg = {};
      keys.forEach(function (k) { agg[k] = aggregate(st.contexts[k], day); });
      var global = { n: 0, e: 0, ln: 0, ls: 0, lss: 0 };
      keys.forEach(function (k) {
        if (k.length !== 1) return;
        var g = agg[k];
        global.n += g.n; global.e += g.e; global.ln += g.ln; global.ls += g.ls; global.lss += g.lss;
      });
      var gRate = (global.e + 1) / (global.n + 2);
      var gMu = global.ln ? global.ls / global.ln : 0;
      var out = {};
      var hypers = {};
      // ascending order: parents are evaluated first
      for (var order = 1; order <= MAX_ORDER; order++) {
        var ks = keys.filter(function (k) { return k.length === order; });
        var items = ks.map(function (k) {
          var pRate = gRate, pMu = gMu, redundant = false;
          if (order > 1) {
            var pk = k.slice(1), pe = out[pk];
            if (pe) {
              // parent's estimate without this child's own data
              var pg = minus(agg[pk], agg[k]);
              redundant = pg.n < cfg.minN;
              var hp = hypers[order - 1];
              var pj = judge(pg, pe.parentErrorRate, pe.parentMu, hp);
              pRate = pj.errorRate; pMu = pj.mu;
            }
          }
          return { k: k, g: agg[k], m: pRate, mu: pMu, redundant: redundant };
        });
        var hyper = hypers[order] = hyperFor(items);
        items.forEach(function (x) {
          var j = judge(x.g, x.m, x.mu, hyper);
          j.key = x.k; j.order = order; j.parent = order > 1 ? x.k.slice(1) : null;
          j.n = x.g.n; j.errors = x.g.e; j.latN = x.g.ln;
          if (x.redundant) { j.redundant = true; j.weak = false; j.hesitant = false; }
          out[x.k] = j;
        });
      }
      // Explaining away, highest order first.
      for (order = MAX_ORDER; order >= 2; order--) {
        Object.keys(out).forEach(function (k) {
          var c = out[k];
          if (c.order !== order || !(c.weak || c.hesitant)) return;
          var p = out[c.parent];
          if (!p || !(p.weak || p.hesitant)) return;
          var flaggedKids = Object.keys(out).filter(function (kk) {
            var x = out[kk];
            return x.order === order && x.parent === c.parent && (x.weak || x.hesitant);
          });
          var rest = agg[c.parent];
          flaggedKids.forEach(function (kk) { rest = minus(rest, agg[kk]); });
          var r = judge(rest, p.parentErrorRate, p.parentMu, hypers[order - 1]);
          if (p.weak && !r.weak) { p.weak = false; p.explainedBy = flaggedKids; }
          if (p.hesitant && !r.hesitant) { p.hesitant = false; p.explainedBy = flaggedKids; }
        });
      }
      Object.keys(out).forEach(function (k) {
        var c = out[k];
        c.state = c.insufficient ? 'insufficient' : c.redundant ? 'redundant'
          : c.weak ? 'weak' : c.hesitant ? 'hesitant' : 'ok';
        c.stage = st.contexts[k].stage ? st.contexts[k].stage.name : null;
      });
      return { get: function (k) { return out[k]; }, all: out, hyper: hypers, global: { rate: gRate, mu: gMu } };
    }

    function explain(key, when) {
      var ev = evaluate(when);
      var c = ev.get(key);
      var ctx = st.contexts[key];
      if (!c) return null;
      return {
        key: key, parent: c.parent, order: c.order, state: c.state, stage: ctx.stage,
        n: c.n, errors: c.errors, errorRate: c.errorRate, parentErrorRate: c.parentErrorRate, pWorse: c.pWorse,
        latency: { n: c.latN, ratio: Math.exp(c.mu), parentRatio: Math.exp(c.parentMu), relative: c.latRel, pSlower: c.pSlower },
        explainedBy: c.explainedBy || null, redundant: !!c.redundant,
        examples: ctx.ex.slice().reverse(),
        sessions: ctx.b.length,
      };
    }

    return {
      ingest: ingest, evaluate: evaluate, explain: explain, config: cfg,
      state: function () { return st; },
      toJSON: function () { return { cfg: cfg, state: st }; },
    };
  }

  function fromJSON(j) { return create(j.cfg, j.state); }

  FT.model = { create: create, fromJSON: fromJSON, MAX_ORDER: MAX_ORDER };
})(globalThis.FT);
