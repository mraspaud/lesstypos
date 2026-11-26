// Text utilities: character equivalence for typographic characters, and
// preparation of pasted prose.
// Equivalence: the exact character or its ASCII equivalent is accepted
// (curly quotes, dashes, non-breaking space, letters with diacritics).
(function (FT) {
  'use strict';
  var MAP = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", 'ʼ': "'", '´': "'",
    '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
    '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
    ' ': ' ', ' ': ' ', ' ': ' ',
  };
  var opts = { accents: true };
  var cache = {};

  function canon(ch) {
    if (ch == null) return ch;
    var key = (opts.accents ? 'a' : 'n') + ch;
    if (cache[key] !== undefined) return cache[key];
    var out = MAP[ch];
    if (out === undefined) {
      out = ch;
      if (opts.accents && /[^\u0000-\u007f]/.test(ch)) {
        var base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (Array.from(base).length === 1) out = base;
      }
    }
    return (cache[key] = out);
  }
  function same(a, b) { return a === b || canon(a) === canon(b); }
  function sameStr(a, b) {
    var x = Array.from(a), y = Array.from(b);
    if (x.length !== y.length) return false;
    for (var i = 0; i < x.length; i++) if (!same(x[i], y[i])) return false;
    return true;
  }
  function isPrefix(a, b) { // a is a prefix of b, up to equivalence
    var x = Array.from(a), y = Array.from(b);
    if (x.length > y.length) return false;
    for (var i = 0; i < x.length; i++) if (!same(x[i], y[i])) return false;
    return true;
  }
  function setOptions(o) { Object.assign(opts, o); cache = {}; }
  // Runs fn with the given options, restoring the previous ones afterwards
  // (processing a raw session uses the options it was typed with).
  function withOptions(o, fn) {
    var saved = Object.assign({}, opts);
    setOptions(o);
    try { return fn(); } finally { setOptions(saved); }
  }

  // Pasted prose -> list of words (whitespace-separated tokens, punctuation
  // and capitals kept). The ellipsis becomes "..." (it has no one-character
  // ASCII equivalent). Project Gutenberg boilerplate is removed when present.
  function prepare(raw) {
    var t = String(raw || '').replace(/\r\n?/g, '\n');
    var start = t.search(/^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$/im);
    if (start >= 0) t = t.slice(t.indexOf('\n', start) + 1);
    var end = t.search(/^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG.*$/im);
    if (end >= 0) t = t.slice(0, end);
    t = t.replace(/\u2026/g, '...');
    return t.split(/[\s\u00A0\u2009\u202F]+/).filter(Boolean);
  }

  // ---- presses: one key action ----
  function lowerMacros(macros) {
    return (macros || []).map(function (m) { return m.toLowerCase(); })
      .sort(function (a, b) { return Array.from(b).length - Array.from(a).length; });
  }
  // Press index per character of a target text: a declared multi-letter key
  // (longest first, regardless of capitals) is one press.
  function targetPresses(text, macros) {
    var ms = lowerMacros(macros), chars = Array.from(text), out = [], p = 0;
    for (var i = 0; i < chars.length;) {
      var len = 1;
      for (var m = 0; m < ms.length; m++) {
        var n = Array.from(ms[m]).length;
        if (n > 1 && chars.slice(i, i + n).join('').toLowerCase() === ms[m]) { len = n; break; }
      }
      for (var j = 0; j < len; j++) out.push(p);
      p++; i += len;
    }
    return out;
  }
  // Press id per stream entry (null for backspaces). Characters of one input
  // event share a press; so do consecutive characters that form a declared
  // multi-letter key (or the start of one) and arrive less than gapMs apart (a
  // keyboard macro sending separate keystrokes). Undeclared fast pairs are
  // never merged.
  var MACRO_GAP_MS = 30;
  function pressIds(stream, macros, gapMs) {
    var ms = lowerMacros(macros), gap = FT.valueOr(gapMs, MACRO_GAP_MS), out = [], p = -1;
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      if (e.k !== 'c') { out.push(null); continue; }
      var prev = i > 0 && stream[i - 1].k === 'c' ? stream[i - 1] : null;
      var same = prev && prev.g != null && prev.g === e.g;
      if (!same && prev && ms.length) {
        // characters of the current press so far, plus this one: a declared key?
        var start = i - 1;
        while (start > 0 && out[start - 1] === out[i - 1]) start--;
        var chunk = stream.slice(start, i + 1).map(function (x) { return x.ch; }).join('').toLowerCase();
        same = e.t - prev.t < gap && ms.some(function (m) { return m.indexOf(chunk) === 0; });
      }
      if (!same) p++;
      out.push(p);
    }
    return out;
  }

  FT.text = { targetPresses: targetPresses, pressIds: pressIds, MACRO_GAP_MS: MACRO_GAP_MS, canon: canon, same: same, sameStr: sameStr, isPrefix: isPrefix, setOptions: setOptions, withOptions: withOptions, prepare: prepare };
})(globalThis.FT);
