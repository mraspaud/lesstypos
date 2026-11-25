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
// Replication (design choice, user decision): a context is flagged only when
// the deficit also shows in at least `minSessions` separate sessions (each with
// >= minSessionN observations, compared with the parent in the same session).
// Credible but unreplicated deficits are reported as 'emerging'.
// Late keys (design choice): a key the keyboard sends late (timing.lateKeys)
// has shifted timestamps. Its longer contexts are judged against a parent
// ending on the same key, so the shift cancels; the single key is judged
// against all keys, so its latency is not judged (lateKey). Errors are. The
// verdict per key comes from the latest session with enough presses of it.
// Redundancy (design choice): a child whose parent has (almost) no data
// besides the child's own is not judged separately; it carries no information
// beyond its parent and must not explain the parent away.
(function (FT) {
  'use strict';
  var S = FT.stats;
  var MAX_ORDER = 4;
  var DEFAULTS = {
    stabilityDays: 30, halfLifeObs: 60, minN: 8, minSessions: 2, minSessionN: 3, pFlag: 0.95, minErrAbs: 0.005, minErrRel: 1.25,
    minLatRel: 1.10, maxExamples: 12, exactSessions: 24, block: 8,
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
      if (meta.late) {
        var lateNow = {};
        meta.late.chars.forEach(function (ch) { lateNow[ch] = true; });
        st.late = st.late || {};
        meta.late.judged.forEach(function (ch) { if (lateNow[ch]) st.late[ch] = true; else delete st.late[ch]; });
      }
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
        var last = c.b[c.b.length - 1];
        if (last && last.s === session && last.blk == null) {
          // another exercise of the same session (programme run): one bucket
          last.d = day; last.n += a.n; last.e += a.e; last.ln += lat.length; last.ls += ls; last.lss += lss;
          last.wd = Math.max(last.wd, words.length);
        } else {
          c.b.push({ s: session, d: day, n: a.n, e: a.e, ln: lat.length, ls: ls, lss: lss, wd: words.length });
        }
        for (var x = 0; x < words.length; x++) {
          var idx = c.ex.indexOf(words[x]);
          if (idx >= 0) c.ex.splice(idx, 1);
          c.ex.push(words[x]);
        }
        if (c.ex.length > cfg.maxExamples) c.ex.splice(0, c.ex.length - cfg.maxExamples);
        compact(c, session);
      });
      st.sessions = Math.max(st.sessions, session);
      st.lastDay = Math.max(st.lastDay, day);
    }

    // Buckets older than the newest `exactSessions` sessions are merged into
    // fixed session blocks shared by all contexts, so parent and child buckets
    // stay aligned. A merged bucket takes the n-weighted mean session and day.
    function compact(c, session) {
      var cutoff = session - cfg.exactSessions, out = [], cur = null, curBlock = null;
      for (var i = 0; i < c.b.length; i++) {
        var x = c.b[i];
        if (x.s > cutoff) { if (cur) { out.push(cur); cur = null; } out.push(x); continue; }
        var blk = Math.floor((x.s - 1) / cfg.block);
        if (cur && curBlock === blk) {
          var n = cur.n + x.n || 1;
          cur.s = (cur.s * cur.n + x.s * x.n) / n; cur.d = (cur.d * cur.n + x.d * x.n) / n;
          cur.n += x.n; cur.e += x.e; cur.ln += x.ln; cur.ls += x.ls; cur.lss += x.lss;
          cur.wd = Math.max(cur.wd, x.wd); cur.blk = blk;
        } else {
          if (cur) out.push(cur);
          cur = Object.assign({}, x, { blk: blk }); curBlock = blk;
        }
      }
      if (cur) out.push(cur);
      c.b = out;
    }

    // Weight of evidence at (session s, day d) from the point of view of
    // context c: exposure decay by c's own later observations, times the
    // FSRS-shaped day decay.
    function weightFn(c, day) {
      var bs = c.b;
      return function (b) {
        // observations of c strictly after session b.s
        var l = 0;
        for (var j = bs.length - 1; j >= 0 && bs[j].s > b.s; j--) l += bs[j].n;
        return Math.pow(0.5, l / cfg.halfLifeObs) * S.recencyWeight(day - b.d, cfg.stabilityDays);
      };
    }
    function aggregateUsing(c, wfn) {
      var g = { n: 0, e: 0, ln: 0, ls: 0, lss: 0 };
      for (var i = 0; i < c.b.length; i++) {
        var b = c.b[i], w = wfn(b);
        g.n += w * b.n; g.e += w * b.e; g.ln += w * b.ln; g.ls += w * b.ls; g.lss += w * b.lss;
      }
      return g;
    }

    function aggregate(c, day) { return aggregateUsing(c, weightFn(c, day)); }
    function minus(a, b) {
      return { n: Math.max(a.n - b.n, 0), e: Math.max(a.e - b.e, 0), ln: Math.max(a.ln - b.ln, 0),
        ls: a.ls - b.ls, lss: a.lss - b.lss };
    }

    // Judge one context's aggregate g against a parent aggregate (excluding g).
    function judge(g, parentRate, parentMu, hyper, meansOnly) {
      var kappa = hyper.kappa, m = Math.min(Math.max(parentRate, 1e-4), 0.5);
      var a = kappa * m + g.e, b = kappa * (1 - m) + (g.n - g.e);
      var rate = a / (a + b);
      var sigma2 = hyper.sigma2, tau2 = hyper.tau2;
      var prec = 1 / tau2 + g.ln / sigma2;
      var mu = (parentMu / tau2 + g.ls / sigma2) / prec;
      if (meansOnly) return { errorRate: rate, mu: mu };
      var pWorse = 1 - S.betaCdf(m, a, b);
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

    function bkey(b) { return b.blk != null ? 'B' + b.blk : 'S' + b.s; }
    // Sessions in which the context did worse than its parent in that same
    // session (parent without the context's own data).
    function replication(k, pk, globalBy) {
      var c = st.contexts[k], pmap = {};
      if (pk) st.contexts[pk].b.forEach(function (b) { pmap[bkey(b)] = b; });
      var err = 0, lat = 0;
      c.b.forEach(function (b) {
        if (b.n < cfg.minSessionN) return;
        var p = pk ? (pmap[bkey(b)] || pmap['B' + Math.floor((b.s - 1) / cfg.block)]) : globalBy[bkey(b)];
        if (!p) return;
        var pn = p.n - b.n, pe = p.e - b.e, pln = p.ln - b.ln, pls = p.ls - b.ls;
        if (pn > 0 && b.e / b.n > Math.max(pe, 0) / pn) err++;
        if (b.ln >= cfg.minSessionN && pln > 0 && b.ls / b.ln > pls / pln) lat++;
      });
      return { err: err, lat: lat };
    }

    // Judgement of every context, in steps:
    //   aggregate evidence -> global prior -> judge each order against its
    //   parent -> confirm across sessions -> explain parents away -> label.
    function evaluate(when) {
      var day = when && when.day != null ? when.day : st.lastDay;
      var agg = aggregateAll(day);
      var prior = globalPrior(agg);
      var j = judgeByOrder(agg, prior, day);
      confirmAcrossSessions(j.out);
      explainAway(j.out, agg, j.hypers, day);
      labelStates(j.out);
      return { get: function (k) { return j.out[k]; }, all: j.out, hyper: j.hypers, global: prior,
        late: Object.keys(st.late || {}).sort() };
    }

    function aggregateAll(day) {
      var agg = {};
      Object.keys(st.contexts).forEach(function (k) { agg[k] = aggregate(st.contexts[k], day); });
      return agg;
    }

    // Unigrams are judged against all typing: the pooled unigram evidence.
    function globalPrior(agg) {
      var g = { n: 0, e: 0, ln: 0, ls: 0 };
      Object.keys(agg).forEach(function (k) {
        if (k.length !== 1) return;
        g.n += agg[k].n; g.e += agg[k].e; g.ln += agg[k].ln; g.ls += agg[k].ls;
      });
      return { rate: (g.e + 1) / (g.n + 2), mu: g.ln ? g.ls / g.ln : 0 };
    }

    // Ascending order, so each parent is judged before its children.
    function judgeByOrder(agg, prior, day) {
      var out = {}, hypers = {}, keys = Object.keys(agg);
      for (var order = 1; order <= MAX_ORDER; order++) {
        var items = keys.filter(function (k) { return k.length === order; })
          .map(function (k) { return parentEstimate(k, order, agg, out, hypers, prior, day); });
        var hyper = hypers[order] = hyperFor(items);
        items.forEach(function (x) {
          var r = judge(x.g, x.m, x.mu, hyper);
          r.key = x.k; r.order = order; r.parent = order > 1 ? x.k.slice(1) : null;
          r.n = x.g.n; r.errors = x.g.e; r.latN = x.g.ln;
          r.rawMu = x.g.ln ? x.g.ls / x.g.ln : null; // measured mean log ratio (no shrinkage)
          if (x.redundant) { r.redundant = true; r.weak = false; r.hesitant = false; }
          if (order === 1 && st.late && st.late[x.k]) { r.lateKey = true; r.hesitant = false; }
          out[x.k] = r;
        });
      }
      return { out: out, hypers: hypers };
    }

    // The parent's estimate without this child's own data, weighted with the
    // child's weights (a comparison matched in time).
    function parentEstimate(k, order, agg, out, hypers, prior, day) {
      var item = { k: k, g: agg[k], m: prior.rate, mu: prior.mu, redundant: false };
      var pk = k.slice(1), pe = order > 1 && out[pk];
      if (!pe) return item;
      var pg = minus(aggregateUsing(st.contexts[pk], weightFn(st.contexts[k], day)), agg[k]);
      var pj = judge(pg, pe.parentErrorRate, pe.parentMu, hypers[order - 1], true);
      item.m = pj.errorRate; item.mu = pj.mu; item.redundant = pg.n < cfg.minN;
      return item;
    }

    function confirmAcrossSessions(out) {
      var globalBy = {};
      Object.keys(st.contexts).forEach(function (k) {
        if (k.length !== 1) return;
        st.contexts[k].b.forEach(function (b) {
          var g = globalBy[bkey(b)] || (globalBy[bkey(b)] = { n: 0, e: 0, ln: 0, ls: 0 });
          g.n += b.n; g.e += b.e; g.ln += b.ln; g.ls += b.ls;
        });
      });
      Object.keys(out).forEach(function (k) {
        var c = out[k];
        if (!(c.weak || c.hesitant)) { c.errSessions = c.latSessions = null; return; }
        var r = replication(k, c.parent, globalBy);
        c.errSessions = r.err; c.latSessions = r.lat;
        var w = c.weak && r.err >= cfg.minSessions, h = c.hesitant && r.lat >= cfg.minSessions;
        if ((c.weak && !w) || (c.hesitant && !h)) c.emerging = !(w || h);
        c.weak = w; c.hesitant = h;
      });
    }

    // A flagged parent whose deficit is accounted for by its flagged children
    // is not flagged itself. Highest order first.
    function explainAway(out, agg, hypers, day) {
      var flagged = function (c) { return c && (c.weak || c.hesitant); };
      for (var order = MAX_ORDER; order >= 2; order--) {
        var kidsByParent = {};
        Object.keys(out).forEach(function (k) {
          var c = out[k];
          if (c.order === order && flagged(c)) (kidsByParent[c.parent] = kidsByParent[c.parent] || []).push(k);
        });
        Object.keys(kidsByParent).forEach(function (pk) {
          var p = out[pk];
          if (!flagged(p)) return;
          var kids = kidsByParent[pk], pw = weightFn(st.contexts[pk], day), rest = agg[pk];
          kids.forEach(function (kk) { rest = minus(rest, aggregateUsing(st.contexts[kk], pw)); });
          var r = judge(rest, p.parentErrorRate, p.parentMu, hypers[order - 1]);
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
        c.stage = st.contexts[k].stage ? st.contexts[k].stage.name : null;
      });
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
        explainedBy: c.explainedBy || null, redundant: !!c.redundant, lateKey: !!c.lateKey,
        sessionsWithDeficit: Math.max(c.errSessions || 0, c.latSessions || 0),
        errorSessions: c.errSessions, latencySessions: c.latSessions, minSessions: cfg.minSessions,
        examples: ctx.ex.slice().reverse(),
        sessions: ctx.b.length,
      };
    }

    // Update consolidation stages after a training session, using the overall
    // judgement plus this session's own observations of each context.
    function endSession(meta) {
      var ev = evaluate({ day: meta.day });
      var changes = [];
      Object.keys(st.contexts).forEach(function (k) {
        var c = st.contexts[k], j = ev.get(k);
        if (!j) return;
        var local = { n: 0, wd: 0 };
        for (var i = 0; i < c.b.length; i++) if (c.b[i].s === meta.session) { local.n += c.b[i].n; local.wd += c.b[i].wd; }
        if (!c.stage && !(j.weak || j.hesitant)) return;
        var usable = !j.insufficient && !j.redundant;
        var suspect = usable && (
          (j.pWorse > 0.8 && j.errorRate - j.parentErrorRate >= cfg.minErrAbs / 2) ||
          (j.pSlower > 0.8 && j.latRel >= 1 + (cfg.minLatRel - 1) / 2));
        var nx = nextStage(c.stage, { flagged: j.weak || j.hesitant, suspect: suspect,
          localN: local.n, localWords: local.wd, session: meta.session }, cfg);
        var from = c.stage ? c.stage.name : null, to = nx ? nx.name : null;
        if (from !== to) changes.push({ key: k, from: from, to: to, reason: j.state });
        c.stage = nx;
      });
      return changes;
    }

    // Contexts to practise now, by priority = demand(stage) x (1 + excess cost) x frequency weight.
    function trainingTargets(when) {
      var ev = evaluate({ day: when.day });
      var freq = when.freq || function () { return 1; };
      var out = [];
      Object.keys(st.contexts).forEach(function (k) {
        var c = st.contexts[k];
        var d = demand(c.stage, when.session);
        if (!d) return;
        var j = ev.get(k);
        var excess = Math.max(0, j.errorRate / j.parentErrorRate - 1, j.latRel - 1);
        out.push({ key: k, stage: c.stage.name, due: c.stage.name === 'consolidating' || c.stage.name === 'mastered',
          state: j.state, priority: d * (1 + excess) * freq(k), excess: excess });
      });
      out.sort(function (a, b) { return b.priority - a.priority; });
      return out;
    }

    return {
      ingest: ingest, evaluate: evaluate, explain: explain, config: cfg,
      endSession: endSession, trainingTargets: trainingTargets,
      state: function () { return st; },
      toJSON: function () { return { cfg: cfg, state: st }; },
    };
  }

  function fromJSON(j) { return create(j.cfg, j.state); }

  // Stage machine (design choice, in the spirit of spaced repetition).
  // obs: { flagged, suspect, localN, localWords, session }
  var STAGE_CFG = { reviewN: 10, reviewWords: 3, masteredInterval: 8 };
  function nextStage(stage, obs, cfg) {
    var c = Object.assign({}, STAGE_CFG, cfg && cfg.stages);
    var name = stage ? stage.name : null;
    if (obs.flagged) {
      if (name === 'weak') return stage;
      var out = { name: 'weak' };
      if (name === 'consolidating' || name === 'mastered' || (stage && stage.regressed)) out.regressed = true;
      return out;
    }
    if (!stage) return null;
    var reviewed = obs.localN >= c.reviewN && obs.localWords >= c.reviewWords;
    if (name === 'weak') {
      if (obs.suspect) return stage;
      var imp = { name: 'improving' };
      if (stage.regressed) imp.regressed = true;
      return imp;
    }
    if (name === 'improving') {
      if (!reviewed || obs.suspect) return stage;
      return { name: 'consolidating', interval: 1, due: obs.session + 1 };
    }
    // consolidating / mastered
    if (obs.session < stage.due || !reviewed) return stage;
    if (obs.suspect) return { name: 'improving', regressed: true };
    var interval = stage.interval * 2;
    return { name: interval >= c.masteredInterval ? 'mastered' : 'consolidating', interval: interval, due: obs.session + interval };
  }

  var DEMAND = { weak: 1, improving: 0.6, consolidating: 0.3, mastered: 0.15 };
  function demand(stage, session) {
    if (!stage) return 0;
    if ((stage.name === 'consolidating' || stage.name === 'mastered') && session < stage.due) return 0;
    return DEMAND[stage.name] || 0;
  }

  FT.model = { create: create, fromJSON: fromJSON, MAX_ORDER: MAX_ORDER, nextStage: nextStage, demand: demand };
})(globalThis.FT);
