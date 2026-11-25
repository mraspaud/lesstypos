// Session metrics.
// Error rates: Soukoreff & MacKenzie (2003). C, INF, IF, F summed over words.
// First-attempt accuracy: share of target characters whose first attempt was
// correct (from FT.align targets; corrected errors still count as errors).
// WPM: correct characters / 5 per minute; raw WPM: all non-backspace keystrokes.
(function (FT) {
  'use strict';

  function ratio(a, b) { return b > 0 ? a / b : null; }

  function summarize(words, opts) {
    var C = 0, INF = 0, IF = 0, F = 0, targets = 0, firstErr = 0, typed = 0, Tlen = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      C += w.counts.C; INF += w.counts.INF; IF += w.counts.IF; F += w.counts.F;
      Tlen += Array.from(w.T).length;
      typed += w.counts.IF + Array.from(w.T).length + w.counts.F;
      for (var j = 0; j < w.targets.length; j++) { targets++; firstErr += w.targets[j].err; }
    }
    var all = C + INF + IF;
    var minutes = (opts && opts.durationMs ? opts.durationMs : 0) / 60000;
    return {
      words: words.length,
      chars: targets,
      C: C, INF: INF, IF: IF, F: F,
      uncorrectedErrorRate: ratio(INF, all),
      correctedErrorRate: ratio(IF, all),
      totalErrorRate: ratio(INF + IF, all),
      conscientiousness: ratio(IF, IF + INF),
      kspc: ratio(typed, Tlen),
      firstAttemptAccuracy: targets ? 1 - firstErr / targets : null,
      finalAccuracy: all ? C / Math.max(C + INF, 1) : null,
      wpm: minutes > 0 && words.length ? C / 5 / minutes : null,
      rawWpm: minutes > 0 && words.length ? (typed - F) / 5 / minutes : null,
      durationMs: opts ? opts.durationMs : 0,
    };
  }

  FT.metrics = { summarize: summarize };
})(globalThis.FT);
