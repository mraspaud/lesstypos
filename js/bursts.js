// Speed bursts: an adaptive pace target (design choice following the
// 1-up-1-down staircase of Levitt 1971, which converges near the pace reached
// about half the time). The target starts 10% above recent relaxed speed,
// rises 2% after a round that meets it with >= 95% accuracy, falls 2%
// otherwise, and stays within 0.9x..2x relaxed speed.
(function (FT) {
  'use strict';
  var UP = 1.02, DOWN = 0.98, MIN_ACC = 0.95, START_ABOVE = 1.1;

  function relaxedMedian(history) {
    var r = history.filter(FT.history.isComparableRelaxed).slice(-5);
    return r.length ? FT.stats.median(r.map(function (h) { return h.wpm; })) : null;
  }
  function initialTarget(history) {
    var m = relaxedMedian(history);
    return m ? m * START_ABOVE : 40;
  }
  function bounds(ref) { return ref ? [0.9 * ref, 2 * ref] : [20, 250]; }

  function step(target, stats, ref) {
    var met = stats.wpm != null && stats.wpm >= target && stats.accuracy >= MIN_ACC;
    var reason = met ? 'met the target with ' + Math.round(stats.accuracy * 100) + '% accuracy'
      : stats.wpm < target ? 'below the target pace' : 'accuracy under ' + MIN_ACC * 100 + '%';
    var b = bounds(ref), after = Math.min(b[1], Math.max(b[0], target * (met ? UP : DOWN)));
    return { before: target, after: after, result: met ? 'met' : 'missed', reason: reason };
  }

  function wordEnd(w) { return w.tEnd != null ? w.tEnd : w.stream[w.stream.length - 1].t; }
  function finishedWithin(w, start, end) {
    if (!w.stream.length) return false;
    var t = wordEnd(w);
    return t >= start && t <= end;
  }

  // Statistics of the words finished within [start, end]; analyses: one per word.
  function roundStats(words, analyses, start, end) {
    var C = 0, n = 0, targets = 0, err = 0;
    words.forEach(function (w, i) {
      if (!finishedWithin(w, start, end)) return;
      var an = analyses[i];
      n++; C += an.counts.C;
      an.targets.forEach(function (x) { targets++; err += x.err; });
    });
    var mins = (end - start) / 60000;
    return { words: n, wpm: mins > 0 && n ? C / 5 / mins : null, accuracy: targets ? 1 - err / targets : null };
  }

  function create(state) {
    var st = state || { target: null, log: [] };
    return {
      // The target to aim at now; before the first finished burst exercise it
      // follows relaxed speed without being stored.
      peek: function (history) { return st.target != null ? st.target : initialTarget(history); },
      ensure: function (history) { if (st.target == null) st.target = initialTarget(history); return st.target; },
      // Replays the rounds of a finished burst exercise; returns per-round rows.
      apply: function (words, analyses, rounds, history, at) {
        var ref = relaxedMedian(history);
        this.ensure(history);
        return rounds.map(function (r, i) {
          var s = roundStats(words, analyses, r.start, r.end);
          var res = step(st.target, s, ref);
          st.target = res.after;
          st.log.push({ at: at, round: i + 1, before: res.before, after: res.after, wpm: s.wpm, accuracy: s.accuracy, reason: res.reason });
          if (st.log.length > 300) st.log.shift();
          return { round: i + 1, words: s.words, wpm: s.wpm, accuracy: s.accuracy, before: res.before, after: res.after, result: res.result, reason: res.reason };
        });
      },
      toJSON: function () { return st; },
    };
  }

  FT.bursts = { MIN_ACC: MIN_ACC, START_ABOVE: START_ABOVE, create: create, initialTarget: initialTarget, step: step, roundStats: roundStats, finishedWithin: finishedWithin, relaxedMedian: relaxedMedian };
})(globalThis.FT);
