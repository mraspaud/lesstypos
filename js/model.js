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
    // The judgement changes only with the day asked about, new evidence or
    // new stages, so it is computed once per (day, change).
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
      endSession: function (meta) {
        var stageChanges = FT.stages.endSession(st, evaluate({ day: meta.day }), meta, cfg);
        changes++;
        return stageChanges;
      },
      trainingTargets: function (when) { return FT.stages.trainingTargets(st, evaluate({ day: when.day }), when); },
      config: cfg,
      state: function () { return st; },
      toJSON: function () { return { cfg: cfg, state: FT.evidence.pack(st) }; },
    };
  }

  function fromJSON(j) { return create(j.cfg, j.state); }

  FT.model = { create: create, fromJSON: fromJSON, MAX_ORDER: FT.evidence.MAX_ORDER };
})(globalThis.FT);
