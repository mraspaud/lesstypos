// Statistics of one exercise, from its words and their analyses: the
// per-word timeline and the per-key error counts.
(function (FT) {
  'use strict';
  // Words per minute, a word being 5 characters.
  function wpm(chars, ms) { return chars / 5 / (ms / 60000); }

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
      var duration = end - start, elapsed = end - t0;
      out.push({
        i: out.length + 1, word: w.target, t: end - t0,
        burst: duration > 0 ? wpm(chars, duration) : null,
        running: elapsed > 0 ? wpm(correct, elapsed) : null,
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
    var keys = {}, land = {};
    words.forEach(function (w, i) {
      countPresses(keys, analyses[i], macros);
      countLandings(land, w, analyses[i], (macros || []).map(function (m) { return m.toLowerCase(); }), canon);
    });
    return { keys: keys, land: land };
  }
  // The word's target presses, each with its first-attempt errors (one press:
  // at most one error).
  function countPresses(keys, analysis, macros) {
    var letters = analysis.targets.map(function (x) { return x.ch; });
    var pressOf = FT.presses.ofTarget(letters.join(''), macros), byPress = {};
    letters.forEach(function (ch, i) {
      var press = byPress[pressOf[i]] || (byPress[pressOf[i]] = { chars: '', err: 0 });
      press.chars += ch; press.err += analysis.targets[i].err;
    });
    Object.keys(byPress).forEach(function (id) {
      var press = byPress[id], name = Array.from(press.chars).length > 1 ? press.chars.toLowerCase() : press.chars;
      var counts = keys[name] || (keys[name] = [0, 0]);
      counts[0] += 1; counts[1] += Math.min(1, press.err);
    });
  }
  // Where the word's wrong presses landed: a declared multi-letter key once
  // per press, otherwise the character typed.
  function countLandings(land, word, analysis, multiLetterKeys, canon) {
    var counted = {}, typedPress = analysis.presses.typed;
    analysis.events.forEach(function (e) {
      if (e.type !== 'sub' && e.type !== 'transpose') return;
      var press = typedPress[e.idx];
      var whole = press != null ? word.stream.filter(function (x, i) { return typedPress[i] === press; }).map(function (x) { return x.ch; }).join('').toLowerCase() : '';
      if (whole.length > 1 && multiLetterKeys.indexOf(whole) >= 0) {
        if (!counted[press]) { counted[press] = true; land[whole] = (land[whole] || 0) + e.w; }
        return;
      }
      var typed = canon(e.actual);
      land[typed] = (land[typed] || 0) + e.w;
    });
  }

  FT.exerciseStats = { timeline: timeline, keyStats: keyStats };
})(globalThis.FT);
