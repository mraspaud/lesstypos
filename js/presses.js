// Presses: one key action. A declared multi-letter key (a keyboard macro such
// as "th") is one press on the target side; on the typed side, so are the
// characters of one input event, and a declared key sent as fast separate
// keystrokes. Undeclared fast pairs are never merged. (Design choice, user
// decision: one key action is one mistake.)
(function (FT) {
  'use strict';
  var MACRO_GAP_MS = 30;

  function longestFirst(macros) {
    return (macros || []).map(function (m) { return m.toLowerCase(); })
      .sort(function (a, b) { return Array.from(b).length - Array.from(a).length; });
  }

  // Press index per character of a target text: a declared multi-letter key
  // (longest first, regardless of capitals) is one press.
  function ofTarget(text, macros) {
    var keys = longestFirst(macros), chars = Array.from(text), out = [], press = 0;
    for (var i = 0; i < chars.length;) {
      var len = 1;
      for (var m = 0; m < keys.length; m++) {
        var n = Array.from(keys[m]).length;
        if (n > 1 && chars.slice(i, i + n).join('').toLowerCase() === keys[m]) { len = n; break; }
      }
      for (var j = 0; j < len; j++) out.push(press);
      press++; i += len;
    }
    return out;
  }

  // Press id per stream entry (null for backspaces). Consecutive characters
  // that form a declared multi-letter key (or the start of one) and arrive
  // less than gapMs apart are one press.
  function ids(stream, macros, gapMs) {
    var keys = longestFirst(macros), gap = FT.valueOr(gapMs, MACRO_GAP_MS), out = [], press = -1;
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      if (e.k !== 'c') { out.push(null); continue; }
      var prev = i > 0 && stream[i - 1].k === 'c' ? stream[i - 1] : null;
      var samePress = prev && prev.g != null && prev.g === e.g;
      if (!samePress && prev && keys.length) {
        var start = i - 1;
        while (start > 0 && out[start - 1] === out[i - 1]) start--;
        var pressSoFar = stream.slice(start, i + 1).map(function (x) { return x.ch; }).join('').toLowerCase();
        samePress = e.t - prev.t < gap && keys.some(function (m) { return m.indexOf(pressSoFar) === 0; });
      }
      if (!samePress) press++;
      out.push(press);
    }
    return out;
  }

  FT.presses = { ids: ids, ofTarget: ofTarget, MACRO_GAP_MS: MACRO_GAP_MS };
})(globalThis.FT);
