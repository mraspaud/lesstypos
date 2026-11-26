// Evidence per typing context: one bucket per session of what was typed in
// that context (keystrokes, errors, and sums of log interval ratios), merged
// into blocks as the sessions age, weighted for recency and aggregated.
//
// Context: the 1..MAX_ORDER characters ending at a target character (spaces
// included).
// Recency (design choices): each session bucket is weighted by
//  (a) exposure decay 0.5^(later observations of this context / halfLifeObs),
//      in the spirit of keybr's per-lesson exponential smoothing: recent
//      performance dominates once enough new evidence exists, and a context
//      that is not practised does not decay (time off does not erase mastery);
//  (b) a mild FSRS-shaped power-law decay of age in days (stats.recencyWeight).
(function (FT) {
  'use strict';
  var S = FT.stats;
  var MAX_ORDER = 4;

  // A bucket in memory:
  //   session, day       the session it covers (a merged block: their
  //                      count-weighted means), and its day;
  //   count, errors      keystrokes in the context and their first-attempt errors;
  //   latencyCount, latencySum, latencySquares
  //                      clean intervals, the sum of their log ratios and of
  //                      their squares (sufficient statistics);
  //   distinctWords      the most distinct words seen in one session;
  //   block              absent for one session, else the block it merges
  //                      (a number, or 'C<n>' for a big block).
  // Stored form (design choice): buckets as arrays in this order, their log
  // sums to 9 significant digits, far below any decision threshold.
  var STORED_FIELDS = ['session', 'day', 'count', 'errors', 'latencyCount', 'latencySum', 'latencySquares', 'distinctWords', 'block'];
  function sig9(x) { return x === 0 ? 0 : +x.toPrecision(9); }
  function pack(state) {
    var contexts = {};
    Object.keys(state.contexts).forEach(function (k) {
      var c = state.contexts[k];
      contexts[k] = { b: c.buckets.map(function (b) {
        var a = [b.session, b.day, b.count, b.errors, b.latencyCount, sig9(b.latencySum), sig9(b.latencySquares), b.distinctWords];
        if (b.block != null) a.push(b.block);
        return a;
      }), ex: c.examples, stage: c.stage };
    });
    return Object.assign({}, state, { contexts: contexts, packed: 1 });
  }
  function unpack(stored) {
    if (!stored || !stored.packed) return stored;
    var state = Object.assign({}, stored, { contexts: {} });
    delete state.packed;
    Object.keys(stored.contexts).forEach(function (k) {
      var c = stored.contexts[k];
      state.contexts[k] = { buckets: c.b.map(function (a) {
        var b = {};
        STORED_FIELDS.forEach(function (f, i) { if (i < a.length) b[f] = a[i]; });
        return b;
      }), examples: c.ex, stage: c.stage };
    });
    return state;
  }
  function emptyState() { return { contexts: {}, sessions: 0, lastDay: 0 }; }

  function contextOf(state, key) {
    return state.contexts[key] || (state.contexts[key] = { buckets: [], examples: [], stage: null });
  }

  function contextsOf(rec) {
    var full = (rec.ctx || '') + rec.ch;
    var out = [];
    for (var k = 1; k <= MAX_ORDER && k <= full.length; k++) out.push(full.slice(-k));
    return out;
  }

  // A late key's verdict comes from the latest session with enough presses of it.
  function updateLateKeys(state, late) {
    if (!late) return;
    var lateNow = {};
    late.chars.forEach(function (ch) { lateNow[ch] = true; });
    state.late = state.late || {};
    late.judged.forEach(function (ch) { if (lateNow[ch]) state.late[ch] = true; else delete state.late[ch]; });
  }

  // One session's timing records counted per context.
  function tally(records) {
    var byContext = {};
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.t === null) continue;
      var keys = contextsOf(r);
      for (var j = 0; j < keys.length; j++) {
        var a = byContext[keys[j]] || (byContext[keys[j]] = { count: 0, errors: 0, latencies: [], words: {} });
        a.count++; a.errors += r.err;
        if (r.clean && r.logRatio != null && isFinite(r.logRatio)) a.latencies.push(r.logRatio);
        if (r.word) a.words[r.word] = true;
      }
    }
    return byContext;
  }

  // Outlier trimming per context per session (Van Selst & Jolicoeur 1994)
  // on the ratio scale, then sufficient statistics on the log scale.
  function latencyStats(latencies) {
    var lat = latencies.length >= 4 ? S.vjTrim(latencies.map(Math.exp)).map(Math.log) : latencies;
    var sum = 0, squares = 0;
    for (var q = 0; q < lat.length; q++) { sum += lat[q]; squares += lat[q] * lat[q]; }
    return { count: lat.length, sum: sum, squares: squares };
  }

  function addToContext(c, counted, session, day, cfg) {
    var lat = latencyStats(counted.latencies), words = Object.keys(counted.words);
    var last = c.buckets[c.buckets.length - 1];
    if (last && last.session === session && last.block == null) {
      // another exercise of the same session (programme run): one bucket
      last.day = day; last.count += counted.count; last.errors += counted.errors;
      last.latencyCount += lat.count; last.latencySum += lat.sum; last.latencySquares += lat.squares;
      last.distinctWords = Math.max(last.distinctWords, words.length);
    } else {
      c.buckets.push({ session: session, day: day, count: counted.count, errors: counted.errors,
        latencyCount: lat.count, latencySum: lat.sum, latencySquares: lat.squares, distinctWords: words.length });
    }
    for (var x = 0; x < words.length; x++) {
      var idx = c.examples.indexOf(words[x]);
      if (idx >= 0) c.examples.splice(idx, 1);
      c.examples.push(words[x]);
    }
    if (c.examples.length > cfg.maxExamples) c.examples.splice(0, c.examples.length - cfg.maxExamples);
  }

  // Adds one session's timing records (FT.timing.extract) to the evidence.
  function ingest(state, records, meta, cfg) {
    updateLateKeys(state, meta.late);
    var byContext = tally(records);
    Object.keys(byContext).forEach(function (key) { addToContext(contextOf(state, key), byContext[key], meta.session, meta.day, cfg); });
    state.sessions = Math.max(state.sessions, meta.session);
    // every context, typed this session or not, so all sit at the same
    // compaction level and per-session comparisons stay matched
    Object.keys(state.contexts).forEach(function (k) { compact(state.contexts[k], state.sessions, cfg); });
    state.lastDay = Math.max(state.lastDay, meta.day);
  }

  // Buckets older than the newest `exactSessions` sessions are merged into
  // fixed session blocks shared by all contexts, so parent and child buckets
  // stay aligned. A merged bucket takes the count-weighted mean session and
  // day. Every context is compacted at every ingest, so the levels always
  // match. Blocks of `block` sessions; once a whole `bigBlock`-session block
  // is older than `bigAfter` sessions, it is merged into one (block 'C<n>'),
  // so storage stays bounded over years (design choice; such old evidence
  // carries little weight after exposure decay).
  function blockOf(b, session, cfg) {
    if (b.session > session - cfg.exactSessions) return null;
    var big = Math.floor((b.session - 1) / cfg.bigBlock);
    if ((big + 1) * cfg.bigBlock <= session - cfg.bigAfter) return 'C' + big;
    return Math.floor((b.session - 1) / cfg.block);
  }
  function compact(c, session, cfg) {
    var out = [], cur = null, curBlock = null;
    for (var i = 0; i < c.buckets.length; i++) {
      var x = c.buckets[i], block = blockOf(x, session, cfg);
      if (block === null) { if (cur) { out.push(cur); cur = null; } out.push(x); continue; }
      if (cur && curBlock === block) {
        var n = cur.count + x.count || 1;
        cur.session = (cur.session * cur.count + x.session * x.count) / n; cur.day = (cur.day * cur.count + x.day * x.count) / n;
        cur.count += x.count; cur.errors += x.errors;
        cur.latencyCount += x.latencyCount; cur.latencySum += x.latencySum; cur.latencySquares += x.latencySquares;
        cur.distinctWords = Math.max(cur.distinctWords, x.distinctWords); cur.block = block;
      } else {
        if (cur) out.push(cur);
        cur = Object.assign({}, x, { block: block }); curBlock = block;
      }
    }
    if (cur) out.push(cur);
    c.buckets = out;
  }

  // The last session a bucket covers: a merged block's copies in different
  // contexts share it, while their mean sessions differ.
  function lastSession(b, cfg) {
    if (typeof b.block === 'string') return (+b.block.slice(1) + 1) * cfg.bigBlock;
    if (b.block != null) return (b.block + 1) * cfg.block;
    return b.session;
  }
  // Weight of evidence in a bucket from the point of view of context c on
  // `day`: exposure decay by c's own later observations, times the
  // FSRS-shaped day decay.
  function weightsFor(c, day, cfg) {
    var buckets = c.buckets;
    return function (b) {
      var later = 0, at = lastSession(b, cfg);
      for (var j = buckets.length - 1; j >= 0 && lastSession(buckets[j], cfg) > at; j--) later += buckets[j].count;
      return Math.pow(0.5, later / cfg.halfLifeObs) * S.recencyWeight(day - b.day, cfg.stabilityDays);
    };
  }

  // Weighted sums of a context's buckets.
  function aggregateWith(c, weight) {
    var g = { count: 0, errors: 0, latencyCount: 0, latencySum: 0, latencySquares: 0 };
    for (var i = 0; i < c.buckets.length; i++) {
      var b = c.buckets[i], w = weight(b);
      g.count += w * b.count; g.errors += w * b.errors;
      g.latencyCount += w * b.latencyCount; g.latencySum += w * b.latencySum; g.latencySquares += w * b.latencySquares;
    }
    return g;
  }
  function aggregate(c, day, cfg) { return aggregateWith(c, weightsFor(c, day, cfg)); }
  // a without b (an aggregate without the part of it that b covers).
  function minus(a, b) {
    var latencyCount = Math.max(a.latencyCount - b.latencyCount, 0);
    return { count: Math.max(a.count - b.count, 0), errors: Math.max(a.errors - b.errors, 0), latencyCount: latencyCount,
      latencySum: latencyCount > 0 ? a.latencySum - b.latencySum : 0, latencySquares: latencyCount > 0 ? a.latencySquares - b.latencySquares : 0 };
  }

  function bucketKey(b) { return typeof b.block === 'string' ? b.block : b.block != null ? 'B' + b.block : 'S' + b.session; }
  // The parent's bucket for a child's bucket: same key, else the parent's
  // coarser block containing it (a parent is never less compacted).
  function parentBucket(parentByKey, b, cfg) {
    return parentByKey[bucketKey(b)] || parentByKey['B' + Math.floor((b.session - 1) / cfg.block)] ||
      parentByKey['C' + Math.floor((b.session - 1) / cfg.bigBlock)];
  }

  FT.evidence = { MAX_ORDER: MAX_ORDER, emptyState: emptyState, pack: pack, unpack: unpack, ingest: ingest,
    weightsFor: weightsFor, aggregate: aggregate, aggregateWith: aggregateWith, minus: minus,
    bucketKey: bucketKey, parentBucket: parentBucket };
})(globalThis.FT);
