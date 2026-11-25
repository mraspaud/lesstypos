// LessTypos core namespace. Classic script (works from file://).
(function (g) {
  'use strict';
  var FT = (g.FT = g.FT || {});
  FT.version = '0.1.0';
  FT.SCHEMA = 1;
  // Bump when derived statistics change meaning; profiles are then rebuilt
  // from the raw sessions (the source of truth).
  FT.MODEL_VERSION = 3; // 3: a session is a programme run
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
