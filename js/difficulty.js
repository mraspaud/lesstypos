// Difficulty controller for the vocabulary frontier (continuous rank R).
// Dead-band staircase adapted to a ~99% target (Levitt 1971's transformed
// up-down idea; the band and steps are design choices):
//   window >= 150 relaxed-mode words, accumulated across exercises;
//   first-attempt accuracy < 98.5%  -> retreat (R / step);
//   98.5% .. 99.5%                  -> hold;
//   >= 99.5%                        -> advance (R * step) unless held by
//      hesitation rate or rhythm (CV of within-word IKI) clearly worse than
//      the median of recent windows, or perceived effort >= 4.
// No WPM criterion. Every decision is logged with its reasons.
(function (FT) {
  'use strict';
  var TUNING = { min: 100, max: 30000, windowWords: 150, low: 0.985, high: 0.995,
    step: 1.1, hesTol: 1.25, hesAbs: 0.02, rhythmTol: 1.15, effortHold: 4, baselineN: 5 };
  var START_FRONTIER = 200;

  function median(a) { return FT.timing.median(a); }

  // state: what was learned (stored in the profile); opts: { max } and tuning
  // overrides for tests.
  function create(state, opts) {
    var init = state || {};
    var cfg = Object.assign({}, TUNING, opts || {});
    var st = { frontier: init.frontier != null ? init.frontier : START_FRONTIER, manual: !!init.manual,
      history: init.history || [], windows: init.windows || [], pending: init.pending || null };

    function clamp(f) { return Math.min(Math.max(f, cfg.min), cfg.max); }
    st.frontier = clamp(st.frontier);

    function add(p, w) {
      if (!p) p = { words: 0, acc: 0, hes: 0, hesN: 0, rhy: 0, rhyN: 0, effort: null };
      var n = w.words || 0;
      p.words += n;
      p.acc += w.firstAttemptAccuracy * n;
      if (w.hesitationRate != null) { p.hes += w.hesitationRate * n; p.hesN += n; }
      if (w.rhythmCv != null) { p.rhy += w.rhythmCv * n; p.rhyN += n; }
      if (w.effort != null) p.effort = Math.max(p.effort || 0, w.effort);
      return p;
    }

    function update(w) {
      if (st.manual) return { action: 'manual', frontier: st.frontier, reasons: ['manual vocabulary selection'] };
      if (w.firstAttemptAccuracy == null) return { action: 'wait', frontier: st.frontier, reasons: ['no accuracy measured'] };
      st.pending = add(st.pending, w);
      var p = st.pending;
      if (p.words < cfg.windowWords) {
        return { action: 'wait', frontier: st.frontier, reasons: [p.words + '/' + cfg.windowWords + ' words of evidence'] };
      }
      var acc = p.acc / p.words;
      var hes = p.hesN ? p.hes / p.hesN : null, rhy = p.rhyN ? p.rhy / p.rhyN : null;
      var recent = st.windows.slice(-cfg.baselineN);
      var hesBase = median(recent.map(function (x) { return x.hes; }).filter(function (x) { return x != null; }));
      var rhyBase = median(recent.map(function (x) { return x.rhy; }).filter(function (x) { return x != null; }));
      var pct = function (x) { return (100 * x).toFixed(1) + '%'; };
      var action, reasons = [];
      if (acc < cfg.low) {
        action = 'retreat';
        reasons.push('accuracy (first try) ' + pct(acc) + ' below ' + pct(cfg.low));
      } else if (acc < cfg.high) {
        action = 'hold';
        reasons.push('accuracy (first try) ' + pct(acc) + ' within the target band');
      } else {
        action = 'advance';
        reasons.push('accuracy (first try) ' + pct(acc) + ' at or above ' + pct(cfg.high));
        if (hes != null && hesBase != null && hes > hesBase * cfg.hesTol && hes - hesBase > cfg.hesAbs) {
          action = 'hold'; reasons.push('hesitation ' + pct(hes) + ' above recent ' + pct(hesBase));
        }
        if (rhy != null && rhyBase != null && rhy > rhyBase * cfg.rhythmTol) {
          action = 'hold'; reasons.push('rhythm less even than recently (CV ' + rhy.toFixed(2) + ' vs ' + rhyBase.toFixed(2) + ')');
        }
        if (p.effort != null && p.effort >= cfg.effortHold) {
          action = 'hold'; reasons.push('perceived effort ' + p.effort + ' is high');
        }
      }
      var before = st.frontier;
      if (action === 'advance') st.frontier = clamp(st.frontier * cfg.step);
      if (action === 'retreat') st.frontier = clamp(st.frontier / cfg.step);
      st.windows.push({ hes: hes, rhy: rhy, acc: acc });
      if (st.windows.length > 50) st.windows.shift();
      var rec = { action: action, from: before, to: st.frontier, accuracy: acc, words: p.words, reasons: reasons, at: w.at || null };
      st.history.push(rec);
      if (st.history.length > 500) st.history.shift();
      st.pending = null;
      return rec;
    }

    function override(f) {
      if (f == null) { st.manual = false; return; }
      st.manual = true; st.frontier = clamp(f);
    }

    return { update: update, override: override, state: function () { return st; }, toJSON: function () { return st; } };
  }

  FT.difficulty = { create: create };
})(globalThis.FT);
