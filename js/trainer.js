// Trainer: orchestrates exercises end to end and owns the derived profile.
// Raw sessions are processed deterministically by process(), both live and
// when rebuilding the profile from stored raw sessions.
(function (FT) {
  'use strict';
  var MODEL_TYPES = { relaxed: true, warmup: true, targeted: true, prose: true };
  var DIFFICULTY_TYPES = { relaxed: true };

  function dayOf(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 864e5); }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function create(opts) {
    opts = opts || {};
    var settings = opts.settings || {};
    var lang = (opts.profile && opts.profile.lang) || opts.lang || 'en';
    var corpus = opts.corpus || FT.corpus.get(lang);
    var p = opts.profile || {};
    var model = p.model ? FT.model.fromJSON(p.model) : FT.model.create();
    var subs = FT.subs.create(p.subs || null);
    var difficulty = FT.difficulty.create(p.difficulty || { frontier: 200, max: corpus.size });
    var sessionCount = p.sessionCount || 0;
    var seed = opts.seed || 1;
    var history = p.history || []; // compact per-exercise summaries
    var now = opts.now || function () { return Date.now(); };

    function targets() {
      return model.trainingTargets({ session: sessionCount + 1, day: dayOf(now()), freq: corpus.freqWeight });
    }

    function newExercise(o) {
      var gen = FT.generator.create({ corpus: corpus, seed: seed + sessionCount * 31 + 7 });
      var tg = targets().slice(0, 10);
      var ctx = { frontier: difficulty.state().frontier, targets: tg };
      return { type: o.type, words: gen.next(400, ctx), more: function (n) { return gen.next(n, ctx); }, targets: tg };
    }

    function finish(input) {
      var raw = {
        id: input.id || uid(), schema: FT.SCHEMA, type: input.type, lang: lang,
        startedAt: input.startedAt, day: dayOf(input.startedAt), durationMs: input.durationMs,
        effort: input.effort == null ? null : input.effort,
        macros: (settings.macros || []).slice(),
        words: input.words.map(function (w) { return { target: w.target, stream: w.stream, meta: w.meta || null }; }),
        keys: input.keys || [],
      };
      return { raw: raw, summary: process(raw) };
    }

    function cv(a) {
      if (a.length < 2) return null;
      var ms = FT.stats.meanSd(a);
      return ms[0] ? ms[1] / ms[0] : null;
    }

    function process(raw) {
      var session = ++sessionCount;
      var words = raw.words.map(function (w) { return { target: w.target, stream: w.stream, meta: w.meta }; });
      var tm = FT.timing.extract(words, { macros: raw.macros });
      var analyses = words.map(function (w) { return w.analysis; });
      var metrics = FT.metrics.summarize(analyses, { durationMs: raw.durationMs });
      var rnd = words.filter(function (w) { return w.meta && w.meta.source === 'random'; });
      var random = FT.metrics.summarize(rnd.map(function (w) { return w.analysis; }), { durationMs: 0 });

      // Hesitation: clean keystrokes slower than 2x what the model expects for
      // their context (longest context with enough timing evidence).
      var ev0 = model.evaluate({ day: raw.day });
      var clean = tm.records.filter(function (r) { return r.clean; });
      var hes = 0;
      clean.forEach(function (r) {
        var expected = 1, full = r.ctx + r.ch;
        for (var k = Math.min(3, full.length); k >= 1; k--) {
          var j = ev0.get(full.slice(-k));
          if (j && j.latN >= model.config.minN) { expected = Math.exp(j.mu); break; }
        }
        if (r.ratio > 2 * expected) hes++;
      });
      var within = clean.filter(function (r) { return !r.wordInitial; }).map(function (r) { return r.iki; });
      var summary = {
        id: raw.id, type: raw.type, startedAt: raw.startedAt, durationMs: raw.durationMs, effort: raw.effort,
        metrics: metrics,
        random: { words: random.words, firstAttemptAccuracy: random.firstAttemptAccuracy },
        hesitationRate: clean.length ? hes / clean.length : null,
        rhythmCv: cv(within),
        rollover: FT.timing.rollover(raw.keys),
        baseline: tm.baseline,
        sources: {},
        stageChanges: [],
        difficulty: null,
      };
      words.forEach(function (w) { var s = (w.meta && w.meta.source) || 'other'; summary.sources[s] = (summary.sources[s] || 0) + 1; });

      if (MODEL_TYPES[raw.type]) {
        model.ingest(tm.records, { session: session, day: raw.day });
        summary.stageChanges = model.endSession({ session: session, day: raw.day });
      }
      subs.ingest(analyses, { exercise: raw.type, session: session, t: raw.startedAt });
      if (DIFFICULTY_TYPES[raw.type]) {
        summary.difficulty = difficulty.update({
          words: metrics.words, firstAttemptAccuracy: metrics.firstAttemptAccuracy,
          hesitationRate: summary.hesitationRate, rhythmCv: summary.rhythmCv, effort: raw.effort, at: raw.startedAt,
        });
      }
      summary.frontier = difficulty.state().frontier;
      history.push({
        id: raw.id, type: raw.type, t: raw.startedAt, ms: raw.durationMs, effort: raw.effort,
        wpm: metrics.wpm, faa: metrics.firstAttemptAccuracy, randomFaa: random.firstAttemptAccuracy,
        hes: summary.hesitationRate, cv: summary.rhythmCv, roll: summary.rollover, frontier: summary.frontier,
        words: metrics.words,
      });
      return summary;
    }

    return {
      newExercise: newExercise, finish: finish, process: process, targets: targets,
      explain: function (key) { return model.explain(key, { day: dayOf(now()) }); },
      evaluate: function () { return model.evaluate({ day: dayOf(now()) }); },
      substitutions: function (o) { return subs.matrix(o); },
      difficulty: difficulty, model: model, corpus: corpus,
      history: function () { return history; },
      profile: function () {
        return { lang: lang, sessionCount: sessionCount, model: model.toJSON(), subs: subs.toJSON(),
          difficulty: difficulty.toJSON(), history: history };
      },
    };
  }

  function rebuild(raws, opts) {
    var t = create(Object.assign({}, opts, { profile: null }));
    raws.slice().sort(function (a, b) { return a.startedAt - b.startedAt; }).forEach(function (r) { t.process(r); });
    return t;
  }

  FT.trainer = { create: create, rebuild: rebuild, dayOf: dayOf };
})(globalThis.FT);
