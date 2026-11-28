// LessTypos core namespace. Classic script (works from file://).
(function (g) {
  'use strict';
  var FT = (g.FT = g.FT || {});
  FT.version = '0.1.0';
  FT.SCHEMA = 2; // 2: sessions stored and exported compactly (FT.codec)
  // Bump when derived statistics change meaning; profiles are then rebuilt
  // from the raw sessions (the source of truth).
  FT.valueOr = function (value, fallback) { return value != null ? value : fallback; };
  FT.MODEL_VERSION = 23; // 3: a session is a programme run; 4: progress fields in history; 5: one wrong press = one error; 6: simultaneous pairs and late keys; 7: transpositions; 8: rebuilt from compact sessions (0.01 ms), compact model; 9: timing centred on the mean log per population; 10: on trimmed intervals; 11: compacted blocks weighed alike in parent and child; 12: first-word speed, difficulty state without tuning, hesitation up to order 4; 13: history keeps the vocabulary decision and burst rounds; 14: history entries with descriptive field names; 15: history entries keep their daily-training run; 16: replication and session counts survive compaction, model settings no longer stored; 17: history keeps the session centres and the experimental fluency index; 18: the fluency index on arithmetic means with measured error costs (history keeps meanMs, errorCostMs, correctionMs); 19: the fluency index scales on the pace within each context, pools the error cost and adds pauses (history keeps paceMs, correctionMs clamped at 0, errors, pauseMs, presses, fluencyKeys; no more centreMs, meanMs, errorCostMs); 20: the vocabulary decided on unbiased words only, the less common against the 100 most common, pooled and credible (difficulty keeps pool and easiest; decisions keep reference); 21: the vocabulary on an error-ratio band (difficulty keeps the words of its pools with their ranks and weights, a recency-weighted reference, conditions weighed by each exercise's words); 22: one pool of exercises for the less common and the easiest words, weighed alike (difficulty keeps no separate reference); 23: the easiest words apart again, as one tally per exercise at full weight, reaching back beyond the pool of less common words (now up to 2,000) when it holds fewer than 500 (difficulty keeps easiest)
  // Seedable PRNG (mulberry32) so generators are reproducible in tests.
  FT.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
