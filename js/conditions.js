// Training conditions: free tags typed once per sitting (where, which
// keyboard, hand position, state of mind), stored on the raw exercises and
// compared on relaxed practice. Measurement only: they never change training.
(function (FT) {
  'use strict';
  var SITTING_GAP_MS = 3600e3;   // design choice: an hour without typing starts a new sitting
  var MIN_EACH = 5;              // design choice: exercises needed on each side of a comparison
  var RESAMPLES = 2000;

  function parseTags(text) {
    var seen = {};
    return String(text || '').toLowerCase().split(/[\s,;]+/).map(function (w) { return w.replace(/^#+/, ''); })
      .filter(function (w) { return /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(w) && !seen[w] && (seen[w] = true); });
  }

  function lastTags(history) {
    for (var i = history.length - 1; i >= 0; i--) if (history[i].tags && history[i].tags.length) return history[i].tags;
    return [];
  }
  // For an exercise starting at `startedAt` after `history`: whether to ask
  // (a new sitting), and the tags to offer or take.
  function sittingTags(history, startedAt) {
    var prev = history[history.length - 1];
    var sameSitting = prev && startedAt - (prev.startedAt + (prev.durationMs || 0)) < SITTING_GAP_MS;
    return { ask: !sameSitting, tags: sameSitting ? (prev.tags || []) : lastTags(history) };
  }

  function timeOfDay(t) {
    var h = new Date(t).getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  }

  function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
  // Difference of means with a 95% percentile bootstrap interval
  // (Efron & Tibshirani 1993), resampling each group independently.
  function difference(a, b, rng) {
    var diffs = [];
    for (var r = 0; r < RESAMPLES; r++) {
      var ra = a.map(function () { return a[Math.floor(rng() * a.length)]; });
      var rb = b.map(function () { return b[Math.floor(rng() * b.length)]; });
      diffs.push(mean(ra) - mean(rb));
    }
    diffs.sort(function (x, y) { return x - y; });
    return { difference: mean(a) - mean(b), low: diffs[Math.floor(0.025 * RESAMPLES)], high: diffs[Math.ceil(0.975 * RESAMPLES) - 1] };
  }
  // Each tag (and time of day) against the relaxed exercises without it.
  function compare(history) {
    var rel = history.filter(FT.history.isComparableRelaxed);
    var conditions = {};
    rel.forEach(function (h) {
      (h.tags || []).forEach(function (t) { conditions[t] = conditions[t] || { tag: t, automatic: false }; });
      var d = timeOfDay(h.startedAt);
      conditions[d] = conditions[d] || { tag: d, automatic: true };
    });
    var has = function (h, c) { return c.automatic ? timeOfDay(h.startedAt) === c.tag : (h.tags || []).indexOf(c.tag) >= 0; };
    return Object.keys(conditions).map(function (k) {
      var c = conditions[k], yes = rel.filter(function (h) { return has(h, c); }), no = rel.filter(function (h) { return !has(h, c); });
      if (yes.length < MIN_EACH || no.length < MIN_EACH) return null;
      var rng = FT.rng(k.length * 7919 + yes.length);
      var pick = function (list, f) { return list.map(function (h) { return h[f]; }); };
      return { tag: c.tag, automatic: c.automatic, with: { n: yes.length }, without: { n: no.length },
        wpm: difference(pick(yes, 'wpm'), pick(no, 'wpm'), rng),
        accuracy: difference(pick(yes, 'firstAttemptAccuracy'), pick(no, 'firstAttemptAccuracy'), rng) };
    }).filter(Boolean);
  }

  FT.conditions = { parseTags: parseTags, lastTags: lastTags, sittingTags: sittingTags, timeOfDay: timeOfDay, compare: compare, MIN_EACH: MIN_EACH };
})(globalThis.FT);
