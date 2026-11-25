// Per-character timing records, cleaning and normalisation.
// - IKI: gap between successive first-attempt keydowns (Dhakal et al. 2018).
// - Pauses > 5 s are not hesitations (Dhakal et al. 2018 exclusion).
// - Only a correct keystroke that directly follows a correct keystroke, with no
//   edits in between, is timed (Behmer & Crump 2017); this also excludes
//   post-error slowing (Salthouse 1986).
// - Word-initial transitions are a separate population (Salthouse 1986;
//   Logan & Crump 2011), each normalised by its own baseline. Normalising by a
//   per-user baseline follows Dhakal et al.; using the session median per
//   population is a design choice.
// - Multi-character outputs: a single input event carrying several characters
//   is one motor event (observed fact). Declared macros typed as separate fast
//   keystrokes (< macroGapMs) are merged too (FT.text.pressIds). Undeclared fast pairs are only
//   reported as candidates (macroCandidates), never merged.
// - Letters arriving under SIMULTANEOUS_MS apart that are not a declared key
//   were sent together by the keyboard (e.g. a tap-hold key released by the
//   next press, or a deferred letter), so neither interval is finger timing:
//   both are left out (reason 'simultaneous'). Design choice: 6 ms, the gap
//   between firmware pairs (<= 5 ms) and the fastest finger interval (8.6 ms)
//   in one user's data; no published threshold.
(function (FT) {
  'use strict';
  var CTX = 3;
  var SIMULTANEOUS_MS = 6;

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function extract(words, opts) {
    opts = opts || {};
    var pauseMs = opts.pauseMs || 5000;
    var macroGapMs = opts.macroGapMs || FT.text.MACRO_GAP_MS;
    var records = [];
    var text = '';
    var prev = null; // previous record
    for (var wi = 0; wi < words.length; wi++) {
      var w = words[wi];
      var an = w.analysis || FT.align.analyzeWord(w.target + ' ', w.stream, { macros: opts.macros, gapMs: macroGapMs });
      w.analysis = an;
      var presses = FT.text.pressIds(w.stream, opts.macros, macroGapMs);
      for (var p = 0; p < an.targets.length; p++) {
        var tg = an.targets[p];
        var rec = {
          ch: tg.ch, ctx: text.slice(-CTX), word: w.target, wordIndex: wi, pos: p,
          t: tg.t, g: tg.g, err: tg.err, iki: null, wordInitial: p === 0,
          clean: false, reason: null, macro: false, source: w.meta && w.meta.source || null,
        };
        if (prev && prev.t != null && tg.t != null) rec.iki = tg.t - prev.t;
        var consecutive = prev && tg.idx != null && (
          p > 0 ? tg.idx === prev.idx + 1 : (tg.idx === 0 && prev.lastOfWord));
        var typedEntry = tg.idx != null ? w.stream[tg.idx] : null;
        if (typedEntry && typedEntry.auto) rec.reason = 'auto';
        else if (!prev) rec.reason = 'first';
        else if (tg.err > 0) rec.reason = 'error';
        else if (prev.err > 0 || !consecutive) rec.reason = 'after-error';
        else if (p > 0 && presses[tg.idx] != null && presses[tg.idx] === presses[prev.idx]) { rec.reason = 'macro'; rec.macro = true; } // second letter of one press
        else if (rec.iki > pauseMs) rec.reason = 'pause';
        rec.clean = rec.reason === null;
        records.push(rec);
        text += tg.ch;
        prev = { ch: tg.ch, t: tg.t, g: tg.g, err: tg.err, idx: tg.idx,
          lastOfWord: p === an.targets.length - 1 && tg.idx === w.stream.length - 1 };
      }
    }
    markSimultaneous(records);
    var within = [], initial = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? initial : within).push(r.iki); });
    var baseline = { within: median(within), initial: median(initial) };
    records.forEach(function (r) {
      var b = r.wordInitial ? baseline.initial : baseline.within;
      if (r.clean && b) { r.ratio = r.iki / b; r.logRatio = Math.log(Math.max(r.ratio, 1e-3)); }
    });
    return { records: records, baseline: baseline };
  }

  function markSimultaneous(records) {
    for (var i = 1; i < records.length; i++) {
      var r = records[i];
      if (r.iki == null || r.iki >= SIMULTANEOUS_MS || r.macro) continue;
      [records[i - 1], r].forEach(function (x) {
        if (x.reason === null) { x.reason = 'simultaneous'; x.clean = false; }
      });
    }
  }

  // Bigrams whose IKIs are consistently near-zero: possible keyboard macros.
  function macroCandidates(results, opts) {
    opts = opts || {};
    var fastMs = opts.fastMs || 15, minN = opts.minN || 10, minFrac = opts.minFrac || 0.8;
    var stats = {};
    results.forEach(function (res) {
      res.records.forEach(function (r) {
        if (!(r.clean || r.reason === 'simultaneous') || !r.ctx) return; // raw intervals, before the simultaneous rule
        var seq = r.ctx.slice(-1) + r.ch;
        if (seq.indexOf(' ') >= 0) return;
        var s = stats[seq] || (stats[seq] = { n: 0, fast: 0 });
        s.n++; if (r.iki < fastMs) s.fast++;
      });
    });
    return Object.keys(stats)
      .map(function (k) { return { seq: k, n: stats[k].n, confidence: stats[k].fast / stats[k].n }; })
      .filter(function (c) { return c.n >= minN && c.confidence >= minFrac; })
      .sort(function (a, b) { return b.confidence - a.confidence; });
  }

  // Rollover ratio (Dhakal et al. 2018): share of keydowns made while another
  // (non-modifier) key is still held. keys: [{k:'d'|'u', c: code, t}].
  var MODS = /^(Shift|Control|Alt|Meta|CapsLock|OS)/;
  // opts.exclude: key codes left out (keys sent late as synthetic taps).
  function rollover(keys, opts) {
    var held = {}, nHeld = 0, total = 0, rolled = 0, skip = {};
    ((opts && opts.exclude) || []).forEach(function (c) { skip[c] = true; });
    var ev = (keys || []).slice().sort(function (a, b) { return a.t - b.t || (a.k === 'u' ? -1 : 1); });
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (MODS.test(e.c) || skip[e.c]) continue;
      if (e.k === 'd') {
        total++;
        if (nHeld > 0) rolled++;
        if (!held[e.c]) { held[e.c] = true; nHeld++; }
      } else if (held[e.c]) { delete held[e.c]; nHeld--; }
    }
    return total ? rolled / total : null;
  }

  // Keys the keyboard sends late (see the header of test/latekeys.test.js):
  // a tap-hold key not settled on press arrives as a synthetic tap at the
  // firmware's decision time, its keyup within a millisecond of its keydown.
  // Design choice: >= LATE_MIN_N single-key presses, >= LATE_SHARE of them held
  // < INSTANT_MS, and a normal median hold overall (>= HOLD_INFO_MS; otherwise
  // the input carries no hold information). keys: [{k, c, t}]; words carry
  // streams; macros as for FT.text.pressIds.
  var MATCH_MS = 5, INSTANT_MS = 3, LATE_MIN_N = 10, LATE_SHARE = 0.8, HOLD_INFO_MS = 20;
  function lateKeys(keys, words, macros) {
    var chars = [];
    (words || []).forEach(function (w) {
      var ids = FT.text.pressIds(w.stream, macros), size = {};
      ids.forEach(function (p) { if (p != null) size[p] = (size[p] || 0) + 1; });
      w.stream.forEach(function (e, i) { if (e.k === 'c') chars.push({ ch: e.ch, t: e.t, single: size[ids[i]] === 1 }); });
    });
    chars.sort(function (a, b) { return a.t - b.t; });
    var ev = (keys || []).filter(function (e) { return !MODS.test(e.c); })
      .sort(function (a, b) { return a.t - b.t || (a.k === 'u' ? -1 : 1); });
    var j = 0, down = {}, holds = {}, all = [], codeOf = {};
    ev.forEach(function (e) {
      if (e.k === 'd') {
        while (j < chars.length && chars[j].t < e.t - MATCH_MS) j++;
        var m = j < chars.length && chars[j].t <= e.t + MATCH_MS ? chars[j++] : null;
        down[e.c] = { t: e.t, m: m };
      } else if (down[e.c]) {
        var d = down[e.c], hold = e.t - d.t;
        delete down[e.c];
        all.push(hold);
        if (!d.m || !d.m.single) return;
        var h = holds[d.m.ch] || (holds[d.m.ch] = { n: 0, instant: 0 });
        h.n++; if (hold < INSTANT_MS) h.instant++;
        codeOf[d.m.ch] = e.c;
      }
    });
    var info = all.length && median(all) >= HOLD_INFO_MS;
    // judged: keys with enough presses (and hold information) for a verdict
    var judged = !info ? [] : Object.keys(holds).filter(function (ch) { return holds[ch].n >= LATE_MIN_N; });
    var late = judged.filter(function (ch) { return holds[ch].instant / holds[ch].n >= LATE_SHARE; });
    return { chars: late, judged: judged, codes: late.map(function (ch) { return codeOf[ch]; }), holds: holds };
  }

  // Share of clean keystrokes slower than twice the ratio expected for them
  // (expectedFn(record) -> expected ratio, e.g. from the sequence model).
  function hesitationRate(records, expectedFn) {
    var clean = records.filter(function (r) { return r.clean; });
    if (!clean.length) return null;
    return clean.filter(function (r) { return r.ratio > 2 * expectedFn(r); }).length / clean.length;
  }

  // Rhythm: coefficient of variation of clean within-word intervals.
  function rhythmCv(records) {
    var ikis = records.filter(function (r) { return r.clean && !r.wordInitial; }).map(function (r) { return r.iki; });
    if (ikis.length < 2) return null;
    var ms = FT.stats.meanSd(ikis);
    return ms[0] ? ms[1] / ms[0] : null;
  }

  // The 30 most frequent within-word English letter pairs (from the bundled
  // wordfreq list, frozen so the yardstick never changes). Within-word timing
  // on high-frequency bigrams is stable on retest (Van Waes et al. 2021).
  var COMMON_PAIRS = ['th', 'he', 'in', 'an', 'er', 're', 'on', 'at', 'nd', 'ou', 'or', 'to', 'en', 'it', 'ng',
    'es', 'st', 'is', 'te', 'ar', 'ti', 'al', 'ha', 'ed', 've', 'of', 'nt', 'se', 'me', 'hi'];
  var COMMON = {};
  COMMON_PAIRS.forEach(function (p) { COMMON[p] = true; });
  var MIN_PAIRS = 20;

  // Median clean within-word interval on the common pairs (ms) and the number
  // of intervals it rests on; ms is null below MIN_PAIRS intervals.
  function commonPairStats(records) {
    var ikis = records.filter(function (r) {
      return r.clean && !r.wordInitial && r.ctx && COMMON[r.ctx.slice(-1) + r.ch];
    }).map(function (r) { return r.iki; });
    return { ms: ikis.length >= MIN_PAIRS ? median(ikis) : null, n: ikis.length };
  }
  function commonPairMs(records) { return commonPairStats(records).ms; }

  // Extra time before the first letter of a word: median clean word-initial
  // interval minus median clean within-word interval (ms), or null.
  function wordStartMs(records) {
    var init = [], within = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? init : within).push(r.iki); });
    return init.length >= 10 && within.length >= MIN_PAIRS ? median(init) - median(within) : null;
  }

  FT.timing = { lateKeys: lateKeys, SIMULTANEOUS_MS: SIMULTANEOUS_MS, wordStartMs: wordStartMs, extract: extract, macroCandidates: macroCandidates, median: median, rollover: rollover,
    hesitationRate: hesitationRate, rhythmCv: rhythmCv, COMMON_PAIRS: COMMON_PAIRS, commonPairMs: commonPairMs, commonPairStats: commonPairStats };
})(globalThis.FT);
