// Text utilities: character equivalence for typographic characters, and
// preparation of pasted prose.
// Equivalence: the exact character or its ASCII equivalent is accepted
// (curly quotes, dashes, non-breaking space, letters with diacritics).
(function (FT) {
  'use strict';
  var MAP = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", 'ʼ': "'",
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

  FT.text = { canon: canon, same: same, sameStr: sameStr, isPrefix: isPrefix, setOptions: setOptions };
})(globalThis.FT);
