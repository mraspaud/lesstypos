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

  // A benchmark set (usually 3 trials) is scored by the median of its trials.
  function benchmarkResult(history, set) {
    var trials = history.filter(function (h) { return h.type === 'benchmark' && h.set === set && h.wpm != null; });
    if (!trials.length) return null;
    var wpm = trials.map(function (h) { return h.wpm; });
    return { set: set, trials: trials.length, wpm: FT.timing.median(wpm),
      faa: FT.timing.median(trials.map(function (h) { return h.faa; })),
      min: Math.min.apply(null, wpm), max: Math.max.apply(null, wpm),
      t: Math.min.apply(null, trials.map(function (h) { return h.t; })) };
  }

  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Groups entries by local day and summarises each day with fn(entries).
  function byDay(entries, fn) {
    var days = [], groups = {};
    entries.forEach(function (h) {
      var k = dayKey(h.t);
      if (!groups[k]) { groups[k] = []; days.push(k); }
      groups[k].push(h);
    });
    return days.sort().map(function (k) { return Object.assign({ day: k, t: groups[k][0].t }, fn(groups[k])); });
  }
  function med(list, key) {
    var v = list.map(function (h) { return h[key]; }).filter(function (x) { return x != null; });
    return v.length ? FT.timing.median(v) : null;
  }

  // Comparable progress series (comparable sessions only, one point per day):
  //   relaxed   relaxed practice of >= 50 words: WPM, accuracy, effort, rhythm, word-start penalty;
  //   benchmark complete sets of 3 trials (median and range);
  //   pairMs    common-pair timing from every exercise except speed bursts.
  var MIN_WORDS = 50, SET_SIZE = 3;
  function series(history) {
    var relaxed = history.filter(function (h) { return h.type === 'relaxed' && h.words >= MIN_WORDS; });
    var sets = [];
    history.forEach(function (h) { if (h.type === 'benchmark' && h.set && sets.indexOf(h.set) < 0) sets.push(h.set); });
    var effort = function (l) {
      var v = l.map(function (h) { return h.effort; }).filter(function (x) { return x != null; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    };
    return {
      relaxed: byDay(relaxed, function (l) {
        return { n: l.length, wpm: med(l, 'wpm'), faa: med(l, 'faa'), effort: effort(l), cv: med(l, 'cv'), startMs: med(l, 'startMs') };
      }),
      benchmark: sets.map(function (set) { return benchmarkResult(history, set); })
        .filter(function (r) { return r.trials >= SET_SIZE; }),
      pairMs: byDay(history.filter(function (h) { return h.type !== 'bursts' && h.pairMs != null; }), function (l) {
        return { ms: med(l, 'pairMs') };
      }),
    };
  }

  FT.progress = { compare: compare, timeline: timeline, benchmarkResult: benchmarkResult, series: series };
})(globalThis.FT);
