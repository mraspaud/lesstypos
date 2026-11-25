// Progress at matched effort and accuracy (design principle: lower effort at
// the same speed is progress, as is more speed at the same effort).
(function (FT) {
  'use strict';
  var N = 5, MIN = 2, ACC_TOL = 0.01;

  function comparable(h, cur) {
    return h.type === cur.type && h.wpm != null && h.effort != null && h.words >= 50 &&
      (cur.faa == null || h.faa == null || h.faa >= cur.faa - ACC_TOL);
  }

  function compare(history, cur) {
    if (!cur || cur.effort == null || cur.wpm == null) return null;
    var pool = history.filter(function (h) { return h !== cur && comparable(h, cur); });
    var same = pool.filter(function (h) { return h.effort === cur.effort; }).slice(-N);
    var higher = pool.filter(function (h) { return h.effort > cur.effort; }).slice(-N);
    var med = function (a) { return FT.timing.median(a.map(function (h) { return h.wpm; })); };
    if (higher.length >= MIN) {
      var hb = med(higher);
      if (cur.wpm >= hb - 1) {
        return { kind: 'lower-effort', baselineWpm: hb, deltaWpm: cur.wpm - hb,
          message: 'About the same speed as your recent sessions at higher effort, with less effort.' };
      }
    }
    if (same.length >= MIN) {
      var b = med(same), d = cur.wpm - b;
      return { kind: 'same-effort', baselineWpm: b, deltaWpm: d,
        message: (d >= 0 ? '+' : '') + d.toFixed(1) + ' WPM compared with your recent sessions at effort ' + cur.effort + '.' };
    }
    return null;
  }

  // Per-word timeline: speed of each word (its characters including the
  // following space, from the previous word's last keystroke to its own last
  // keystroke; the first word from its first keystroke), running speed (correct
  // characters so far / 5 per minute since the first keystroke), and whether
  // the word's first attempt contained an error.
  function timeline(words) {
    var out = [], t0 = null, prevEnd = null, correct = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w.stream.length) continue;
      var an = w.analysis || FT.align.analyzeWord(w.target + ' ', w.stream);
      var first = w.stream[0].t, end = w.stream[w.stream.length - 1].t;
      if (t0 === null) t0 = first;
      var start = prevEnd === null ? first : prevEnd;
      var chars = Array.from(w.target).length + 1;
      correct += an.counts.C;
      var dur = end - start, el = end - t0;
      out.push({
        i: out.length + 1, word: w.target, t: end - t0,
        burst: dur > 0 ? chars / 5 / (dur / 60000) : null,
        running: el > 0 ? correct / 5 / (el / 60000) : null,
        error: an.targets.some(function (x) { return x.err > 0; }),
      });
      prevEnd = end;
    }
    return out;
  }

  FT.progress = { compare: compare, timeline: timeline };
})(globalThis.FT);
