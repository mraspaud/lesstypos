// Statistics of one exercise, from its words and their analyses: the
// per-word timeline and the per-key error counts.
(function (FT) {
  'use strict';
  // Per-word timeline: each word's speed (its characters and the following
  // space, from the previous word's last keystroke to its own; the first word
  // from its first keystroke, so over the characters after it), the running
  // speed (correct characters since the first keystroke / 5 per minute), and
  // whether the word's first attempt had an error.
  function timeline(words, analyses) {
    var out = [], t0 = null, prevEnd = null, correct = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w.stream.length) continue;
      var an = analyses[i];
      var first = w.stream[0].t, end = w.stream[w.stream.length - 1].t;
      if (t0 === null) t0 = first;
      var start = prevEnd === null ? first : prevEnd;
      var chars = Array.from(w.target).length + 1 - (prevEnd === null ? 1 : 0);
      correct += an.counts.C - (prevEnd === null ? 1 : 0); // the first keystroke starts the clock
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

  // Per-key error statistics for the keyboard heatmap (layout-free: keyed by
  // the characters a key types). The target text is split into presses, a
  // declared multi-letter key (e.g. "th", matched regardless of capitals) being
  // one press, stored under its lowercase name. keys[press] = [presses,
  // first-attempt errors]; land[press] = wrong presses that typed it, a
  // multi-character input event landing on its multi-letter key.
  // words: committed words with their stream; analyses: one per word, made
  // with opts ({ macros, equivalence }).
  function keyStats(words, analyses, opts) {
    var macros = opts && opts.macros, canon = (opts && opts.equivalence || FT.text.equivalence()).canon;
    var ms = (macros || []).map(function (m) { return m.toLowerCase(); });
    var keys = {}, land = {};
    words.forEach(function (w, wi) {
      var an = analyses[wi];
      var P = an.targets.map(function (x) { return x.ch; });
      var tp = FT.presses.ofTarget(P.join(''), macros), byPress = {};
      P.forEach(function (ch, i) {
        var b = byPress[tp[i]] || (byPress[tp[i]] = { chars: '', err: 0 });
        b.chars += ch; b.err += an.targets[i].err;
      });
      Object.keys(byPress).forEach(function (p) {
        var b = byPress[p], tok = Array.from(b.chars).length > 1 ? b.chars.toLowerCase() : b.chars;
        var k = keys[tok] || (keys[tok] = [0, 0]);
        k[0] += 1; k[1] += Math.min(1, b.err); // one press: at most one error
      });
      var groups = {}, presses = an.presses.typed;
      an.events.forEach(function (e) {
        if (e.type !== 'sub' && e.type !== 'transpose') return;
        var g = presses[e.idx];
        var whole = g != null ? w.stream.filter(function (x, i) { return presses[i] === g; }).map(function (x) { return x.ch; }).join('').toLowerCase() : '';
        if (whole.length > 1 && ms.indexOf(whole) >= 0) {
          if (!groups[g]) { groups[g] = true; land[whole] = (land[whole] || 0) + e.w; }
          return;
        }
        var a = canon(e.actual);
        land[a] = (land[a] || 0) + e.w;
      });
    });
    return { keys: keys, land: land };
  }

  FT.exerciseStats = { timeline: timeline, keyStats: keyStats };
})(globalThis.FT);
