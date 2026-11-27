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
  // Design choice: the optimal alignments enumerated per word are capped, so a
  // long garbled word cannot blow up; the 1/N weights then come from the first
  // MAX_ALIGNMENTS found.
  var MAX_ALIGNMENTS = 32;
  // Characters compare up to typographic equivalence (opts.equivalence, from
  // FT.text.equivalence; accents accepted by default).
  function equivalenceOf(opts) { return (opts && opts.equivalence) || FT.text.equivalence(); }

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

  function msdMatrix(presented, transcribed, same) {
    var distances = [];
    for (var i = 0; i <= presented.length; i++) {
      distances.push(new Array(transcribed.length + 1));
      distances[i][0] = i;
    }
    for (var j = 0; j <= transcribed.length; j++) distances[0][j] = j;
    for (i = 1; i <= presented.length; i++) {
      for (j = 1; j <= transcribed.length; j++) {
        distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1,
          distances[i - 1][j - 1] + (same(presented[i - 1], transcribed[j - 1]) ? 0 : 1));
      }
    }
    return distances;
  }

  // All optimal alignments as arrays of pairs [pIndex|null, tIndex|null], in order.
  function alignments(presented, transcribed, distances, same) {
    var out = [];
    function rec(i, j, acc) {
      if (out.length >= MAX_ALIGNMENTS) return;
      if (i === 0 && j === 0) { out.push(acc.slice().reverse()); return; }
      if (i > 0 && j > 0 && distances[i - 1][j - 1] + (same(presented[i - 1], transcribed[j - 1]) ? 0 : 1) === distances[i][j]) {
        acc.push([i - 1, j - 1]); rec(i - 1, j - 1, acc); acc.pop();
      }
      if (i > 0 && distances[i - 1][j] + 1 === distances[i][j]) {
        acc.push([i - 1, null]); rec(i - 1, j, acc); acc.pop();
      }
      if (j > 0 && distances[i][j - 1] + 1 === distances[i][j]) {
        acc.push([null, j - 1]); rec(i, j - 1, acc); acc.pop();
      }
    }
    rec(presented.length, transcribed.length, []);
    return out;
  }

  // For one alignment: which target position each flagged (surviving)
  // keystroke belongs to, and which omissions come before each of them.
  function mapAlignment(al, nFlagged) {
    var targetOfSurvivor = new Array(nFlagged), omissionsBefore = [];
    for (var q = 0; q <= nFlagged; q++) omissionsBefore.push([]);
    var nextPresented = 0, targetsSeen = 0;
    al.forEach(function (pair) {
      var p = pair[0], tj = pair[1];
      if (tj === null) { omissionsBefore[targetsSeen].push(p); nextPresented = p + 1; return; }
      targetOfSurvivor[tj] = p === null ? { p: null, pos: nextPresented } : { p: p, pos: p };
      if (p !== null) nextPresented = p + 1;
      targetsSeen++;
    });
    return { targetOfSurvivor: targetOfSurvivor, omissionsBefore: omissionsBefore };
  }

  // Collects classified keystrokes and the first attempt at each target position.
  function recorder(presented) {
    var events = [], first = new Array(presented.length);
    function setFirst(pos, err, type, actual, t, idx) {
      if (pos < 0 || pos >= presented.length || first[pos]) return;
      first[pos] = { err: err, type: type, actual: actual, t: t, idx: idx };
    }
    return {
      events: events, first: first,
      correct: function (pos, corrected, e, i) {
        events.push({ type: 'none', corrected: corrected, pos: pos, expected: presented[pos], actual: e.ch, t: e.t, idx: i });
        setFirst(pos, 0, 'none', e.ch, e.t, i);
      },
      sub: function (pos, corrected, e, i) {
        events.push({ type: 'sub', corrected: corrected, pos: pos, expected: presented[pos], actual: e.ch, t: e.t, idx: i });
        setFirst(pos, 1, 'sub', e.ch, e.t, i);
      },
      ins: function (pos, corrected, e, i, attributed) {
        events.push({ type: 'ins', corrected: corrected, pos: pos, actual: e.ch, t: e.t, idx: i });
        if (attributed) setFirst(pos, 1, 'ins', e.ch, e.t, i);
      },
      omit: function (pos, corrected, t, i) {
        events.push({ type: 'omit', corrected: corrected, pos: pos, expected: presented[pos], t: t, idx: i });
        setFirst(pos, 1, 'omit', null, t, i);
      },
      firstCorrect: function (pos, e, i) { setFirst(pos, 0, 'none', e.ch, e.t, i); },
      transpose: function (pos, corrected, a, i, b, j) {
        events.push({ type: 'transpose', swapStart: true, corrected: corrected, pos: pos, expected: presented[pos], actual: a.ch, t: a.t, idx: i });
        events.push({ type: 'transpose', corrected: corrected, pos: pos + 1, expected: presented[pos + 1], actual: b.ch, t: b.t, idx: j });
        setFirst(pos, 1, 'transpose', a.ch, a.t, i);
        setFirst(pos + 1, 1, 'transpose', b.ch, b.t, j);
      },
    };
  }

  // A flagged keystroke survived into the final text: its alignment says
  // what it was. Returns the next target position.
  function uncorrected(rec, presented, e, i, info, pressErr, same) {
    if (info.p === null) {
      rec.ins(info.pos, false, e, i, !pressErr.has(i));
      pressErr.mark(i);
      return info.pos;
    }
    if (same(presented[info.p], e.ch)) rec.correct(info.p, false, e, i);
    else { rec.sub(info.p, false, e, i); pressErr.mark(i); }
    return info.p + 1;
  }

  // An unflagged letter was later erased: it was an attempt at presented[pos].
  // Returns the next target position.
  function corrected(rec, presented, e, i, pos, pressErr, same) {
    if (pressErr.has(i)) { rec.ins(Math.min(pos, presented.length - 1), true, e, i, false); return pos; } // rest of a wrong press
    if (pos >= presented.length) { rec.ins(presented.length - 1, true, e, i, false); pressErr.mark(i); return presented.length + 1; }
    if (same(e.ch, presented[pos])) { rec.correct(pos, true, e, i); return pos + 1; }
    if (pos + 1 < presented.length && same(e.ch, presented[pos + 1])) { // typed the next letter early
      rec.omit(pos, true, e.t, i);
      rec.firstCorrect(pos + 1, e, i);
      return pos + 2;
    }
    rec.sub(pos, true, e, i);
    pressErr.mark(i);
    return pos + 1;
  }

  // Classifies every keystroke of the stream under one alignment.
  function analyzeOne(presented, stream, flags, flaggedIdx, al, presses, swaps, equivalence) {
    var map = mapAlignment(al, flaggedIdx.length), rec = recorder(presented);
    // presses that already produced a wrong keystroke in this alignment
    var wrong = {};
    var pressErr = {
      has: function (i) { return presses.typed[i] != null && wrong[presses.typed[i]]; },
      mark: function (i) { if (presses.typed[i] != null) wrong[presses.typed[i]] = true; },
    };
    var attempting = 0;   // the target position being attempted
    var live = [];        // the position each letter on screen was typed at
    var survivors = 0;    // flagged keystrokes seen so far
    stream.forEach(function (e, i) {
      if (flags[i]) {
        map.omissionsBefore[survivors].forEach(function (p) { rec.omit(p, false, e.t, i); });
        live.push(attempting);
        attempting = uncorrected(rec, presented, e, i, map.targetOfSurvivor[survivors++], pressErr, equivalence.same);
      } else if (e.k === 'b') {
        if (live.length) attempting = live.pop(); // back to where the erased letter was typed
      } else if (swaps.done[i]) {
        // second letter of an erased swap, recorded with the first
      } else if (swaps.at[i] && swaps.at[i].pos === attempting && !flags[i + 1]) {
        rec.transpose(attempting, true, e, i, stream[i + 1], i + 1);
        swaps.done[i + 1] = true;
        live.push(attempting, attempting + 1);
        attempting += 2;
      } else {
        live.push(attempting);
        attempting = corrected(rec, presented, e, i, attempting, pressErr, equivalence.same);
      }
    });
    swaps.done = {};
    var lastT = stream.length ? stream[stream.length - 1].t : 0;
    map.omissionsBefore[flaggedIdx.length].forEach(function (p) { rec.omit(p, false, lastT, stream.length); });
    tagPatterns(presented, rec.events, swaps, equivalence.canon);
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
  // letters read presented[k+1] presented[k] (two different letters) after
  // presented[0..k) (letters of swaps already found count as right),
  // keystrokes i, j typed a swap at k.
  // list: every swap; at: swaps typed as two consecutive keystrokes, by i.
  function findSwaps(presented, stream, same) {
    var list = [], at = {}, text = [], swapPos = {};
    var prefixOk = function (k) {
      for (var q = 0; q < k; q++) if (!same(text[q].ch, presented[q]) && swapPos[text[q].i] !== q) return false;
      return true;
    };
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      if (e.k === 'b') { text.pop(); continue; }
      if (e.k !== 'c') continue;
      text.push({ ch: e.ch, i: i });
      var k = text.length - 2;
      if (k < 0 || k + 1 >= presented.length || same(presented[k], presented[k + 1])) continue;
      if (!same(text[k].ch, presented[k + 1]) || !same(text[k + 1].ch, presented[k]) || !prefixOk(k)) continue;
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

  // Disjoint sets over 0..n-1 (union by linking roots, path halving).
  function unionFind(n) {
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(i) { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; }
    return { find: find, union: function (into, other) { parent[find(other)] = find(into); } };
  }

  // Wrong first attempts typed by the same press are one mistake; so are an
  // omitted letter and a substituted letter of the same target press (one key
  // pressed where a multi-letter key was meant). Separate wrong presses stay
  // separate. Each group totals one error. Omissions are not linked through
  // the keystroke that followed them. (Design choice, user decision.)
  function sharePressErrors(first, presses, links) {
    var groups = unionFind(first.length);
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

  // Tags substitutions that typed a later letter early (premature) or the
  // right letter in the wrong case, and the pairs typed as swaps.
  function tagPatterns(presented, events, swaps, canon) {
    var canonical = presented.map(canon);
    var subs = events.filter(function (e) { return e.type === 'sub'; });
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i], a = canon(s.actual);
      s.premature = canonical.indexOf(a, s.pos + 1) > s.pos;
      s.case = a !== canonical[s.pos] && a.toLowerCase() === canonical[s.pos].toLowerCase();
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

  // The analysis of one word: its keystroke classes, its error events (each
  // weighted by the share of the optimal alignments that has it) and the
  // first attempt at each target position. presented: the target text (P in
  // Wobbrock & Myers); the letters that survived form the transcribed text (T).
  // opts: { macros, gapMs (FT.presses.ids), equivalence }.
  function analyzeWord(presented, stream, opts) {
    var macros = (opts && opts.macros) || [], equivalence = equivalenceOf(opts);
    var presses = { typed: FT.presses.ids(stream, macros, opts && opts.gapMs), target: FT.presses.ofTarget(presented, macros) };
    var flags = flagStream(stream);
    var flaggedIdx = [];
    var transcribed = '';
    for (var i = 0; i < stream.length; i++) if (flags[i]) { flaggedIdx.push(i); transcribed += stream[i].ch; }
    var target = Array.from(presented), typed = Array.from(transcribed);
    var distances = msdMatrix(target, typed, equivalence.same);
    var msd = distances[target.length][typed.length];
    var swaps = findSwaps(target, stream, equivalence.same);
    var kept = preferSwaps(alignments(target, typed, distances, equivalence.same), swaps, flags, flaggedIdx);
    var analyses = kept.map(function (al) { return analyzeOne(target, stream, flags, flaggedIdx, al, presses, swaps, equivalence); });
    var weight = 1 / kept.length;
    var counts = keystrokeCounts(stream, flags);
    return {
      P: presented, T: transcribed, msd: msd,
      counts: { C: Math.max(target.length, typed.length) - msd, INF: msd, IF: counts.IF, F: counts.F },
      events: mergeEvents(analyses, weight),
      targets: firstAttempts(analyses, weight, target, stream, equivalence.canon),
      presses: presses,
    };
  }
  // The same event found in several alignments is one event, weighted by
  // their share.
  function mergeEvents(analyses, weight) {
    var merged = {}, order = [];
    analyses.forEach(function (r) {
      r.events.forEach(function (e) {
        var key = [e.type, e.corrected, e.pos, e.idx].join('|');
        if (!merged[key]) { merged[key] = Object.assign({}, e, { w: 0 }); order.push(key); }
        merged[key].w += weight;
      });
    });
    return order.map(function (k) { return merged[k]; });
  }
  // Per target position: its first-attempt error (shared across alignments),
  // the kinds of that attempt, the wrong characters typed, and when and by
  // which keystroke (and input group) it was first attempted.
  function firstAttempts(analyses, weight, target, stream, canon) {
    var positions = target.map(function (ch, pos) { return { ch: canon(ch), pos: pos, err: 0, types: {}, t: null, g: null, idx: null, actual: {} }; });
    analyses.forEach(function (r) {
      positions.forEach(function (position, p) {
        var f = r.first[p];
        if (!f) return;
        position.err += f.err * weight;
        position.types[f.type] = (position.types[f.type] || 0) + weight;
        if (f.err && f.actual != null) position.actual[f.actual] = (position.actual[f.actual] || 0) + weight;
        if (position.t === null || f.t < position.t) {
          position.t = f.t;
          var keystroke = stream[f.idx];
          position.g = keystroke ? keystroke.g : null;
          position.idx = f.idx;
        }
      });
    });
    positions.forEach(function (position) { position.err = Math.round(position.err * 1e9) / 1e9; });
    return positions;
  }
  // Backspaces (F) and erased letters (IF), Soukoreff & MacKenzie (2003).
  function keystrokeCounts(stream, flags) {
    var IF = 0, F = 0;
    for (var i = 0; i < stream.length; i++) {
      if (stream[i].k === 'b') F++;
      else if (!flags[i]) IF++;
    }
    return { IF: IF, F: F };
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
  // opts: { macros, equivalence } as for analyzeWord, and committed: the
  // word has ended, so its last separator ended it and what it never got is wrong.
  function displayWord(word, stream, opts) {
    var macros = opts && opts.macros, same = equivalenceOf(opts).same;
    var target = Array.from(word);
    var flags = flagStream(stream), ids = FT.presses.ids(stream, macros);
    var alive = stream.map(function (e, i) { return i; }).filter(function (i) { return flags[i]; });
    var last = alive[alive.length - 1];
    var endsWord = last != null && /^[ \n]$/.test(stream[last].ch) && (alive.length - 1 >= target.length || !!(opts && opts.committed));
    var shown = endsWord ? alive.slice(0, -1) : alive;   // a space before the end is a typed letter
    var typedPresses = groupBy(shown.map(function (i) { return stream[i]; }), shown.map(function (i) { return ids[i]; }));
    var targetPresses = groupBy(target.map(function (ch) { return { ch: ch }; }), FT.presses.ofTarget(word, macros));
    var positions = target.map(function () { return { status: 'untyped', group: null, press: false }; });
    var extras = [], at = 0, k = 0;
    var mark = function (p, ok, group, multi) { positions[p] = ok ? { status: 'ok', group: null, press: false } : { status: 'bad', group: group, press: multi }; };
    targetPresses.forEach(function (want) {
      var tp = typedPresses[k];
      if (!tp) return;
      if (want.length > 1 && tp.length === 1 && same(tp[0].ch, want[0].ch)) {
        // the multi-letter key spelled out with single keys: letter by letter
        for (var j = 0; j < want.length && typedPresses[k] && typedPresses[k].length === 1; j++, k++) mark(at + j, same(typedPresses[k][0].ch, want[j].ch), at + j, false);
        for (; j < want.length && typedPresses[k]; j++) mark(at + j, false, at + j, false);   // cut short by a multi-letter press
      } else {
        var ok = tp.length === want.length && tp.every(function (e, j) { return same(e.ch, want[j].ch); });
        want.forEach(function (_, j) { mark(at + j, ok, at, tp.length > 1 || want.length > 1); });
        k++;
      }
      at += want.length;
    });
    typedPresses.slice(k).forEach(function (tp) { tp.forEach(function (e) { extras.push(e.ch); }); });
    var typed = positions.filter(function (p) { return p.status !== 'untyped'; }).length;
    if (opts && opts.committed) positions.forEach(function (p, i) { if (p.status === 'untyped') positions[i] = { status: 'bad', group: i, press: false }; });
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
