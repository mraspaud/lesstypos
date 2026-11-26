// Recurring substitution analysis (expected x typed as y).
// Rate P(y | x) = count(x->y) / opportunities(x), shrunk toward a global base
// rate per pair: (count + a*m) / (opp + a), m = total subs / (total opps * K).
// a = 50, K = 30 are design choices. Independent of FT.model.
// Swapped letters (transpositions, Salthouse 1986) are their own kind of slip:
// counted per intended letter pair over that pair's occurrences in targets.
(function (FT) {
  'use strict';
  var MAX_EX = 20, A = 50, K = 30, MIN_OPPORTUNITIES = 20;

  // meta.equivalence: FT.text.equivalence, as for the analyses.
  function create(state) {
    var st = Object.assign({ opp: {}, pairs: {}, totalSubs: 0, totalOpp: 0, swaps: {}, pairOpp: {} }, state);

    function ingest(words, meta) {
      meta = meta || {};
      var equivalence = meta.equivalence || FT.text.equivalence(), canon = equivalence.canon;
      for (var i = 0; i < words.length; i++) {
        var an = words[i];
        var P = Array.from(an.P).map(canon);
        for (var p = 0; p < P.length; p++) {
          st.opp[P[p]] = (st.opp[P[p]] || 0) + 1;
          st.totalOpp++;
          if (p + 1 < P.length && !equivalence.same(P[p], P[p + 1])) st.pairOpp[P[p] + P[p + 1]] = (st.pairOpp[P[p] + P[p + 1]] || 0) + 1;
        }
        for (var j = 0; j < an.events.length; j++) {
          var e = an.events[j];
          if (e.type === 'transpose' && e.swapStart) recordSwap(an, P, e, meta);
          if (e.type !== 'sub') continue;
          var ex = canon(e.expected), ac = canon(e.actual);
          var key = ex + '\u0000' + ac;
          var r = st.pairs[key] || (st.pairs[key] = { expected: ex, actual: ac, count: 0, examples: [] });
          r.count += e.w;
          st.totalSubs += e.w;
          r.examples.push({
            word: an.P.trim(),
            context: P.slice(Math.max(0, e.pos - 3), e.pos).join('') + '[' + P[e.pos] + ']' + P.slice(e.pos + 1, e.pos + 4).join(''),
            corrected: !!e.corrected, premature: !!e.premature, case: !!e.case, t: FT.valueOr(meta.t, e.t),
            session: FT.valueOr(meta.session, null), exercise: meta.exercise || null,
          });
          if (r.examples.length > MAX_EX) r.examples.shift();
        }
      }
    }

    function recordSwap(an, P, e, meta) {
      var ex = P[e.pos] + P[e.pos + 1];
      var r = st.swaps[ex] || (st.swaps[ex] = { expected: ex, actual: P[e.pos + 1] + P[e.pos], count: 0, examples: [] });
      r.count += e.w;
      r.examples.push({
        word: an.P.trim(),
        context: (P.slice(Math.max(0, e.pos - 3), e.pos).join('') + '[' + ex + ']' + P.slice(e.pos + 2, e.pos + 5).join('')).replace(/ +$/, ''),
        corrected: !!e.corrected, t: FT.valueOr(meta.t, e.t), session: FT.valueOr(meta.session, null), exercise: meta.exercise || null,
      });
      if (r.examples.length > MAX_EX) r.examples.shift();
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
      var m = st.totalOpp ? st.totalSubs / (st.totalOpp * K) : 0;
      return Object.keys(st.pairs).map(function (k) {
        var r = st.pairs[k], opp = st.opp[r.expected] || 0;
        return {
          expected: r.expected, actual: r.actual, count: r.count, opportunities: opp,
          observedRate: opp ? r.count / opp : 0,
          rate: (r.count + A * m) / (opp + A),
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
