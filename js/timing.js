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
//   keystrokes (< macroGapMs) are merged too. Undeclared fast pairs are only
//   reported as candidates (macroCandidates), never merged.
(function (FT) {
  'use strict';
  var CTX = 3;

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function extract(words, opts) {
    opts = opts || {};
    var pauseMs = opts.pauseMs || 5000;
    var macroGapMs = opts.macroGapMs || 30;
    var macros = {};
    (opts.macros || []).forEach(function (m) { if (m && m.length > 1) macros[m] = true; });
    var records = [];
    var text = '';
    var prev = null; // previous record
    for (var wi = 0; wi < words.length; wi++) {
      var w = words[wi];
      var an = w.analysis || FT.align.analyzeWord(w.target + ' ', w.stream);
      w.analysis = an;
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
        var pair = prev ? prev.ch + tg.ch : '';
        if (!prev) rec.reason = 'first';
        else if (tg.err > 0) rec.reason = 'error';
        else if (prev.err > 0 || !consecutive) rec.reason = 'after-error';
        else if (prev.g != null && prev.g === tg.g) { rec.reason = 'macro'; rec.macro = true; }
        else if (macros[pair] && rec.iki != null && rec.iki < macroGapMs) { rec.reason = 'macro'; rec.macro = true; }
        else if (rec.iki > pauseMs) rec.reason = 'pause';
        rec.clean = rec.reason === null;
        records.push(rec);
        text += tg.ch;
        prev = { ch: tg.ch, t: tg.t, g: tg.g, err: tg.err, idx: tg.idx,
          lastOfWord: p === an.targets.length - 1 && tg.idx === w.stream.length - 1 };
      }
    }
    var within = [], initial = [];
    records.forEach(function (r) { if (r.clean) (r.wordInitial ? initial : within).push(r.iki); });
    var baseline = { within: median(within), initial: median(initial) };
    records.forEach(function (r) {
      var b = r.wordInitial ? baseline.initial : baseline.within;
      if (r.clean && b) { r.ratio = r.iki / b; r.logRatio = Math.log(Math.max(r.ratio, 1e-3)); }
    });
    return { records: records, baseline: baseline };
  }

  // Bigrams whose IKIs are consistently near-zero: possible keyboard macros.
  function macroCandidates(results, opts) {
    opts = opts || {};
    var fastMs = opts.fastMs || 15, minN = opts.minN || 10, minFrac = opts.minFrac || 0.8;
    var stats = {};
    results.forEach(function (res) {
      res.records.forEach(function (r) {
        if (!r.clean || !r.ctx) return;
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
  function rollover(keys) {
    var held = {}, nHeld = 0, total = 0, rolled = 0;
    var ev = (keys || []).slice().sort(function (a, b) { return a.t - b.t || (a.k === 'u' ? -1 : 1); });
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (MODS.test(e.c)) continue;
      if (e.k === 'd') {
        total++;
        if (nHeld > 0) rolled++;
        if (!held[e.c]) { held[e.c] = true; nHeld++; }
      } else if (held[e.c]) { delete held[e.c]; nHeld--; }
    }
    return total ? rolled / total : null;
  }

  FT.timing = { extract: extract, macroCandidates: macroCandidates, median: median, rollover: rollover };
})(globalThis.FT);
