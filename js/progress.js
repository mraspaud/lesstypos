// Progress at matched effort and accuracy (design principle: lower effort at
// the same speed is progress, as is more speed at the same effort).
(function (FT) {
  'use strict';
  var N = 5, MIN = 2, ACC_TOL = 0.01;

  function comparable(h, cur) {
    var acc = h.firstAttemptAccuracy, curAcc = cur.firstAttemptAccuracy;
    return h.type === cur.type && h.effort != null && FT.history.isComparable(h) &&
      (curAcc == null || acc == null || acc >= curAcc - ACC_TOL);
  }

  function compare(history, cur) {
    if (!cur || cur.effort == null || !FT.history.isComparable(cur)) return null;
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
  function fullTrial(h) { return h.wpm != null && (!h.plannedMs || h.durationMs >= FULL_TRIAL * h.plannedMs); }

  // A benchmark set (usually 3 trials) is scored by the median of its full trials.
  function benchmarkResult(history, set) {
    var trials = history.filter(function (h) { return h.type === 'benchmark' && h.benchmarkSet === set && fullTrial(h); });
    if (!trials.length) return null;
    var wpm = trials.map(function (h) { return h.wpm; });
    return { set: set, trials: trials.length, wpm: FT.stats.median(wpm),
      firstAttemptAccuracy: FT.stats.median(trials.map(function (h) { return h.firstAttemptAccuracy; })),
      min: Math.min.apply(null, wpm), max: Math.max.apply(null, wpm),
      startedAt: Math.min.apply(null, trials.map(function (h) { return h.startedAt; })) };
  }

  // Groups entries by local day and summarises each day with fn(entries).
  function byDay(entries, fn) {
    var days = [], groups = {};
    entries.forEach(function (h) {
      var k = FT.days.key(h.startedAt);
      if (!groups[k]) { groups[k] = []; days.push(k); }
      groups[k].push(h);
    });
    return days.sort().map(function (k) { return Object.assign({ day: k, startedAt: groups[k][0].startedAt }, fn(groups[k])); });
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


  // Complete benchmark sets (3 full trials), oldest first.
  function completeSets(history) {
    var sets = [];
    history.forEach(function (h) { if (h.type === 'benchmark' && h.benchmarkSet && sets.indexOf(h.benchmarkSet) < 0) sets.push(h.benchmarkSet); });
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
    var days = last ? FT.days.between(last.startedAt, now) : null;
    return { last: last, days: days, due: !last || days >= DUE_DAYS };
  }
  // The experimental fluency index (FT.fluency) is shown only where at least
  // FLUENCY_MIN_COVERAGE of the reference was timed from contexts of two
  // characters or more (design choice: half).
  var FLUENCY_MIN_COVERAGE = 0.5;
  function fluencyShown(h) { return h.fluencyWpm != null && h.fluencyCoverage >= FLUENCY_MIN_COVERAGE; }
  var orNull = function (x) { return x == null ? null : x; };
  // The index after the last exercise of each day.
  function fluencyByDay(history) {
    return byDay(history.filter(fluencyShown), function (l) {
      var last = l[l.length - 1];
      return { wpm: last.fluencyWpm, effortlessWpm: orNull(last.effortlessWpm), coverage: last.fluencyCoverage };
    });
  }
  // Each complete benchmark set against the index predicted before its first
  // trial: rows, and per variant the mean absolute error and the mean error
  // (positive: over-predicting), or null without a checked set.
  function fluencyCheck(history) {
    var rows = completeSets(history).map(function (r) {
      var first = history.filter(function (h) { return h.type === 'benchmark' && h.benchmarkSet === r.set; })[0];
      return fluencyShown(first) ? { set: r.set, startedAt: r.startedAt, measured: r.wpm, fluencyWpm: first.fluencyWpm,
        effortlessWpm: orNull(first.effortlessWpm), coverage: first.fluencyCoverage } : null;
    }).filter(Boolean);
    function errors(key) {
      var e = rows.filter(function (r) { return r[key] != null; }).map(function (r) { return r[key] - r.measured; });
      var mean = function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; };
      return e.length ? { sets: e.length, meanAbsoluteError: mean(e.map(Math.abs)), meanError: mean(e) } : null;
    }
    return { rows: rows, fluency: errors('fluencyWpm'), effortless: errors('effortlessWpm') };
  }

  // Comparable progress series (comparable sessions only, one point per day):
  //   relaxed       comparable relaxed practice (FT.history.isComparableRelaxed): WPM, accuracy, effort, rhythm, word-start penalty;
  //   benchmark     complete sets of 3 trials (median and range);
  //   commonPairMs  common-pair timing from relaxed practice (one exercise
  //                 type, so comparable), weighted by the number of intervals behind each.
  //   fluency       the experimental fluency index, A and B, with its coverage.
  function series(history) {
    var relaxed = history.filter(FT.history.isComparableRelaxed);
    var effort = function (l) {
      var v = l.map(function (h) { return h.effort; }).filter(function (x) { return x != null; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    };
    return {
      relaxed: byDay(relaxed, function (l) {
        return { exercises: l.length, wpm: med(l, 'wpm'), firstAttemptAccuracy: med(l, 'firstAttemptAccuracy'), effort: effort(l),
          rhythmCv: med(l, 'rhythmCv'), wordStartMs: med(l, 'wordStartMs') };
      }),
      benchmark: completeSets(history),
      commonPairMs: byDay(history.filter(function (h) { return h.type === 'relaxed' && h.commonPairMs != null; }), function (l) {
        return { commonPairMs: weightedMedian(l.map(function (h) { return [h.commonPairMs, h.commonPairIntervals || 1]; })) };
      }),
      fluency: fluencyByDay(history),
    };
  }

  // Adds up per-key statistics across history entries.
  function sumKeys(entries) {
    var keys = {}, land = {};
    entries.forEach(function (h) {
      var presses = h.keyPresses || {}, landings = h.wrongPressLandings || {};
      Object.keys(presses).forEach(function (k) {
        var a = keys[k] || (keys[k] = [0, 0]);
        a[0] += presses[k][0]; a[1] += presses[k][1];
      });
      Object.keys(landings).forEach(function (c) { land[c] = (land[c] || 0) + landings[c]; });
    });
    return { keys: keys, land: land };
  }

  FT.progress = { completeSets: completeSets, previousSet: previousSet, benchmarkStatus: benchmarkStatus, sumKeys: sumKeys, compare: compare, benchmarkResult: benchmarkResult, series: series,
    fluencyCheck: fluencyCheck, FLUENCY_MIN_COVERAGE: FLUENCY_MIN_COVERAGE };
})(globalThis.FT);
