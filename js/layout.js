// Optional keyboard layout declaration and movement classification.
// Format (genkey-like): N rows of whitespace-separated keys, then N rows of
// finger digits with the same shape. Fingers 0..9 = left pinky .. right pinky,
// 4 and 5 are thumbs (as in libdof .dof). A key token of several characters
// (e.g. "th") is a multi-character output (macro).
// Categories follow community definitions (Getreuer's glossary; the Keyboard
// layouts doc; layouts.wiki): SFB, SFS, LSB (adjacent fingers, column gap >= 2,
// as genkey), full/half scissors (adjacent fingers 2/1 rows apart with the
// longer finger lower), inward/outward rolls, alternation, redirects.
(function (FT) {
  'use strict';
  // Preferred height: longer fingers prefer higher rows (middle > ring > index > pinky).
  var HEIGHT = { 0: 0, 1: 2, 2: 3, 3: 1, 6: 1, 7: 3, 8: 2, 9: 0 };

  function parse(text) {
    var lines = String(text).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length % 2) throw new Error('Expected the same number of key rows and finger rows');
    var n = lines.length / 2, keys = {}, macros = [];
    for (var r = 0; r < n; r++) {
      var ks = lines[r].split(/\s+/), fs = lines[r + n].split(/\s+/);
      if (ks.length !== fs.length) {
        throw new Error('Layout row ' + (r + 1) + ' has ' + ks.length + ' keys but ' + fs.length + ' fingers');
      }
      for (var c = 0; c < ks.length; c++) {
        if (!/^[0-9]$/.test(fs[c])) throw new Error('Unknown finger "' + fs[c] + '" in row ' + (r + 1) + ' (use 0-9)');
        var f = +fs[c];
        var info = { row: r, col: c, finger: f, hand: f <= 4 ? 'L' : 'R' };
        var tok = ks[c];
        if (Array.from(tok).length > 1) { macros.push(tok); keys[tok] = info; }
        else keys[tok] = info;
      }
    }
    return { keys: keys, macros: macros, rows: n };
  }

  function bigram(a, b) {
    if (a === b) return { type: 'repeat', tags: [] };
    if (a.finger === b.finger) return { type: 'sfb', tags: ['sfb'] };
    if (a.hand !== b.hand) return { type: 'alternate', tags: [] };
    var tags = [];
    var adjacent = Math.abs(a.finger - b.finger) === 1 && a.finger !== 4 && a.finger !== 5 && b.finger !== 4 && b.finger !== 5;
    if (adjacent) {
      var dr = Math.abs(a.row - b.row);
      var lower = a.row > b.row ? a : b, upper = lower === a ? b : a;
      if (dr >= 1 && HEIGHT[lower.finger] > HEIGHT[upper.finger]) tags.push(dr >= 2 ? 'full-scissor' : 'half-scissor');
      if (Math.abs(a.col - b.col) >= 2) tags.push('lsb');
    }
    var inward = a.hand === 'L' ? b.finger > a.finger : b.finger < a.finger;
    return { type: inward ? 'roll-in' : 'roll-out', tags: tags };
  }

  function classify(layout, seq) {
    if (!layout) return null;
    if (layout.keys[seq] && Array.from(seq).length > 1) return { type: 'macro', tags: ['macro'] };
    var chars = Array.from(seq);
    var ks = chars.map(function (ch) { return layout.keys[ch]; });
    if (ks.some(function (k) { return !k; })) return null;
    if (ks.length === 2) return bigram(ks[0], ks[1]);
    if (ks.length !== 3) return null;
    var a = ks[0], b = ks[1], c = ks[2], tags = [];
    if (a.finger === c.finger && a.finger !== b.finger) tags.push('sfs');
    var b1 = bigram(a, b), b2 = bigram(b, c);
    b1.tags.concat(b2.tags).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
    var type;
    if (a.hand !== b.hand && b.hand !== c.hand) type = 'alternate';
    else if (a.hand === b.hand && b.hand === c.hand) {
      if (b1.type === 'sfb' || b2.type === 'sfb' || b1.type === 'repeat' || b2.type === 'repeat') type = 'onehand-sfb';
      else {
        var d1 = b.finger - a.finger, d2 = c.finger - b.finger;
        type = d1 * d2 > 0 ? 'onehand' : 'redirect';
      }
    } else type = 'roll';
    return { type: type, tags: tags };
  }

  FT.layout = { parse: parse, classify: classify };
})(globalThis.FT);
