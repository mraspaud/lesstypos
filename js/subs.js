// Recurring substitution analysis (expected x typed as y).
// Rate P(y | x) = count(x->y) / opportunities(x), shrunk toward a global base
// rate per pair: (count + a*m) / (opp + a), m = total subs / (total opps * K).
// a = 50, K = 30 are design choices. Independent of FT.model.
(function (FT) {
  'use strict';
  var MAX_EX = 20, A = 50, K = 30;

  function create(state) {
    var st = state || { opp: {}, pairs: {}, totalSubs: 0, totalOpp: 0 };

    function ingest(words, meta) {
      meta = meta || {};
      for (var i = 0; i < words.length; i++) {
        var an = words[i];
        var P = Array.from(an.P).map(FT.text.canon);
        for (var p = 0; p < P.length; p++) {
          st.opp[P[p]] = (st.opp[P[p]] || 0) + 1;
          st.totalOpp++;
        }
        for (var j = 0; j < an.events.length; j++) {
          var e = an.events[j];
          if (e.type !== 'sub') continue;
          var ex = FT.text.canon(e.expected), ac = FT.text.canon(e.actual);
          var key = ex + '\u0000' + ac;
          var r = st.pairs[key] || (st.pairs[key] = { expected: ex, actual: ac, count: 0, examples: [] });
          r.count += e.w;
          st.totalSubs += e.w;
          r.examples.push({
            word: an.P.trim(),
            context: P.slice(Math.max(0, e.pos - 3), e.pos).join('') + '[' + P[e.pos] + ']' + P.slice(e.pos + 1, e.pos + 4).join(''),
            corrected: !!e.corrected, premature: !!e.premature, case: !!e.case, t: meta.t != null ? meta.t : e.t,
            session: meta.session != null ? meta.session : null, exercise: meta.exercise || null,
          });
          if (r.examples.length > MAX_EX) r.examples.shift();
        }
      }
    }

    function matrix(opts) {
      var minOpp = (opts && opts.minOpp) || 20;
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

    return { ingest: ingest, matrix: matrix, toJSON: function () { return st; } };
  }

  FT.subs = { create: create };
})(globalThis.FT);
