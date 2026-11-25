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

  // A benchmark trial counts only if it ran (nearly) its full length.
  var FULL_TRIAL = 0.9, SET_SIZE = 3, DUE_DAYS = 7;
  function fullTrial(h) { return h.wpm != null && (!h.planMs || h.ms >= FULL_TRIAL * h.planMs); }

  // A benchmark set (usually 3 trials) is scored by the median of its full trials.
  function benchmarkResult(history, set) {
    var trials = history.filter(function (h) { return h.type === 'benchmark' && h.set === set && fullTrial(h); });
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
  function calendarDays(t0, t1) {
    var a = new Date(t0), b = new Date(t1);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  }
  // Is a benchmark due? Based on the last complete set, in calendar days.
  function benchmarkStatus(history, now) {
    var all = completeSets(history), last = all.length ? all[all.length - 1] : null;
    var days = last ? calendarDays(last.t, now) : null;
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
      pairMs: byDay(history.filter(function (h) { return h.type !== 'bursts' && h.pairMs != null; }), function (l) {
        return { ms: med(l, 'pairMs') };
      }),
    };
  }

  // Per-key error statistics for the keyboard heatmap (layout-free: keyed by
  // the characters a key types). The target text is split into presses, a
  // declared multi-letter key (e.g. "th", matched regardless of capitals) being
  // one press, stored under its lowercase name. keys[press] = [presses,
  // first-attempt errors]; land[press] = wrong presses that typed it, a
  // multi-character input event landing on its multi-letter key.
  // words: committed words with their stream (and analysis).
  function keyStats(words, macros) {
    var ms = (macros || []).map(function (m) { return m.toLowerCase(); })
      .sort(function (a, b) { return b.length - a.length; });
    var keys = {}, land = {};
    words.forEach(function (w) {
      var an = w.analysis || FT.align.analyzeWord(w.target + ' ', w.stream);
      var P = an.targets.map(function (x) { return x.ch; });
      for (var i = 0; i < P.length;) {
        var tok = P[i], len = 1;
        for (var m = 0; m < ms.length; m++) {
          var n = Array.from(ms[m]).length;
          if (P.slice(i, i + n).join('').toLowerCase() === ms[m]) { tok = ms[m]; len = n; break; }
        }
        var err = 0;
        for (var j = i; j < i + len; j++) err = Math.max(err, an.targets[j].err);
        var k = keys[tok] || (keys[tok] = [0, 0]);
        k[0] += 1; k[1] += err;
        i += len;
      }
      var groups = {};
      an.events.forEach(function (e) {
        if (e.type !== 'sub' && e.type !== 'transpose') return;
        var entry = w.stream[e.idx], g = entry && entry.g;
        var whole = g != null ? w.stream.filter(function (x) { return x.g === g && x.k === 'c'; }).map(function (x) { return x.ch; }).join('').toLowerCase() : '';
        if (whole.length > 1 && ms.indexOf(whole) >= 0) {
          if (!groups[g]) { groups[g] = true; land[whole] = (land[whole] || 0) + e.w; }
          return;
        }
        var a = FT.text.canon(e.actual);
        land[a] = (land[a] || 0) + e.w;
      });
    });
    return { keys: keys, land: land };
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

  FT.progress = { completeSets: completeSets, previousSet: previousSet, benchmarkStatus: benchmarkStatus, sumKeys: sumKeys, keyStats: keyStats, compare: compare, timeline: timeline, benchmarkResult: benchmarkResult, series: series };
})(globalThis.FT);
