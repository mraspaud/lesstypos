// Character-level error analysis of the input stream.
// Follows Wobbrock & Myers (2006), "Analyzing the input stream for
// character-level errors in unconstrained text entry evaluations", TOCHI 13(4):
//   FLAG-STREAM -> MSD matrix -> all optimal alignments -> position values ->
//   classification of flagged (uncorrected) and unflagged (corrected) keystrokes.
// Ambiguous alignments are weighted 1/N (MacKenzie & Soukoreff 2002).
// Keystroke classes C/INF/IF/F as in Soukoreff & MacKenzie (2003).
// Transposition (Salthouse 1986) and "premature" are post-hoc tags.
(function (FT) {
  'use strict';
  var MAX_ALIGNMENTS = 32;
  // Characters compare up to typographic equivalence (FT.text.same).
  function eq(a, b) { return FT.text.same(a, b); }

  function flagStream(stream) {
    var flags = new Array(stream.length);
    var count = 0;
    for (var i = stream.length - 1; i >= 0; i--) {
      if (stream[i].k === 'b') { count++; flags[i] = false; }
      else if (count === 0) flags[i] = true;
      else { count--; flags[i] = false; }
    }
    return flags;
  }

  function msdMatrix(P, T) {
    var D = [];
    for (var i = 0; i <= P.length; i++) {
      D.push(new Array(T.length + 1));
      D[i][0] = i;
    }
    for (var j = 0; j <= T.length; j++) D[0][j] = j;
    for (i = 1; i <= P.length; i++) {
      for (j = 1; j <= T.length; j++) {
        D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1,
          D[i - 1][j - 1] + (eq(P[i - 1], T[j - 1]) ? 0 : 1));
      }
    }
    return D;
  }

  // All optimal alignments as arrays of pairs [pIndex|null, tIndex|null], in order.
  function alignments(P, T, D) {
    var out = [];
    function rec(i, j, acc) {
      if (out.length >= MAX_ALIGNMENTS) return;
      if (i === 0 && j === 0) { out.push(acc.slice().reverse()); return; }
      if (i > 0 && j > 0 && D[i - 1][j - 1] + (eq(P[i - 1], T[j - 1]) ? 0 : 1) === D[i][j]) {
        acc.push([i - 1, j - 1]); rec(i - 1, j - 1, acc); acc.pop();
      }
      if (i > 0 && D[i - 1][j] + 1 === D[i][j]) {
        acc.push([i - 1, null]); rec(i - 1, j, acc); acc.pop();
      }
      if (j > 0 && D[i][j - 1] + 1 === D[i][j]) {
        acc.push([null, j - 1]); rec(i, j - 1, acc); acc.pop();
      }
    }
    rec(P.length, T.length, []);
    return out;
  }

  function analyzeOne(P, stream, flags, flaggedIdx, al) {
    var events = [];
    var first = new Array(P.length); // {err, type, actual, t, idx}
    // Map each flagged keystroke (by T index) to its alignment pair; collect omissions.
    var tInfo = new Array(flaggedIdx.length);
    var omissionsBefore = new Array(flaggedIdx.length + 1);
    for (var q = 0; q <= flaggedIdx.length; q++) omissionsBefore[q] = [];
    var nextP = 0;
    var seenT = 0; // index of the next flagged keystroke
    for (var a = 0; a < al.length; a++) {
      var p = al[a][0], tj = al[a][1];
      if (tj === null) {
        omissionsBefore[seenT].push(p); // omission of P[p] precedes the next flagged keystroke
        nextP = p + 1;
      } else {
        tInfo[tj] = p === null ? { p: null, pos: nextP } : { p: p, pos: p };
        if (p !== null) nextP = p + 1;
        seenT++;
      }
    }

    function setFirst(pos, err, type, actual, t, idx) {
      if (pos < 0 || pos >= P.length || first[pos]) return;
      first[pos] = { err: err, type: type, actual: actual, t: t, idx: idx };
    }

    var v = 0;
    var live = []; // positions of live letters (for backspace)
    var tCount = 0;
    var lastT = stream.length ? stream[stream.length - 1].t : 0;
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      if (flags[i]) {
        // omissions located before this flagged keystroke
        var oms = omissionsBefore[tCount];
        for (var o = 0; o < oms.length; o++) {
          events.push({ type: 'omit', corrected: false, pos: oms[o], expected: P[oms[o]], t: e.t, idx: i });
          setFirst(oms[o], 1, 'omit', null, e.t, i);
        }
        var info = tInfo[tCount++];
        if (info.p === null) {
          events.push({ type: 'ins', corrected: false, pos: info.pos, actual: e.ch, t: e.t, idx: i });
          setFirst(info.pos, 1, 'ins', e.ch, e.t, i);
          v = info.pos;
        } else {
          var ok = eq(P[info.p], e.ch);
          events.push(ok
            ? { type: 'none', corrected: false, pos: info.p, expected: P[info.p], actual: e.ch, t: e.t, idx: i }
            : { type: 'sub', corrected: false, pos: info.p, expected: P[info.p], actual: e.ch, t: e.t, idx: i });
          setFirst(info.p, ok ? 0 : 1, ok ? 'none' : 'sub', e.ch, e.t, i);
          v = info.p + 1;
        }
        live.push(v);
      } else if (e.k === 'b') {
        if (live.length) v = live.pop() - 1;
        if (v < 0) v = 0;
        // position of the erased letter becomes current again
        v = Math.max(0, v);
      } else {
        // unflagged letter: a corrected keystroke attempting P[v]
        var pos = v;
        if (pos >= P.length) {
          events.push({ type: 'ins', corrected: true, pos: P.length - 1, actual: e.ch, t: e.t, idx: i });
          pos = P.length;
        } else if (eq(e.ch, P[pos])) {
          events.push({ type: 'none', corrected: true, pos: pos, expected: P[pos], actual: e.ch, t: e.t, idx: i });
          setFirst(pos, 0, 'none', e.ch, e.t, i);
        } else if (pos + 1 < P.length && eq(e.ch, P[pos + 1])) {
          events.push({ type: 'omit', corrected: true, pos: pos, expected: P[pos], t: e.t, idx: i });
          setFirst(pos, 1, 'omit', null, e.t, i);
          pos = pos + 1;
          setFirst(pos, 0, 'none', e.ch, e.t, i);
        } else {
          events.push({ type: 'sub', corrected: true, pos: pos, expected: P[pos], actual: e.ch, t: e.t, idx: i });
          setFirst(pos, 1, 'sub', e.ch, e.t, i);
        }
        v = pos + 1;
        live.push(v);
      }
    }
    var trailing = omissionsBefore[flaggedIdx.length];
    for (o = 0; o < trailing.length; o++) {
      events.push({ type: 'omit', corrected: false, pos: trailing[o], expected: P[trailing[o]], t: lastT, idx: stream.length });
      setFirst(trailing[o], 1, 'omit', null, lastT, stream.length);
    }
    tagPatterns(P, events);
    return { events: events, first: first };
  }

  function tagPatterns(P, events) {
    var C = P.map(FT.text.canon);
    var subs = events.filter(function (e) { return e.type === 'sub'; });
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i], a = FT.text.canon(s.actual);
      s.premature = C.indexOf(a, s.pos + 1) > s.pos;
      s.case = a !== C[s.pos] && a.toLowerCase() === C[s.pos].toLowerCase();
    }
    for (i = 0; i + 1 < subs.length; i++) {
      var x = subs[i], y = subs[i + 1];
      if (x.corrected === y.corrected && y.pos === x.pos + 1 &&
          eq(x.actual, P[y.pos]) && eq(y.actual, P[x.pos])) {
        x.type = 'transpose'; y.type = 'transpose';
        x.premature = y.premature = false;
        i++;
      }
    }
  }

  function analyzeWord(P, stream) {
    var flags = flagStream(stream);
    var flaggedIdx = [];
    var T = '';
    for (var i = 0; i < stream.length; i++) if (flags[i]) { flaggedIdx.push(i); T += stream[i].ch; }
    var Parr = Array.from(P), Tarr = Array.from(T);
    var D = msdMatrix(Parr, Tarr);
    var msd = D[Parr.length][Tarr.length];
    var als = alignments(Parr, Tarr, D);
    var w = 1 / als.length;
    var merged = {};
    var order = [];
    var targets = Parr.map(function (ch, pos) { return { ch: FT.text.canon(ch), pos: pos, err: 0, types: {}, t: null, g: null, idx: null, actual: {} }; });
    for (var a = 0; a < als.length; a++) {
      var r = analyzeOne(Parr, stream, flags, flaggedIdx, als[a]);
      for (var k = 0; k < r.events.length; k++) {
        var e = r.events[k];
        var key = [e.type, e.corrected, e.pos, e.idx].join('|');
        if (!merged[key]) { merged[key] = Object.assign({}, e, { w: 0 }); order.push(key); }
        merged[key].w += w;
      }
      for (var p = 0; p < targets.length; p++) {
        var f = r.first[p];
        if (!f) continue;
        var tg = targets[p];
        tg.err += f.err * w;
        tg.types[f.type] = (tg.types[f.type] || 0) + w;
        if (f.err && f.actual != null) tg.actual[f.actual] = (tg.actual[f.actual] || 0) + w;
        if (tg.t === null || f.t < tg.t) {
          tg.t = f.t;
          var se = stream[f.idx];
          tg.g = se ? se.g : null;
          tg.idx = f.idx;
        }
      }
    }
    targets.forEach(function (tg) { tg.err = Math.round(tg.err * 1e9) / 1e9; });
    var events = order.map(function (k) { return merged[k]; });
    var IF = 0, F = 0;
    for (i = 0; i < stream.length; i++) {
      if (stream[i].k === 'b') F++;
      else if (!flags[i]) IF++;
    }
    return {
      P: P, T: T, msd: msd,
      counts: { C: Math.max(Parr.length, Tarr.length) - msd, INF: msd, IF: IF, F: F },
      events: events,
      targets: targets,
    };
  }

  FT.align = { analyzeWord: analyzeWord, flagStream: flagStream };
})(globalThis.FT);
