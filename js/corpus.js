// Vocabulary corpus: ranked word list, context -> carrier words, n-gram frequency.
// Contexts are matched against ' ' + word + ' ', so leading/trailing spaces
// express word-initial / word-final contexts.
(function (FT) {
  'use strict';

  function fromList(words, zipf) {
    var rank = new Map();
    words.forEach(function (w, i) { if (!rank.has(w)) rank.set(w, i); });
    var padded = words.map(function (w) { return ' ' + w + ' '; });
    var cache = new Map();
    function containing(key) {
      if (cache.has(key)) return cache.get(key);
      var out = [];
      for (var i = 0; i < padded.length; i++) if (padded[i].indexOf(key) >= 0) out.push(i);
      cache.set(key, out);
      return out;
    }
    function perMillion(i) { return zipf ? Math.pow(10, zipf[i] - 3) : 1e6 / (i + 10); }
    function occurrences(s, key) {
      var n = 0, at = s.indexOf(key);
      while (at >= 0) { n++; at = s.indexOf(key, at + 1); }
      return n;
    }
    // Inner space splits a context into the end of one word and the start of the next.
    function split(key) {
      for (var i = 1; i < key.length - 1; i++) if (key[i] === ' ') return [key.slice(0, i) + ' ', ' ' + key.slice(i + 1)];
      return null;
    }
    var fcache = new Map();
    function freq(key) {
      if (fcache.has(key)) return fcache.get(key);
      var sp = split(key), f = 0;
      if (sp) f = freq(sp[0]) * freq(sp[1]) / 1e6;
      else containing(key).forEach(function (i) { f += perMillion(i) * occurrences(padded[i], key); });
      fcache.set(key, f);
      return f;
    }
    return {
      words: words, zipf: zipf || null, size: words.length,
      rankOf: function (w) { return rank.has(w) ? rank.get(w) : -1; },
      containing: containing, split: split, freq: freq,
      freqWeight: function (key) { return 1 + Math.log10(1 + freq(key)); },
    };
  }

  var loaded = {};
  function get(lang) {
    if (loaded[lang]) return loaded[lang];
    var d = FT.data && FT.data[lang];
    if (!d) throw new Error('No word list for language: ' + lang);
    return (loaded[lang] = fromList(d.words.split(' '), d.zipf));
  }

  FT.corpus = { fromList: fromList, get: get };
})(globalThis.FT);
