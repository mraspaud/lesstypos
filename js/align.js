// Character-level error analysis of the input stream.
// Follows Wobbrock & Myers (2006), "Analyzing the input stream for
// character-level errors in unconstrained text entry evaluations", TOCHI 13(4):
//   FLAG-STREAM -> MSD matrix -> all optimal alignments -> position values ->
//   classification of flagged (uncorrected) and unflagged (corrected) keystrokes.
// Ambiguous alignments are weighted 1/N (MacKenzie & Soukoreff 2002).
// Keystroke classes C/INF/IF/F as in Soukoreff & MacKenzie (2003).
// Transposition (Salthouse 1986): two adjacent letters typed in swapped order,
// right after a correctly typed prefix, are one error shared by both positions.
// Swaps are found from the text on screen when each letter was typed (so an
// erased swap is found too); among equally optimal alignments, those agreeing
// with a surviving swap are kept (design choice). "premature" is a post-hoc tag.
// Presses (design choice, user decision): one key action is one mistake. With
// declared multi-letter keys (opts.macros), letters of one wrong press, on the
// typed side (FT.text.pressIds) or the target side (FT.text.targetPresses),
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
    var v = 0, live = [], tCount = 0; // v: target position being attempted; live: positions after each live letter
    stream.forEach(function (e, i) {
      if (flags[i]) {
        map.omissionsBefore[tCount].forEach(function (p) { rec.omit(p, false, e.t, i); });
        v = uncorrected(rec, P, e, i, map.tInfo[tCount++], pressErr);
        live.push(v);
      } else if (e.k === 'b') {
        if (live.length) v = live.pop() - 1; // back to the erased letter's position
        v = Math.max(0, v);
      } else if (swaps.done[i]) {
        // second letter of an erased swap, recorded with the first
      } else if (swaps.at[i] && swaps.at[i].pos === v && !flags[i + 1]) {
        rec.transpose(v, true, e, i, stream[i + 1], i + 1);
        swaps.done[i + 1] = true;
        live.push(v + 1, v + 2);
        v += 2;
      } else {
        v = corrected(rec, P, e, i, v, pressErr);
        live.push(v);
      }
    });
    swaps.done = {};
    var lastT = stream.length ? stream[stream.length - 1].t : 0;
    map.omissionsBefore[flaggedIdx.length].forEach(function (p) { rec.omit(p, false, lastT, stream.length); });
    tagPatterns(P, rec.events);
    sharePressErrors(rec.first, presses, swapLinks(rec));
    return { events: rec.events, first: rec.first };
  }

  // Positions whose first attempt was one transposition: [pos, pos + 1].
  function swapLinks(rec) {
    var links = [];
    rec.events.forEach(function (e) {
      if (!e.swapStart) return;
      var a = rec.first[e.pos], b = rec.first[e.pos + 1];
      if (a && b && a.idx === e.idx && b.idx === e.idx + 1) { a.type = b.type = 'transpose'; links.push([e.pos, e.pos + 1]); }
    });
    return links;
  }

  // Swaps in the stream: keystroke i typed P[k+1] and keystroke i+1 typed P[k]
  // (P[k] != P[k+1]) right after the text on screen read P[0..k).
  function findSwaps(P, stream) {
    var at = {}, text = [];
    var prefixOk = function (k) { for (var q = 0; q < k; q++) if (!eq(text[q], P[q])) return false; return true; };
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i], n = stream[i + 1];
      if (e.k === 'b') { text.pop(); continue; }
      var k = text.length;
      if (n && n.k === 'c' && k + 1 < P.length && !eq(P[k], P[k + 1]) && eq(e.ch, P[k + 1]) && eq(n.ch, P[k]) && prefixOk(k)) {
        at[i] = { pos: k, next: i + 1 };
      }
      text.push(e.ch);
    }
    return { at: at, done: {} };
  }

  // Keep the alignments that place each surviving swap as two substitutions
  // at its positions, when there are such alignments.
  function preferSwaps(als, swaps, flags, flaggedIdx) {
    var tOf = {};
    flaggedIdx.forEach(function (si, tj) { tOf[si] = tj; });
    var wanted = Object.keys(swaps.at).map(Number).filter(function (i) { return flags[i] && flags[i + 1]; })
      .map(function (i) { return { p: swaps.at[i].pos, tj: tOf[i] }; });
    if (!wanted.length) return als;
    var has = function (al, p, tj) { return al.some(function (x) { return x[0] === p && x[1] === tj; }); };
    var kept = als.filter(function (al) {
      return wanted.every(function (w) { return has(al, w.p, w.tj) && has(al, w.p + 1, w.tj + 1); });
    });
    return kept.length ? kept : als;
  }

  // Wrong first attempts typed by the same press are one mistake; so are an
  // omitted letter and a substituted letter of the same target press (one key
  // pressed where a multi-letter key was meant). Separate wrong presses stay
  // separate. Each group totals one error. Omissions are not linked through
  // the keystroke that followed them. (Design choice, user decision.)
  function sharePressErrors(first, presses, links) {
    var parent = first.map(function (_, i) { return i; });
    var find = function (i) { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    (links || []).forEach(function (l) { parent[find(l[1])] = find(l[0]); }); // a transposition is one error
    var byT = {}, byTyped = {};
    first.forEach(function (f, pos) {
      if (!f || !f.err) return;
      var link = function (map, key) { if (key == null) return; if (map[key] == null) map[key] = pos; else parent[find(pos)] = find(map[key]); };
      if (f.type !== 'omit') link(byTyped, presses.typed[f.idx]);
    });
    first.forEach(function (f, pos) {
      if (!f || !f.err || f.type !== 'omit') return;
      first.forEach(function (g, q) {
        if (q !== pos && g && g.err && g.type === 'sub' && presses.target[q] === presses.target[pos]) parent[find(pos)] = find(q);
      });
    });
    var size = {};
    first.forEach(function (f, pos) { if (f && f.err) size[find(pos)] = (size[find(pos)] || 0) + 1; });
    first.forEach(function (f, pos) { if (f && f.err) f.err = 1 / size[find(pos)]; });
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
        x.type = 'transpose'; y.type = 'transpose'; x.swapStart = true;
        x.premature = y.premature = false;
        i++;
      }
    }
  }

  function analyzeWord(P, stream, opts) {
    var macros = (opts && opts.macros) || [];
    var presses = { typed: FT.text.pressIds(stream, macros, opts && opts.gapMs), target: FT.text.targetPresses(P, macros) };
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
    };
  }

  // What the word on screen shows: the best alignment of the typed text with
  // the target (not a letter-by-letter comparison by position).
  //   positions[i]: { status: ok | bad | untyped, group } (group: one wrong
  //                 press, typed or target side, for one joined mark);
  //   extras:       typed letters with no target letter ({ before, ch }),
  //                 except letters that came out of a press already wrong;
  //   cursor:       number of rendered letters (positions and extras) typed.
  // While a word is in progress (complete false), the untyped rest is free.
  function displayWord(P, typed, stream, macros, complete) {
    var Parr = Array.from(P), T = Array.from(typed.replace(/ $/, '')), n = Parr.length, m = T.length;
    var flags = flagStream(stream), flaggedIdx = [];
    for (var f = 0; f < stream.length; f++) if (flags[f] && stream[f].ch !== ' ') flaggedIdx.push(f);
    var typedPress = FT.text.pressIds(stream, macros), targetPress = FT.text.targetPresses(P, macros);
    var D = msdMatrix(Parr, T);
    var pressOf = function (j) { return typedPress[flaggedIdx[j]]; };
    var typedSize = {}, targetSize = {};
    flaggedIdx.forEach(function (idx) { var p = typedPress[idx]; if (p != null) typedSize[p] = (typedSize[p] || 0) + 1; });
    targetPress.forEach(function (p) { targetSize[p] = (targetSize[p] || 0) + 1; });
    // A finished word aligns to its end. A word in progress may end anywhere;
    // among equally good ends, show the fewest extra letters, then the fewest
    // red ones ("x" for "cat": c is red, not an extra x in front).
    if (complete) return layout(n);
    var best = null;
    for (var e = 0; e <= n; e++) {
      if (D[e][m] !== Math.min.apply(null, D.map(function (row) { return row[m]; }))) continue;
      var r = layout(e), bad = r.positions.filter(function (x) { return x.status === 'bad'; }).length;
      if (!best || r.extras.length < best.extras.length || (r.extras.length === best.extras.length && bad < best.bad)) { best = r; best.bad = bad; }
    }
    delete best.bad;
    return best;

    function layout(end) {
      // One optimal path, walked from the end. On ties an extra letter is placed
      // as late as possible ("caat" for "cat": the second a is the extra), then
      // matches/substitutions, then omissions.
      var ops = [];
      for (var a = end, b = m; a > 0 || b > 0;) {
        if (b > 0 && D[a][b - 1] + 1 === D[a][b]) { ops.push({ p: null, t: b - 1, before: a }); b--; }
        else if (a > 0 && b > 0 && D[a - 1][b - 1] + (eq(Parr[a - 1], T[b - 1]) ? 0 : 1) === D[a][b]) { ops.push({ p: a - 1, t: b - 1 }); a--; b--; }
        else { ops.push({ p: a - 1, t: null }); a--; }
      }
      ops.reverse();
      var wrongPress = {};
      ops.forEach(function (o) { if (o.p != null && o.t != null && !eq(Parr[o.p], T[o.t])) wrongPress[pressOf(o.t)] = true; });
      var positions = Parr.map(function (_, k) { return { status: k < end ? 'ok' : 'untyped', group: null }; });
      var extras = [], parent = Parr.map(function (_, k) { return k; });
      var find = function (k) { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
      var byT = {}, byTyped = {};
      var link = function (map, key, k) { if (key == null) return; if (map[key] == null) map[key] = k; else parent[find(k)] = find(map[key]); };
      ops.forEach(function (o) {
        if (o.p == null) {
          if (!wrongPress[pressOf(o.t)]) extras.push({ before: o.before, ch: T[o.t] });
          return;
        }
        if (o.t != null && eq(Parr[o.p], T[o.t])) return;
        positions[o.p].status = 'bad';
        link(byT, targetPress[o.p], o.p);
        if (o.t != null) link(byTyped, pressOf(o.t), o.p);
      });
      // a group is a press mark when a multi-letter press is involved on either side
      var multi = {};
      ops.forEach(function (o) {
        if (o.p == null || positions[o.p].status !== 'bad') return;
        if (targetSize[targetPress[o.p]] > 1 || (o.t != null && typedSize[pressOf(o.t)] > 1)) multi[find(o.p)] = true;
      });
      positions.forEach(function (x, k) {
        if (x.status !== 'bad') { x.press = false; return; }
        x.group = find(k); x.press = !!multi[x.group];
      });
      return { positions: positions, extras: extras, cursor: end + extras.length };
    }
  }

  FT.align = { displayWord: displayWord, analyzeWord: analyzeWord, flagStream: flagStream };
})(globalThis.FT);
