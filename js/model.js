// Sequence model: the evidence per typing context (FT.evidence), its
// judgement (FT.judgement) and the consolidation stages (FT.stages), behind
// one object that the trainer keeps in the profile.
(function (FT) {
  'use strict';
  // Design choices, except minSessions (user decision: replicated in 2 sessions):
  //   stabilityDays, halfLifeObs     recency weighting (FT.evidence);
  //   minN, minSessionN              keystrokes to judge a context, and to count
  //                                  a session towards replication;
  //   pFlag                          posterior probability of a deficit to flag;
  //   minErrAbs, minErrRel, minLatRel  the smallest excess that matters, in error
  //                                  rate (absolute and relative) and time ratio;
  //   maxExamples                    example words kept per context;
  //   exactSessions, block, bigAfter, bigBlock  compaction (FT.evidence).
  var DEFAULTS = {
    stabilityDays: 30, halfLifeObs: 60, minN: 8, minSessions: 2, minSessionN: 3, pFlag: 0.95, minErrAbs: 0.005, minErrRel: 1.25,
    minLatRel: 1.10, maxExamples: 12, exactSessions: 24, block: 8, bigAfter: 120, bigBlock: 64,
  };

  function create(opts, stored) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var st = FT.evidence.unpack(stored) || FT.evidence.emptyState();
    // The judgement changes only with the day asked about or new evidence
    // (the stages never feed back into it), so it is computed once per
    // (day, ingest).
    var changes = 0, cached = null;
    function evaluate(when) {
      var day = when && when.day != null ? when.day : st.lastDay;
      if (!cached || cached.day !== day || cached.changes !== changes) {
        cached = { day: day, changes: changes, evaluation: FT.judgement.evaluate(st, cfg, day) };
      }
      return cached.evaluation;
    }
    return {
      ingest: function (records, meta) { FT.evidence.ingest(st, records, meta, cfg); changes++; },
      evaluate: evaluate,
      explain: function (key, when) { return FT.judgement.explain(st, cfg, evaluate(when), key); },
      endSession: function (meta) { return FT.stages.endSession(st, evaluate({ day: meta.day }), meta, cfg); },
      trainingTargets: function (when) { return FT.stages.trainingTargets(st, evaluate({ day: when.day }), when); },
      config: cfg,
      state: function () { return st; },
      toJSON: function () { return { state: FT.evidence.pack(st) }; },
    };
  }

  // The longest context of a keystroke with at least minN timed keystrokes,
  // or null. full: the characters before the keystroke, then the keystroke;
  // shorter suffixes are the backoff (as in the judgement).
  function timedContext(evaluation, full, minN) {
    for (var k = Math.min(FT.evidence.MAX_ORDER, full.length); k >= 1; k--) {
      var c = evaluation.get(full.slice(-k));
      if (c && c.latN >= minN) return c;
    }
    return null;
  }

  // The stored evidence, judged with the code's settings (a profile's old
  // stored settings are ignored); opts: overrides, for tests.
  function fromJSON(j, opts) { return create(opts, j.state); }

  FT.model = { create: create, fromJSON: fromJSON, timedContext: timedContext, DEFAULTS: DEFAULTS, MAX_ORDER: FT.evidence.MAX_ORDER };
})(globalThis.FT);
