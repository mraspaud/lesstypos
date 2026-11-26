// Training conditions: free tags typed once per sitting (where, which
// keyboard, hand position, state of mind), stored on the raw exercises and
// compared on relaxed practice. Measurement only: they never change training.
(function (FT) {
  'use strict';
  var SITTING_GAP_MS = 3600e3;   // design choice: an hour without typing starts a new sitting
  var MIN_EACH = 5;              // design choice: exercises needed on each side of a comparison
  var RESAMPLES = 2000, CONFIDENCE = 0.95;

  var TAG = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
  function isTag(t) { return typeof t === 'string' && TAG.test(t) && t === t.toLowerCase(); }
  function unique(tags) {
    var seen = {};
    return tags.filter(function (t) { return !seen[t] && (seen[t] = true); });
  }
  function parseTags(text) {
    return unique(String(text || '').toLowerCase().split(/[\s,;]+/).map(function (w) { return w.replace(/^#+/, ''); }).filter(isTag));
  }
  // The well-formed tags of a stored list, each once (anything else: none).
  function cleanTags(tags) { return Array.isArray(tags) ? unique(tags.filter(isTag)) : []; }

  function lastTags(history) {
    for (var i = history.length - 1; i >= 0; i--) if (history[i].tags && history[i].tags.length) return history[i].tags;
    return [];
  }
  // When an exercise ended on the wall clock (pauses included); an entry
  // recorded before that was kept ends at its start plus its typing time.
  function endOf(h) { return h.endedAt != null ? h.endedAt : h.startedAt + (h.durationMs || 0); }
  // Benchmark trials are measurement only: they belong to no sitting.
  function lastOfSitting(history) {
    for (var i = history.length - 1; i >= 0; i--) if (history[i].type !== 'benchmark') return history[i];
    return null;
  }
  // The ids of the sitting that ends with exercise `id`: it and the
  // exercises before it, each ending less than an hour before the next began.
  function sittingOf(history, id) {
    var i = history.findIndex(function (h) { return h.id === id; });
    if (i < 0) return [];
    var ids = [id], next = history[i];
    for (var j = i - 1; j >= 0; j--) {
      var h = history[j];
      if (h.type === 'benchmark') continue;
      if (next.startedAt - endOf(h) >= SITTING_GAP_MS) break;
      ids.unshift(h.id);
      next = h;
    }
    return ids;
  }
  // For an exercise starting at `startedAt` after `history`: whether to ask
  // (a new sitting), and the tags to offer or take.
  function sittingTags(history, startedAt) {
    var prev = lastOfSitting(history);
    var sameSitting = prev && startedAt - endOf(prev) < SITTING_GAP_MS;
    return { ask: !sameSitting, tags: sameSitting ? (prev.tags || []) : lastTags(history) };
  }

  // Design choice: the afternoon runs from noon to 6 pm, local time.
  var AFTERNOON_FROM = 12, EVENING_FROM = 18;
  function timeOfDay(t) {
    var hour = new Date(t).getHours();
    return hour < AFTERNOON_FROM ? 'morning' : hour < EVENING_FROM ? 'afternoon' : 'evening';
  }

  function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
  // Difference of means with a CONFIDENCE percentile bootstrap interval
  // (Efron & Tibshirani 1993), resampling each group independently.
  function difference(a, b, rng) {
    var diffs = [];
    for (var r = 0; r < RESAMPLES; r++) {
      var ra = a.map(function () { return a[Math.floor(rng() * a.length)]; });
      var rb = b.map(function () { return b[Math.floor(rng() * b.length)]; });
      diffs.push(mean(ra) - mean(rb));
    }
    diffs.sort(function (x, y) { return x - y; });
    var tail = (1 - CONFIDENCE) / 2;
    return { difference: mean(a) - mean(b), low: diffs[Math.floor(tail * RESAMPLES)], high: diffs[Math.ceil((1 - tail) * RESAMPLES) - 1] };
  }
  // Each tag (and time of day) against the relaxed exercises without it.
  // Keyed 'tag:<name>' and 'time:<time of day>', so a tag may share a name
  // with a time of day.
  function compare(history) {
    var relaxed = history.filter(FT.history.isComparableRelaxed);
    var conditions = {};
    var add = function (tag, automatic) {
      var key = (automatic ? 'time:' : 'tag:') + tag;
      conditions[key] = conditions[key] || { key: key, tag: tag, automatic: automatic };
    };
    relaxed.forEach(function (h) {
      (h.tags || []).forEach(function (t) { add(t, false); });
      add(timeOfDay(h.startedAt), true);
    });
    var has = function (h, condition) { return condition.automatic ? timeOfDay(h.startedAt) === condition.tag : (h.tags || []).indexOf(condition.tag) >= 0; };
    return Object.keys(conditions).map(function (key) {
      var condition = conditions[key];
      var withIt = relaxed.filter(function (h) { return has(h, condition); }), without = relaxed.filter(function (h) { return !has(h, condition); });
      if (withIt.length < MIN_EACH || without.length < MIN_EACH) return null;
      var rng = FT.rng(key.length * 7919 + withIt.length);   // seeded, so the page shows the same interval each time
      var pick = function (list, field) { return list.map(function (h) { return h[field]; }); };
      return { key: condition.key, tag: condition.tag, automatic: condition.automatic, with: { n: withIt.length }, without: { n: without.length },
        wpm: difference(pick(withIt, 'wpm'), pick(without, 'wpm'), rng),
        accuracy: difference(pick(withIt, 'firstAttemptAccuracy'), pick(without, 'firstAttemptAccuracy'), rng) };
    }).filter(Boolean);
  }

  FT.conditions = { isTag: isTag, parseTags: parseTags, cleanTags: cleanTags, lastTags: lastTags, sittingTags: sittingTags, sittingOf: sittingOf, timeOfDay: timeOfDay, compare: compare, MIN_EACH: MIN_EACH, CONFIDENCE: CONFIDENCE };
})(globalThis.FT);
