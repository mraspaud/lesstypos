// Compact storage of raw sessions.
// Timestamps are kept at 0.01 ms (design choice: browsers already coarsen
// performance.now() to 0.1 ms or 1 ms), which makes the encoding exact.
(function (FT) {
  'use strict';
  var STEP = 100; // steps per millisecond

  function roundTime(t) { return t == null ? t : Math.round(t * STEP) / STEP; }
  function withRoundedTime(e) { return Object.assign({}, e, { t: roundTime(e.t) }); }

  FT.codec = { roundTime: roundTime, withRoundedTime: withRoundedTime };
})(globalThis.FT);
