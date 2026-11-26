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
  // accents: letters with diacritics also match their base letter (é = e).
  function makeEquivalence(accents) {
    var cache = {};
    function canon(ch) {
      if (ch == null) return ch;
      if (cache[ch] !== undefined) return cache[ch];
      var out = MAP[ch];
      if (out === undefined) {
        out = ch;
        if (accents && /[^\u0000-\u007f]/.test(ch)) {
          var base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (Array.from(base).length === 1) out = base;
        }
      }
      return (cache[ch] = out);
    }
    function same(a, b) { return a === b || canon(a) === canon(b); }
    function sameChars(x, y, n) {
      for (var i = 0; i < n; i++) if (!same(x[i], y[i])) return false;
      return true;
    }
    function sameStr(a, b) {
      var x = Array.from(a), y = Array.from(b);
      return x.length === y.length && sameChars(x, y, x.length);
    }
    function isPrefix(a, b) {
      var x = Array.from(a), y = Array.from(b);
      return x.length <= y.length && sameChars(x, y, x.length);
    }
    return { accents: accents, canon: canon, same: same, sameStr: sameStr, isPrefix: isPrefix };
  }
  var equivalences = { true: makeEquivalence(true), false: makeEquivalence(false) };
  // The equivalence for the given options (accents accepted unless false).
  function equivalence(opts) { return equivalences[!opts || opts.accents !== false]; }

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

  FT.text = { equivalence: equivalence, prepare: prepare };
})(globalThis.FT);
