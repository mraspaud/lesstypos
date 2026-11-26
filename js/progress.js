// Progress at matched effort and accuracy (design principle: lower effort at
// the same speed is progress, as is more speed at the same effort).
(function (FT) {
  'use strict';
  var N = 5, MIN = 2, ACC_TOL = 0.01, MIN_WORDS = 50;

  function comparable(h, cur) {
    return h.type === cur.type && h.wpm != null && h.effort != null && h.words >= MIN_WORDS &&
      (cur.faa == null || h.faa == null || h.faa >= cur.faa - ACC_TOL);
  }

  function compare(history, cur) {
    if (!cur || cur.effort == null || cur.wpm == null || !(cur.words >= MIN_WORDS)) return null;
    var pool = history.filter(function (h) { return h !== cur && comparable(h, cur); });
    var same = pool.filter(function (h) { return h.effort === cur.effort; }).slice(-N);
    var higher = pool.filter(function (h) { return h.effort > cur.effort; }).slice(-N);
    var med = function (a) { return FT.stats.median(a.map(function (h) { return h.wpm; })); };
    if (higher.length >= MIN) {
      var hb = med(higher);
      if (cur.wpm >= hb - 1) {
        return { kind: 'lower-effort', effort: cur.effort, baselineWpm: hb, deltaWpm: cur.wpm - hb };
      }
    }
    if (same.length >= MIN) {
      var b = med(same), d = cur.wpm - b;
      return { kind: 'same-effort', effort: cur.effort, baselineWpm: b, deltaWpm: d };
    }
    return null;
  }

  // A benchmark trial counts only if it ran (nearly) its full length.
  var FULL_TRIAL = 0.9, SET_SIZE = 3, DUE_DAYS = 7;
  function fullTrial(h) { return h.wpm != null && (!h.planMs || h.ms >= FULL_TRIAL * h.planMs); }

  // A benchmark set (usually 3 trials) is scored by the median of its full trials.
  function benchmarkResult(history, set) {
    var trials = history.filter(function (h) { return h.type === 'benchmark' && h.set === set && fullTrial(h); });
    if (!trials.length) return null;
    var wpm = trials.map(function (h) { return h.wpm; });
    return { set: set, trials: trials.length, wpm: FT.stats.median(wpm),
      faa: FT.stats.median(trials.map(function (h) { return h.faa; })),
      min: Math.min.apply(null, wpm), max: Math.max.apply(null, wpm),
      t: Math.min.apply(null, trials.map(function (h) { return h.t; })) };
  }

  // Groups entries by local day and summarises each day with fn(entries).
  function byDay(entries, fn) {
    var days = [], groups = {};
    entries.forEach(function (h) {
      var k = FT.days.key(h.t);
      if (!groups[k]) { groups[k] = []; days.push(k); }
      groups[k].push(h);
    });
    return days.sort().map(function (k) { return Object.assign({ day: k, t: groups[k][0].t }, fn(groups[k])); });
  }
  // Median of [value, weight] pairs.
  function weightedMedian(pairs) {
    var s = pairs.slice().sort(function (a, b) { return a[0] - b[0]; });
    var total = s.reduce(function (a, p) { return a + p[1]; }, 0), acc = 0;
    for (var i = 0; i < s.length; i++) { acc += s[i][1]; if (acc >= total / 2) return s[i][0]; }
    return null;
  }
  function med(list, key) {
    var v = list.map(function (h) { return h[key]; }).filter(function (x) { return x != null; });
    return v.length ? FT.stats.median(v) : null;
  }

  // Comparable progress series (comparable sessions only, one point per day):
  //   relaxed   relaxed practice of >= 50 words: WPM, accuracy, effort, rhythm, word-start penalty;
  //   benchmark complete sets of 3 trials (median and range);
  //   pairMs    common-pair timing from relaxed practice (one exercise type, so
  //             comparable), weighted by the number of intervals behind each.
  var MIN_WORDS = 50;

  // Complete benchmark sets (3 full trials), oldest first.
  function completeSets(history) {
    var sets = [];
    history.forEach(function (h) { if (h.type === 'benchmark' && h.set && sets.indexOf(h.set) < 0) sets.push(h.set); });
    return sets.map(function (set) { return benchmarkResult(history, set); })
      .filter(function (r) { return r && r.trials >= SET_SIZE; });
  }
  function previousSet(history, set) {
    var all = completeSets(history), i = all.map(function (r) { return r.set; }).indexOf(set);
    var before = i < 0 ? all : all.slice(0, i);
    return before.length ? before[before.length - 1] : null;
  }
  // Is a benchmark due? Based on the last complete set, in calendar days.
  function benchmarkStatus(history, now) {
    var all = completeSets(history), last = all.length ? all[all.length - 1] : null;
    var days = last ? FT.days.between(last.t, now) : null;
    return { last: last, days: days, due: !last || days >= DUE_DAYS };
  }
  function series(history) {
    var relaxed = history.filter(function (h) { return h.type === 'relaxed' && h.words >= MIN_WORDS; });
    var effort = function (l) {
      var v = l.map(function (h) { return h.effort; }).filter(function (x) { return x != null; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    };
    return {
      relaxed: byDay(relaxed, function (l) {
        return { n: l.length, wpm: med(l, 'wpm'), faa: med(l, 'faa'), effort: effort(l), cv: med(l, 'cv'), startMs: med(l, 'startMs') };
      }),
      benchmark: completeSets(history),
      pairMs: byDay(history.filter(function (h) { return h.type === 'relaxed' && h.pairMs != null; }), function (l) {
        return { ms: weightedMedian(l.map(function (h) { return [h.pairMs, h.pairN || 1]; })) };
      }),
    };
  }

  // Adds up per-key statistics across history entries.
  function sumKeys(entries) {
    var keys = {}, land = {};
    entries.forEach(function (h) {
      Object.keys(h.keys || {}).forEach(function (k) {
        var a = keys[k] || (keys[k] = [0, 0]);
        a[0] += h.keys[k][0]; a[1] += h.keys[k][1];
      });
      Object.keys(h.land || {}).forEach(function (c) { land[c] = (land[c] || 0) + h.land[c]; });
    });
    return { keys: keys, land: land };
  }

  FT.progress = { completeSets: completeSets, previousSet: previousSet, benchmarkStatus: benchmarkStatus, sumKeys: sumKeys, compare: compare, benchmarkResult: benchmarkResult, series: series };
})(globalThis.FT);
