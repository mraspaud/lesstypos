// Recurring substitution analysis (expected x typed as y).
// Rate P(y | x) = count(x->y) / opportunities(x), shrunk toward a global base
// rate per pair: (count + a*m) / (opp + a), m = total subs / (total opps * K),
// with a = SHRINKAGE and K = BASE_SPREAD (design choices). Independent of FT.model.
// Swapped letters (transpositions, Salthouse 1986) are their own kind of slip:
// counted per intended letter pair over that pair's occurrences in targets.
(function (FT) {
  'use strict';
  var MAX_EXAMPLES = 20, SHRINKAGE = 50, BASE_SPREAD = 30, MIN_OPPORTUNITIES = 20;

  // meta.equivalence: FT.text.equivalence, as for the analyses.
  function create(state) {
    var st = Object.assign({ opp: {}, pairs: {}, totalSubs: 0, totalOpp: 0, swaps: {}, pairOpp: {} }, state);

    function ingest(words, meta) {
      meta = meta || {};
      var equivalence = meta.equivalence || FT.text.equivalence(), canon = equivalence.canon;
      for (var i = 0; i < words.length; i++) {
        var an = words[i];
        var target = Array.from(an.P).map(canon);
        countOpportunities(target, equivalence);
        for (var j = 0; j < an.events.length; j++) {
          var e = an.events[j];
          if (e.type === 'transpose' && e.swapStart) recordSwap(an, target, e, meta);
          if (e.type === 'sub') recordSubstitution(an, target, e, meta, canon);
        }
      }
    }

    // Each letter of the target, and each pair of different letters, is an
    // opportunity for a slip.
    function countOpportunities(target, equivalence) {
      for (var p = 0; p < target.length; p++) {
        st.opp[target[p]] = (st.opp[target[p]] || 0) + 1;
        st.totalOpp++;
        if (p + 1 < target.length && !equivalence.same(target[p], target[p + 1])) {
          st.pairOpp[target[p] + target[p + 1]] = (st.pairOpp[target[p] + target[p + 1]] || 0) + 1;
        }
      }
    }
    // The letters around position pos, with `marked` in brackets in its place.
    function contextAround(target, pos, marked, length) {
      return target.slice(Math.max(0, pos - 3), pos).join('') + '[' + marked + ']' + target.slice(pos + length, pos + length + 3).join('');
    }
    function keepExample(r, example) {
      r.examples.push(example);
      if (r.examples.length > MAX_EXAMPLES) r.examples.shift();
    }
    function recordSubstitution(an, target, e, meta, canon) {
      var expected = canon(e.expected), actual = canon(e.actual);
      var key = expected + '\u0000' + actual;
      var r = st.pairs[key] || (st.pairs[key] = { expected: expected, actual: actual, count: 0, examples: [] });
      r.count += e.w;
      st.totalSubs += e.w;
      keepExample(r, {
        word: an.P.trim(), context: contextAround(target, e.pos, target[e.pos], 1),
        corrected: !!e.corrected, premature: !!e.premature, case: !!e.case, t: FT.valueOr(meta.t, e.t),
        session: FT.valueOr(meta.session, null), exercise: meta.exercise || null,
      });
    }
    function recordSwap(an, target, e, meta) {
      var expected = target[e.pos] + target[e.pos + 1];
      var r = st.swaps[expected] || (st.swaps[expected] = { expected: expected, actual: target[e.pos + 1] + target[e.pos], count: 0, examples: [] });
      r.count += e.w;
      keepExample(r, {
        word: an.P.trim(), context: contextAround(target, e.pos, expected, 2).replace(/ +$/, ''),
        corrected: !!e.corrected, t: FT.valueOr(meta.t, e.t), session: FT.valueOr(meta.session, null), exercise: meta.exercise || null,
      });
    }

    // Swapped letter pairs: count and occurrences of the intended pair.
    function swaps(opts) {
      var minOpp = FT.valueOr(opts && opts.minOpp, MIN_OPPORTUNITIES);
      return Object.keys(st.swaps).map(function (k) {
        var r = st.swaps[k], opp = st.pairOpp[k] || 0;
        return { expected: r.expected, actual: r.actual, count: r.count, opportunities: opp,
          observedRate: opp ? r.count / opp : 0, examples: r.examples.slice().reverse() };
      }).filter(function (r) { return r.opportunities >= minOpp; })
        .sort(function (a, b) { return b.count - a.count || b.observedRate - a.observedRate; });
    }

    function matrix(opts) {
      var minOpp = FT.valueOr(opts && opts.minOpp, MIN_OPPORTUNITIES);
      var m = st.totalOpp ? st.totalSubs / (st.totalOpp * BASE_SPREAD) : 0;
      return Object.keys(st.pairs).map(function (k) {
        var r = st.pairs[k], opp = st.opp[r.expected] || 0;
        return {
          expected: r.expected, actual: r.actual, count: r.count, opportunities: opp,
          observedRate: opp ? r.count / opp : 0,
          rate: (r.count + SHRINKAGE * m) / (opp + SHRINKAGE),
          baseRate: m,
          examples: r.examples.slice().reverse(),
        };
      }).filter(function (r) { return r.opportunities >= minOpp; })
        .sort(function (a, b) { return b.rate - a.rate; });
    }

    return { ingest: ingest, matrix: matrix, swaps: swaps, toJSON: function () { return st; } };
  }

  FT.subs = { create: create };
})(globalThis.FT);
