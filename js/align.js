// Character-level error analysis of the input stream.
// Follows Wobbrock & Myers (2006), "Analyzing the input stream for
// character-level errors in unconstrained text entry evaluations", TOCHI 13(4):
//   FLAG-STREAM -> MSD matrix -> all optimal alignments -> position values ->
//   classification of flagged (uncorrected) and unflagged (corrected) keystrokes.
// Ambiguous alignments are weighted 1/N (MacKenzie & Soukoreff 2002).
// Keystroke classes C/INF/IF/F as in Soukoreff & MacKenzie (2003).
// Transposition: two adjacent letters typed in swapped order (an error class
// of Salthouse 1986). Design choices (user decision for the count): a swap is
// recognised on the text on screen, right after correctly typed letters, so
// an erased or retyped swap is found too; among equally optimal alignments,
// those agreeing with a surviving swap are kept; a swap is one error shared by
// its two positions. Limitation: two swaps left uncorrected in one word are
// not found when the edit distance prefers another alignment (it has no
// transposition operation, unlike Damerau-Levenshtein). "premature" is a
// post-hoc tag.
// Presses (design choice, user decision): one key action is one mistake. With
// declared multi-letter keys (opts.macros), letters of one wrong press, on the
// typed side (FT.presses.ids) or the target side (FT.presses.ofTarget),
// count as one first-attempt error shared between their positions; an extra
// letter that came out of a press which already made a mistake is part of it.
// Keystroke classes (C/INF/IF/F) stay per character.
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

  // For one alignment: which target position each flagged (surviving)
  // keystroke belongs to, and which omissions come before each of them.
  function mapAlignment(al, nFlagged) {
    var tInfo = new Array(nFlagged), omissionsBefore = [];
    for (var q = 0; q <= nFlagged; q++) omissionsBefore.push([]);
    var nextP = 0, seenT = 0;
    al.forEach(function (pair) {
      var p = pair[0], tj = pair[1];
      if (tj === null) { omissionsBefore[seenT].push(p); nextP = p + 1; return; }
      tInfo[tj] = p === null ? { p: null, pos: nextP } : { p: p, pos: p };
      if (p !== null) nextP = p + 1;
      seenT++;
    });
    return { tInfo: tInfo, omissionsBefore: omissionsBefore };
  }

  // Collects classified keystrokes and the first attempt at each target position.
  function recorder(P) {
    var events = [], first = new Array(P.length);
    function setFirst(pos, err, type, actual, t, idx) {
      if (pos < 0 || pos >= P.length || first[pos]) return;
      first[pos] = { err: err, type: type, actual: actual, t: t, idx: idx };
    }
    return {
      events: events, first: first,
      correct: function (pos, corrected, e, i) {
        events.push({ type: 'none', corrected: corrected, pos: pos, expected: P[pos], actual: e.ch, t: e.t, idx: i });
        setFirst(pos, 0, 'none', e.ch, e.t, i);
      },
      sub: function (pos, corrected, e, i) {
        events.push({ type: 'sub', corrected: corrected, pos: pos, expected: P[pos], actual: e.ch, t: e.t, idx: i });
        setFirst(pos, 1, 'sub', e.ch, e.t, i);
      },
      ins: function (pos, corrected, e, i, attributed) {
        events.push({ type: 'ins', corrected: corrected, pos: pos, actual: e.ch, t: e.t, idx: i });
        if (attributed) setFirst(pos, 1, 'ins', e.ch, e.t, i);
      },
      omit: function (pos, corrected, t, i) {
        events.push({ type: 'omit', corrected: corrected, pos: pos, expected: P[pos], t: t, idx: i });
        setFirst(pos, 1, 'omit', null, t, i);
      },
      firstCorrect: function (pos, e, i) { setFirst(pos, 0, 'none', e.ch, e.t, i); },
      transpose: function (pos, corrected, a, i, b, j) {
        events.push({ type: 'transpose', swapStart: true, corrected: corrected, pos: pos, expected: P[pos], actual: a.ch, t: a.t, idx: i });
        events.push({ type: 'transpose', corrected: corrected, pos: pos + 1, expected: P[pos + 1], actual: b.ch, t: b.t, idx: j });
        setFirst(pos, 1, 'transpose', a.ch, a.t, i);
        setFirst(pos + 1, 1, 'transpose', b.ch, b.t, j);
      },
    };
  }

  // A flagged keystroke survived into the final text: its alignment says
  // what it was. Returns the next target position.
  function uncorrected(rec, P, e, i, info, pressErr) {
    if (info.p === null) {
      rec.ins(info.pos, false, e, i, !pressErr.has(i));
      pressErr.mark(i);
      return info.pos;
    }
    if (eq(P[info.p], e.ch)) rec.correct(info.p, false, e, i);
    else { rec.sub(info.p, false, e, i); pressErr.mark(i); }
    return info.p + 1;
  }

  // An unflagged letter was later erased: it was an attempt at P[pos].
  // Returns the next target position.
  function corrected(rec, P, e, i, pos, pressErr) {
    if (pressErr.has(i)) { rec.ins(Math.min(pos, P.length - 1), true, e, i, false); return pos; } // rest of a wrong press
    if (pos >= P.length) { rec.ins(P.length - 1, true, e, i, false); pressErr.mark(i); return P.length + 1; }
    if (eq(e.ch, P[pos])) { rec.correct(pos, true, e, i); return pos + 1; }
    if (pos + 1 < P.length && eq(e.ch, P[pos + 1])) { // typed the next letter early
      rec.omit(pos, true, e.t, i);
      rec.firstCorrect(pos + 1, e, i);
      return pos + 2;
    }
    rec.sub(pos, true, e, i);
    pressErr.mark(i);
    return pos + 1;
  }

  function analyzeOne(P, stream, flags, flaggedIdx, al, presses, swaps) {
    var map = mapAlignment(al, flaggedIdx.length), rec = recorder(P);
    // presses that already produced a wrong keystroke in this alignment
    var wrong = {};
    var pressErr = {
      has: function (i) { return presses.typed[i] != null && wrong[presses.typed[i]]; },
      mark: function (i) { if (presses.typed[i] != null) wrong[presses.typed[i]] = true; },
    };
    var v = 0, live = [], tCount = 0; // v: target position being attempted; live: position each letter on screen was typed at
    stream.forEach(function (e, i) {
      if (flags[i]) {
        map.omissionsBefore[tCount].forEach(function (p) { rec.omit(p, false, e.t, i); });
        live.push(v);
        v = uncorrected(rec, P, e, i, map.tInfo[tCount++], pressErr);
      } else if (e.k === 'b') {
        if (live.length) v = live.pop(); // back to where the erased letter was typed
      } else if (swaps.done[i]) {
        // second letter of an erased swap, recorded with the first
      } else if (swaps.at[i] && swaps.at[i].pos === v && !flags[i + 1]) {
        rec.transpose(v, true, e, i, stream[i + 1], i + 1);
        swaps.done[i + 1] = true;
        live.push(v, v + 1);
        v += 2;
      } else {
        live.push(v);
        v = corrected(rec, P, e, i, v, pressErr);
      }
    });
    swaps.done = {};
    var lastT = stream.length ? stream[stream.length - 1].t : 0;
    map.omissionsBefore[flaggedIdx.length].forEach(function (p) { rec.omit(p, false, lastT, stream.length); });
    tagPatterns(P, rec.events, swaps);
    sharePressErrors(rec.first, presses, swapLinks(rec, swaps));
    return { events: rec.events, first: rec.first };
  }

  // Positions whose first attempt was one of the swaps found: [pos, pos + 1].
  function swapLinks(rec, swaps) {
    var links = [];
    swaps.list.forEach(function (sw) {
      var a = rec.first[sw.pos], b = rec.first[sw.pos + 1];
      if (a && b && a.idx === sw.i && b.idx === sw.j) { a.type = b.type = 'transpose'; links.push([sw.pos, sw.pos + 1]); }
    });
    return links;
  }

  // Swaps, read from the text on screen as it was typed: whenever its last two
  // letters read P[k+1] P[k] (P[k] != P[k+1]) after P[0..k) (letters of swaps
  // already found count as right), keystrokes i, j typed a swap at k.
  // list: every swap; at: swaps typed as two consecutive keystrokes, by i.
  function findSwaps(P, stream) {
    var list = [], at = {}, text = [], swapPos = {};
    var prefixOk = function (k) {
      for (var q = 0; q < k; q++) if (!eq(text[q].ch, P[q]) && swapPos[text[q].i] !== q) return false;
      return true;
    };
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      if (e.k === 'b') { text.pop(); continue; }
      if (e.k !== 'c') continue;
      text.push({ ch: e.ch, i: i });
      var k = text.length - 2;
      if (k < 0 || k + 1 >= P.length || eq(P[k], P[k + 1])) continue;
      if (!eq(text[k].ch, P[k + 1]) || !eq(text[k + 1].ch, P[k]) || !prefixOk(k)) continue;
      var sw = { i: text[k].i, j: i, pos: k };
      list.push(sw);
      swapPos[sw.i] = k; swapPos[sw.j] = k + 1;
      if (sw.j === sw.i + 1) at[sw.i] = { pos: k, next: sw.j };
    }
    return { list: list, at: at, done: {} };
  }

  // Keep the alignments that place each surviving swap as two substitutions
  // at its positions, when there are such alignments.
  function preferSwaps(als, swaps, flags, flaggedIdx) {
    var tOf = {};
    flaggedIdx.forEach(function (si, tj) { tOf[si] = tj; });
    var wanted = swaps.list.filter(function (sw) { return flags[sw.i] && flags[sw.j]; });
    if (!wanted.length) return als;
    var has = function (al, p, tj) { return al.some(function (x) { return x[0] === p && x[1] === tj; }); };
    var kept = als.filter(function (al) {
      return wanted.every(function (sw) { return has(al, sw.pos, tOf[sw.i]) && has(al, sw.pos + 1, tOf[sw.j]); });
    });
    return kept.length ? kept : als;
  }

  // Wrong first attempts typed by the same press are one mistake; so are an
  // omitted letter and a substituted letter of the same target press (one key
  // pressed where a multi-letter key was meant). Separate wrong presses stay
  // separate. Each group totals one error. Omissions are not linked through
  // the keystroke that followed them. (Design choice, user decision.)
  function sharePressErrors(first, presses, links) {
    var groups = FT.presses.unionFind(first.length);
    (links || []).forEach(function (l) { groups.union(l[0], l[1]); }); // a transposition is one error
    var byTyped = {};
    first.forEach(function (f, pos) {
      if (!f || !f.err || f.type === 'omit') return;
      var press = presses.typed[f.idx];
      if (press == null) return;
      if (byTyped[press] == null) byTyped[press] = pos; else groups.union(byTyped[press], pos);
    });
    first.forEach(function (f, pos) {
      if (!f || !f.err || f.type !== 'omit') return;
      first.forEach(function (g, q) {
        if (q !== pos && g && g.err && g.type === 'sub' && presses.target[q] === presses.target[pos]) groups.union(q, pos);
      });
    });
    var size = {};
    first.forEach(function (f, pos) { if (f && f.err) size[groups.find(pos)] = (size[groups.find(pos)] || 0) + 1; });
    first.forEach(function (f, pos) { if (f && f.err) f.err = 1 / size[groups.find(pos)]; });
  }

  function tagPatterns(P, events, swaps) {
    var C = P.map(FT.text.canon);
    var subs = events.filter(function (e) { return e.type === 'sub'; });
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i], a = FT.text.canon(s.actual);
      s.premature = C.indexOf(a, s.pos + 1) > s.pos;
      s.case = a !== C[s.pos] && a.toLowerCase() === C[s.pos].toLowerCase();
    }
    // Substitutions made by the keystrokes of a swap found on screen.
    var find = function (idx, pos) {
      return events.filter(function (e) { return e.idx === idx && e.pos === pos && (e.type === 'sub' || e.type === 'transpose'); })[0];
    };
    swaps.list.forEach(function (sw) {
      var x = find(sw.i, sw.pos), y = find(sw.j, sw.pos + 1);
      if (!x || !y) return;
      if (x.type === 'transpose' && x.swapStart) { y.type = 'transpose'; y.premature = false; return; } // already counted
      x.type = y.type = 'transpose'; x.swapStart = true;
      x.premature = y.premature = false;
    });
  }

  function analyzeWord(P, stream, opts) {
    var macros = (opts && opts.macros) || [];
    var presses = { typed: FT.presses.ids(stream, macros, opts && opts.gapMs), target: FT.presses.ofTarget(P, macros) };
    var flags = flagStream(stream);
    var flaggedIdx = [];
    var T = '';
    for (var i = 0; i < stream.length; i++) if (flags[i]) { flaggedIdx.push(i); T += stream[i].ch; }
    var Parr = Array.from(P), Tarr = Array.from(T);
    var D = msdMatrix(Parr, Tarr);
    var msd = D[Parr.length][Tarr.length];
    var swaps = findSwaps(Parr, stream);
    var als = preferSwaps(alignments(Parr, Tarr, D), swaps, flags, flaggedIdx);
    var w = 1 / als.length;
    var merged = {};
    var order = [];
    var targets = Parr.map(function (ch, pos) { return { ch: FT.text.canon(ch), pos: pos, err: 0, types: {}, t: null, g: null, idx: null, actual: {} }; });
    for (var a = 0; a < als.length; a++) {
      var r = analyzeOne(Parr, stream, flags, flaggedIdx, als[a], presses, swaps);
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
      presses: presses,
    };
  }

  // The analysis of each typed word, against its target with its separator.
  function analyzeWords(words, opts) {
    return words.map(function (w) { return analyzeWord(FT.session.targetOf(w), w.stream, opts); });
  }

  // What the word on screen shows: the typed presses compared with the target
  // presses by position (user decision: a red letter stays where the mistake
  // was made), so a multi-letter press counts as one on either side.
  //   positions[i]: { status: ok | bad | untyped, group, press } (group: the
  //                 first letter of the wrong target press, for one joined
  //                 mark; press: a multi-letter press is involved);
  //   extras:       letters of presses beyond the word, shown after it;
  //   cursor:       number of rendered letters typed.
  function displayWord(word, stream, macros) {
    var target = Array.from(word);
    var flags = flagStream(stream), ids = FT.presses.ids(stream, macros);
    var shown = stream.map(function (e, i) { return i; }).filter(function (i) { return flags[i] && !/^[ \n]$/.test(stream[i].ch); });
    var typedPresses = groupBy(shown.map(function (i) { return stream[i]; }), shown.map(function (i) { return ids[i]; }));
    var targetPresses = groupBy(target.map(function (ch) { return { ch: ch }; }), FT.presses.ofTarget(word, macros));
    var positions = target.map(function () { return { status: 'untyped', group: null, press: false }; });
    var extras = [], at = 0, k = 0;
    var mark = function (p, ok, group, multi) { positions[p] = ok ? { status: 'ok', group: null, press: false } : { status: 'bad', group: group, press: multi }; };
    targetPresses.forEach(function (want) {
      var tp = typedPresses[k];
      if (!tp) return;
      if (want.length > 1 && tp.length === 1 && eq(tp[0].ch, want[0].ch)) {
        // the multi-letter key spelled out with single keys: letter by letter
        for (var j = 0; j < want.length && typedPresses[k] && typedPresses[k].length === 1; j++, k++) mark(at + j, eq(typedPresses[k][0].ch, want[j].ch), at + j, false);
        for (; j < want.length && typedPresses[k]; j++) mark(at + j, false, at + j, false);   // cut short by a multi-letter press
      } else {
        var ok = tp.length === want.length && tp.every(function (e, j) { return eq(e.ch, want[j].ch); });
        want.forEach(function (_, j) { mark(at + j, ok, at, tp.length > 1 || want.length > 1); });
        k++;
      }
      at += want.length;
    });
    typedPresses.slice(k).forEach(function (tp) { tp.forEach(function (e) { extras.push(e.ch); }); });
    var typed = positions.filter(function (p) { return p.status !== 'untyped'; }).length;
    return { positions: positions, extras: extras, cursor: typed + extras.length };
  }
  // Consecutive items with the same id, in order.
  function groupBy(items, ids) {
    var out = [];
    items.forEach(function (x, i) {
      if (i > 0 && ids[i] === ids[i - 1] && ids[i] != null) out[out.length - 1].push(x);
      else out.push([x]);
    });
    return out;
  }

  FT.align = { displayWord: displayWord, analyzeWord: analyzeWord, analyzeWords: analyzeWords, flagStream: flagStream };
})(globalThis.FT);
