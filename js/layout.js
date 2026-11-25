// Optional keyboard layout declaration and movement classification.
// Format (genkey-like): N rows of whitespace-separated keys, then N rows of
// finger digits with the same shape. Fingers 0..9 = left pinky .. right pinky,
// 4 and 5 are thumbs (as in libdof .dof). A key token of several characters
// (e.g. "th") is a multi-character output (macro). The space key is written
// "space" (also "spc" or "\u2423"); "_" is a literal underscore.
// Categories follow community definitions (Getreuer's glossary; the Keyboard
// layouts doc; layouts.wiki): SFB, SFS, LSB (adjacent fingers, column gap >= 2,
// as genkey), full/half scissors (adjacent fingers 2/1 rows apart with the
// longer finger lower), inward/outward rolls, alternation, redirects.
(function (FT) {
  'use strict';
  // Preferred height: longer fingers prefer higher rows (middle > ring > index > pinky).
  var HEIGHT = { 0: 0, 1: 2, 2: 3, 3: 1, 6: 1, 7: 3, 8: 2, 9: 0 };
  var SPACE = { space: true, spc: true, '\u2423': true };

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
        var tok = SPACE[ks[c].toLowerCase()] ? ' ' : ks[c];
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

  // Split a character sequence into key presses, longest declared key first
  // (so "the" is [th][e] when a th key exists). Returns null if a character
  // is not on the layout.
  function presses(layout, seq) {
    var chars = Array.from(seq), out = [], maxLen = 1;
    layout.macros.forEach(function (m) { maxLen = Math.max(maxLen, Array.from(m).length); });
    for (var i = 0; i < chars.length;) {
      var hit = null;
      for (var len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
        var tok = chars.slice(i, i + len).join('');
        if (layout.keys[tok]) { hit = tok; break; }
      }
      if (!hit) return null;
      out.push(hit);
      i += Array.from(hit).length;
    }
    return out;
  }

  function classify(layout, seq) {
    if (!layout) return null;
    var toks = presses(layout, seq);
    if (!toks) return null;
    var res = classifyPresses(toks.map(function (t) { return layout.keys[t]; }), toks);
    if (res) res.keys = toks;
    return res;
  }

  function classifyPresses(ks, toks) {
    if (ks.length === 1) return Array.from(toks[0]).length > 1 ? { type: 'macro', tags: ['macro'] } : null;
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

  var FINGER = ['left pinky', 'left ring', 'left middle', 'left index', 'left thumb', 'right thumb', 'right index', 'right middle', 'right ring', 'right pinky'];
  // How an intended key and the key actually typed relate on the layout.
  // Adjacent-key and homologous (same finger, other hand) substitutions are the
  // most common kinds in skilled typing (Grudin 1983).
  var KINDS = {
    'reach-up': 'right finger, reach up missed', 'reach-down': 'right finger, reach down missed',
    'same-finger': 'right finger, sideways', neighbour: 'neighbouring key',
    mirror: 'mirror key (same finger, other hand)', 'same-hand': 'same hand, other finger', 'other-hand': 'other hand',
  };
  function rel(kind, detail) { return { kind: kind, label: KINDS[kind] + (detail ? ' (' + detail + ')' : '') }; }
  function relation(layout, expected, actual) {
    if (!layout) return null;
    var a = layout.keys[expected], b = layout.keys[actual];
    if (!a || !b) return null;
    var f = FINGER[a.finger];
    if (a.finger === b.finger) return rel(b.row > a.row ? 'reach-up' : b.row < a.row ? 'reach-down' : 'same-finger', f);
    if (a.hand !== b.hand) return rel(a.finger + b.finger === 9 && a.row === b.row ? 'mirror' : 'other-hand');
    if (Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1) return rel('neighbour', FINGER[b.finger] + ' instead of ' + f);
    return rel('same-hand');
  }

  // Positions for drawing the layout (in key units). Rows that hold only
  // thumb keys are thumb clusters, centred under their hand; in other rows
  // the right hand's keys are shifted by a one-key gap. No stagger geometry.
  function grid(layout) {
    var rows = {};
    Object.keys(layout.keys).forEach(function (k) {
      var info = layout.keys[k];
      (rows[info.row] = rows[info.row] || []).push({ key: k, info: info });
    });
    var isThumb = function (c) { return c.info.finger === 4 || c.info.finger === 5; };
    var rowList = Object.keys(rows).map(function (r) {
      var list = rows[r].sort(function (a, b) { return a.info.col - b.info.col; });
      return { y: +r, list: list, thumb: list.every(isThumb) };
    });
    // Extent of each hand in the main (non-thumb) rows.
    var leftCols = 0, firstRight = Infinity, lastRight = -1;
    rowList.filter(function (r) { return !r.thumb; }).forEach(function (r) {
      r.list.forEach(function (c) {
        if (c.info.hand === 'L') leftCols = Math.max(leftCols, c.info.col + 1);
        else { firstRight = Math.min(firstRight, c.info.col); lastRight = Math.max(lastRight, c.info.col); }
      });
    });
    var rightCols = lastRight >= firstRight ? lastRight - firstRight + 1 : 0, rightStart = leftCols + 1;
    var cells = [];
    rowList.forEach(function (r) {
      ['L', 'R'].forEach(function (hand) {
        var mine = r.list.filter(function (c) { return c.info.hand === hand; });
        var start = hand === 'L' ? (leftCols - mine.length) / 2 : rightStart + (rightCols - mine.length) / 2;
        mine.forEach(function (c, i) {
          var x = r.thumb ? start + i : hand === 'L' ? c.info.col : rightStart + c.info.col - firstRight;
          cells.push({ key: c.key, label: c.key === ' ' ? 'space' : c.key, x: x, y: r.y, hand: hand, finger: c.info.finger });
        });
      });
    });
    var width = cells.reduce(function (a, c) { return Math.max(a, c.x + 1); }, 0);
    return { cells: cells, width: width, height: rowList.length };
  }

  FT.layout = { grid: grid, parse: parse, classify: classify, presses: presses, relation: relation, FINGER: FINGER, KINDS: KINDS };
})(globalThis.FT);
