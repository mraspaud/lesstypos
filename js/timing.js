// Per-character timing records, cleaning and normalisation.
// - IKI: gap between successive first-attempt keydowns (Dhakal et al. 2018).
// - Pauses > 5 s are not hesitations (Dhakal et al. 2018 exclusion).
// - Only a correct keystroke that directly follows a correct keystroke, with no
//   edits in between, is timed (Behmer & Crump 2017); this also excludes
//   post-error slowing (Salthouse 1986).
// - Word-initial transitions are a separate population (Salthouse 1986;
//   Logan & Crump 2011), each normalised by its own baseline. Normalising by a
//   per-user baseline follows Dhakal et al.; centring each population per
//   session on its mean log interval (geometric mean) is a design choice: the
//   model compares log ratios, and a median would leave populations with
//   different skew offset from each other. Each population's arithmetic mean
//   (meanMs, untrimmed: slow keystrokes take real time too) is reported
//   beside it, since durations add up arithmetically.
// - Multi-character outputs: a single input event carrying several characters
//   is one motor event (observed fact). Declared macros typed as separate fast
//   keystrokes (< FT.presses.MACRO_GAP_MS) are merged too (FT.presses.ids).
//   Undeclared fast pairs are only reported as candidates (macroCandidates),
//   never merged.
// - Letters arriving under SIMULTANEOUS_MS apart that are not a declared key
//   were sent together by the keyboard (e.g. a tap-hold key released by the
//   next press, or a deferred letter), so neither interval is finger timing:
//   both are left out (reason 'simultaneous'). Design choice: 6 ms, the gap
//   between firmware pairs (<= 5 ms) and the fastest finger interval (8.6 ms)
//   in one user's data; no published threshold.
(function (FT) {
  'use strict';
  var SIMULTANEOUS_MS = 6, CONTEXT_CHARS = 3, PAUSE_MS = 5000;

  // Records per target character, cleaned and normalised per population.
  // analyses: FT.align.analyzeWords(words, ...), one per word.
  function extract(words, analyses, opts) {
    var pauseMs = FT.valueOr(opts && opts.pauseMs, PAUSE_MS);
    var records = characterRecords(words, analyses, pauseMs);
    markSimultaneous(records);
    var intervals = cleanIntervals(records);
    var centre = centreRatios(records, intervals);
    var meanMs = { within: FT.stats.mean(intervals.within), initial: FT.stats.mean(intervals.initial) };
    return { records: records, baseline: { within: FT.stats.median(intervals.within), initial: FT.stats.median(intervals.initial) },
      centreMs: { within: inMs(centre.within), initial: inMs(centre.initial) }, meanMs: meanMs,
      correction: correction(records, meanMs, pauseMs) };
  }

  // The time errors cost: errors slow typing around the mistake (Salthouse
  // 1986; post-error slowing, Kalfaoğlu & Stafford 2014). Measured (design
  // choice) as the error and after-error intervals beyond the clean mean of
  // their population, in ms, over the first-try errors; an interval over the
  // pause threshold is a pause, not a correction (Dhakal et al. 2018).
  var CORRECTION_REASONS = { error: true, 'after-error': true };
  function correction(records, meanMs, pauseMs) {
    var ms = 0, errors = 0;
    records.forEach(function (r) {
      errors += r.err;
      var clean = r.wordInitial ? meanMs.initial : meanMs.within;
      if (CORRECTION_REASONS[r.reason] && r.iki != null && r.iki <= pauseMs && clean != null) ms += r.iki - clean;
    });
    return { ms: ms, errors: errors, msPerError: errors > 0 ? ms / errors : null };
  }

  // The time pauses take (intervals over the pause threshold, Dhakal et al.
  // 2018), which measured speed includes. Design choice: the typing time
  // (typingMs: from the first key, without the time paused in the app) less
  // the intervals up to the threshold, less a clean keystroke (its
  // population's clean mean) for each pause, so the time paused in the app
  // drops out; never below 0. presses: the keystrokes it is spread over (the
  // later letters of a declared key are part of its press).
  // extracted: what extract returned.
  function pauseTime(extracted, typingMs, opts) {
    var pauseMs = FT.valueOr(opts && opts.pauseMs, PAUSE_MS), meanMs = extracted.meanMs, ms = typingMs, presses = 0;
    extracted.records.forEach(function (r) {
      if (!r.macro) presses++;
      if (r.iki == null) return;
      ms -= r.iki <= pauseMs ? r.iki : FT.valueOr(r.wordInitial ? meanMs.initial : meanMs.within, 0);
    });
    return { ms: Math.max(0, ms), presses: presses };
  }

  function characterRecords(words, analyses, pauseMs) {
    var records = [], text = '', prev = null;
    words.forEach(function (w, wi) {
      var an = analyses[wi];
      an.targets.forEach(function (position, p) {
        var rec = {
          ch: position.ch, ctx: text.slice(-CONTEXT_CHARS), word: w.target, wordIndex: wi, pos: p,
          t: position.t, g: position.g, err: position.err, iki: null, wordInitial: p === 0,
          clean: false, reason: null, macro: false, source: w.meta && w.meta.source || null,
        };
        if (prev && prev.t != null && position.t != null) rec.iki = position.t - prev.t;
        rec.reason = exclusion(w, an.presses.typed, position, p, prev, rec.iki, pauseMs);
        rec.macro = rec.reason === 'macro';
        rec.clean = rec.reason === null;
        records.push(rec);
        text += position.ch;
        prev = { ch: position.ch, t: position.t, g: position.g, err: position.err, idx: position.idx,
          lastOfWord: p === an.targets.length - 1 && position.idx === w.stream.length - 1 };
      });
    });
    return records;
  }

  // Why the interval before target character pos is not finger timing, or
  // null when it is (see the header).
  function exclusion(w, presses, position, pos, prev, iki, pauseMs) {
    var typed = position.idx != null ? w.stream[position.idx] : null;
    if (typed && typed.auto) return 'auto';
    if (!prev) return 'first';
    if (position.err > 0) return 'error';
    var followsDirectly = position.idx != null && (pos > 0 ? position.idx === prev.idx + 1 : (position.idx === 0 && prev.lastOfWord));
    if (prev.err > 0 || !followsDirectly) return 'after-error';
    if (pos > 0 && presses[position.idx] != null && presses[position.idx] === presses[prev.idx]) return 'macro'; // second letter of one press
    if (iki > pauseMs) return 'pause';
    return null;
  }

  function cleanIntervals(records) {
    var within = [], initial = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? initial : within).push(r.iki); });
    return { within: within, initial: initial };
  }

  // Ratios are centred per population on the log scale (geometric mean = 1),
  // the scale the model compares on; the medians in the baseline are for
  // display. The centre leaves out outliers (Van Selst & Jolicoeur 1994, the
  // trimming the model applies per context), so one long pause does not move it.
  // Returns the centres (mean log ms).
  function centreRatios(records, intervals) {
    var centre = { within: FT.stats.meanLog(FT.stats.vjTrim(intervals.within)), initial: FT.stats.meanLog(FT.stats.vjTrim(intervals.initial)) };
    records.forEach(function (r) {
      var c = r.wordInitial ? centre.initial : centre.within;
      if (r.clean && c != null) { r.logRatio = FT.stats.logOf(r.iki) - c; r.ratio = Math.exp(r.logRatio); }
    });
    return centre;
  }
  function inMs(meanLog) { return meanLog == null ? null : Math.exp(meanLog); }

  function markSimultaneous(records) {
    for (var i = 1; i < records.length; i++) {
      var r = records[i];
      if (r.iki == null || r.iki >= SIMULTANEOUS_MS || r.macro) continue;
      if (r.reason === 'auto' || records[i - 1].reason === 'auto') continue; // inserted by the app, not the keyboard
      [records[i - 1], r].forEach(function (x) {
        if (x.reason === null) { x.reason = 'simultaneous'; x.clean = false; }
      });
    }
  }

  // Bigrams whose IKIs are consistently near-zero: possible keyboard macros.
  // Design choice: at least MACRO.minN intervals, MACRO.minFrac of them under
  // MACRO.fastMs.
  var MACRO = { fastMs: 15, minN: 10, minFrac: 0.8 };
  function macroCandidates(results, opts) {
    opts = opts || {};
    var fastMs = FT.valueOr(opts.fastMs, MACRO.fastMs), minN = FT.valueOr(opts.minN, MACRO.minN), minFrac = FT.valueOr(opts.minFrac, MACRO.minFrac);
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

  // Share of clean keystrokes slower than HESITATION_FACTOR times the ratio
  // expected for them (expectedFn(record) -> expected ratio, e.g. from the
  // sequence model). Design choice: twice.
  var HESITATION_FACTOR = 2;
  function hesitationRate(records, expectedFn) {
    var clean = records.filter(function (r) { return r.clean; });
    if (!clean.length) return null;
    return clean.filter(function (r) { return r.ratio > HESITATION_FACTOR * expectedFn(r); }).length / clean.length;
  }

  // Rhythm: coefficient of variation of clean within-word intervals.
  function rhythmCv(records) {
    var ikis = records.filter(function (r) { return r.clean && !r.wordInitial; }).map(function (r) { return r.iki; });
    if (ikis.length < 2) return null;
    var ms = FT.stats.meanSd(ikis);
    return ms[0] ? ms[1] / ms[0] : null;
  }

  // The 30 most frequent within-word English letter pairs (from the bundled
  // wordfreq list, frozen so the yardstick never changes). Like every timing
  // statistic, it uses clean intervals only, so simultaneous pairs are out.
  // Within-word timing on high-frequency bigrams is stable on retest (Van Waes
  // et al. 2021). Design choice: at least MIN_PAIRS intervals (and
  // MIN_WORD_STARTS word starts for the word-start penalty).
  var COMMON_PAIRS = ['th', 'he', 'in', 'an', 'er', 're', 'on', 'at', 'nd', 'ou', 'or', 'to', 'en', 'it', 'ng',
    'es', 'st', 'is', 'te', 'ar', 'ti', 'al', 'ha', 'ed', 've', 'of', 'nt', 'se', 'me', 'hi'];
  var COMMON = {};
  COMMON_PAIRS.forEach(function (p) { COMMON[p] = true; });
  var MIN_PAIRS = 20, MIN_WORD_STARTS = 10;

  // Median clean within-word interval on the common pairs (ms) and the number
  // of intervals it rests on; ms is null below MIN_PAIRS intervals.
  function commonPairStats(records) {
    var ikis = records.filter(function (r) {
      return r.clean && !r.wordInitial && r.ctx && COMMON[r.ctx.slice(-1) + r.ch];
    }).map(function (r) { return r.iki; });
    return { ms: ikis.length >= MIN_PAIRS ? FT.stats.median(ikis) : null, n: ikis.length };
  }

  // Extra time before the first letter of a word: median clean word-initial
  // interval minus median clean within-word interval (ms), or null.
  function wordStartMs(records) {
    var init = [], within = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? init : within).push(r.iki); });
    return init.length >= MIN_WORD_STARTS && within.length >= MIN_PAIRS ? FT.stats.median(init) - FT.stats.median(within) : null;
  }

  FT.timing = { wordStartMs: wordStartMs, extract: extract, pauseTime: pauseTime, macroCandidates: macroCandidates,
    hesitationRate: hesitationRate, rhythmCv: rhythmCv, COMMON_PAIRS: COMMON_PAIRS, commonPairStats: commonPairStats };
})(globalThis.FT);
