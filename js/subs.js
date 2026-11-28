// Recurring substitution analysis (expected key x typed as y).
// Opportunities are presses of the intended key: a declared multi-letter key
// (FT.presses.ofTarget) is a key of its own, so a th press is not a t
// opportunity, and the substitutions on one press share one slip (user
// decision: one key action is one mistake).
// Rate P(y | x) = count(x->y) / opportunities(x), shrunk toward a global base
// rate per pair: (count + a*m) / (opp + a), m = total subs / (total opps * K),
// with a = SHRINKAGE and K = BASE_SPREAD (design choices). Independent of FT.model.
// Premature slips (a letter of later in the word typed early, FT.align) are
// sequencing errors, kept apart from the finger confusions, with their own
// base rate.
// Confirmed pairs: like a sequence (FT.judgement), a pair is confirmed when
// its rate is credibly above the base rate, P > CONFIRM_P under the beta
// posterior of the shrunk rate (Efron & Morris 1975), and it was seen in
// MIN_SESSIONS separate sessions (user decision: replication). Design choice:
// a session counts once it holds at least SESSION_MIN_SLIPS of the pair's
// slips (half of an ambiguous alignment or a shared press).
// Swapped letters (transpositions, Salthouse 1986) are their own kind of slip:
// counted per intended letter pair over that pair's occurrences in targets.
(function (FT) {
  'use strict';
  var MAX_EXAMPLES = 20, SHRINKAGE = 50, BASE_SPREAD = 30, MIN_OPPORTUNITIES = 20;
  var CONFIRM_P = 0.95, MIN_SESSIONS = 2, SESSION_MIN_SLIPS = 0.5;

  // meta.equivalence: FT.text.equivalence, as for the analyses.
  function create(state) {
    var st = Object.assign({ opp: {}, pairs: {}, totalSubs: 0, premature: {}, totalPremature: 0, totalOpp: 0, swaps: {}, pairOpp: {} }, state);

    function ingest(words, meta) {
      meta = meta || {};
      var equivalence = meta.equivalence || FT.text.equivalence(), canon = equivalence.canon;
      for (var i = 0; i < words.length; i++) {
        var an = words[i];
        var target = Array.from(an.P).map(canon), keys = intendedKeys(target, an.presses.target);
        countOpportunities(target, keys, equivalence);
        recordSwaps(an, target, meta);
        recordSubstitutions(an, target, keys, meta, canon);
      }
    }

    // The intended keys of a word: each target press with the positions it
    // covers (list), and the press at each position (at); a multi-letter key
    // goes by its lowercase name.
    function intendedKeys(target, pressOf) {
      var list = [], at = [];
      target.forEach(function (ch, pos) {
        var last = list[list.length - 1];
        if (last && pressOf[pos] === pressOf[pos - 1]) { last.chars += ch; last.length++; } else list.push(last = { chars: ch, start: pos, length: 1 });
        at.push(last);
      });
      list.forEach(function (k) { k.name = k.length > 1 ? k.chars.toLowerCase() : k.chars; });
      return { list: list, at: at };
    }

    // Each press of an intended key is an opportunity for a slip; so is each
    // pair of different letters, for a swap.
    function countOpportunities(target, keys, equivalence) {
      keys.list.forEach(function (k) {
        st.opp[k.name] = (st.opp[k.name] || 0) + 1;
        st.totalOpp++;
      });
      for (var p = 0; p + 1 < target.length; p++) {
        var letters = target[p] + target[p + 1];
        if (!equivalence.same(target[p], target[p + 1])) st.pairOpp[letters] = (st.pairOpp[letters] || 0) + 1;
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
    // One press is one mistake: the substitutions on one intended key share
    // at most one slip, in proportion to their weights.
    function recordSubstitutions(an, target, keys, meta, canon) {
      var byKey = {};
      an.events.forEach(function (e) {
        if (e.type !== 'sub') return;
        var key = keys.at[e.pos], slip = byKey[key.start] || (byKey[key.start] = { key: key, events: [], w: 0 });
        slip.events.push(e);
        slip.w += e.w;
      });
      Object.keys(byKey).forEach(function (start) {
        var slip = byKey[start], share = Math.min(1, slip.w) / slip.w;
        slip.events.forEach(function (e) { recordSubstitution(an, target, slip.key, e, e.w * share, meta, canon); });
      });
    }
    function recordSubstitution(an, target, key, e, w, meta, canon) {
      var expected = key.name, actual = canon(e.actual), session = FT.valueOr(meta.session, null);
      var id = expected + '\u0000' + actual, records = e.premature ? st.premature : st.pairs;
      var r = records[id] || (records[id] = { expected: expected, actual: actual, count: 0, sessions: {}, examples: [] });
      r.count += w;
      r.sessions[session] = (r.sessions[session] || 0) + w;
      if (e.premature) st.totalPremature += w; else st.totalSubs += w;
      keepExample(r, {
        word: an.P.trim(), context: contextAround(target, key.start, key.chars, key.length),
        corrected: !!e.corrected, premature: !!e.premature, case: !!e.case, t: FT.valueOr(meta.t, e.t),
        session: session, exercise: meta.exercise || null,
      });
    }
    function recordSwaps(an, target, meta) {
      an.events.forEach(function (e) { if (e.type === 'transpose' && e.swapStart) recordSwap(an, target, e, meta); });
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

    // Finger confusions: a key typed for another.
    function matrix(opts) { return slipRows(st.pairs, st.totalSubs, opts); }
    // Confirmed finger confusions, whatever their opportunities.
    function confirmedPairs() { return matrix({ minOpp: 0 }).filter(function (r) { return r.confirmed; }); }
    // Premature slips: a letter of later in the word typed early.
    function premature(opts) { return slipRows(st.premature, st.totalPremature, opts); }

    // Rows of slip pairs, the most likely first: observed and shrunk rates,
    // the base rate, the posterior probability of being above it, and the
    // sessions that saw the pair.
    function slipRows(records, total, opts) {
      var minOpp = FT.valueOr(opts && opts.minOpp, MIN_OPPORTUNITIES);
      var m = st.totalOpp ? total / (st.totalOpp * BASE_SPREAD) : 0;
      return Object.keys(records).map(function (k) {
        var r = records[k], opp = st.opp[r.expected] || 0;
        var alpha = SHRINKAGE * m + r.count, beta = SHRINKAGE * (1 - m) + Math.max(0, opp - r.count);
        var pAbove = m > 0 ? 1 - FT.stats.betaCdf(m, alpha, beta) : 0;
        var sessions = sessionsSeen(r);
        return {
          expected: r.expected, actual: r.actual, count: r.count, opportunities: opp,
          observedRate: opp ? r.count / opp : 0,
          rate: alpha / (alpha + beta),
          baseRate: m, pAbove: pAbove, sessions: sessions,
          confirmed: pAbove > CONFIRM_P && sessions >= MIN_SESSIONS,
          examples: r.examples.slice().reverse(),
        };
      }).filter(function (r) { return r.opportunities >= minOpp; })
        .sort(function (a, b) { return b.rate - a.rate; });
    }
    function sessionsSeen(record) {
      return Object.keys(record.sessions).filter(function (s) { return record.sessions[s] >= SESSION_MIN_SLIPS; }).length;
    }

    return { ingest: ingest, matrix: matrix, premature: premature, confirmedPairs: confirmedPairs, swaps: swaps, toJSON: function () { return st; } };
  }

  FT.subs = { create: create, MIN_SESSIONS: MIN_SESSIONS };
})(globalThis.FT);
