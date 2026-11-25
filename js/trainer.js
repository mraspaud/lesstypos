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
    var bursts = FT.bursts.create(p.bursts || null);
    var sessionCount = p.sessionCount || 0;
    var seed = opts.seed || 1;
    var history = p.history || []; // compact per-exercise summaries
    var now = opts.now || function () { return Date.now(); };

    function targets() {
      return model.trainingTargets({ session: sessionCount + 1, day: dayOf(now()), freq: corpus.freqWeight });
    }

    // o.pinned: contexts chosen by the user; they replace the model's targets
    // and get a larger share of the text.
    // Word sources per exercise type:
    //   relaxed   frontier mix with training targets (the default generator);
    //   targeted  denser in training targets (or the user's pinned sequences);
    //   warmup    familiar words: frontier 0.5x (look-ahead stays below it);
    //   bursts    familiar words: frontier 0.6x;
    //   prose     the next words of the current text, from its saved position.
    function newExercise(o) {
      var type = o.type, F = difficulty.state().frontier;
      if (type === 'prose') return proseExercise(o);
      var pinned = o.pinned && o.pinned.length;
      var shares, frontier = F, tg = [];
      if (type === 'warmup' || type === 'bursts') {
        frontier = Math.max(type === 'warmup' ? 0.5 * F : 0.6 * F, 60);
        shares = { random: 0.2, target: 0, maintenance: 0 };
      } else if (pinned) {
        tg = o.pinned.map(function (k) { return { key: k, priority: 1, stage: 'weak' }; });
        shares = { random: 0.2, target: 0.5, maintenance: 0 };
      } else {
        tg = targets().slice(0, 10);
        if (type === 'targeted') shares = { random: 0.2, target: 0.5, maintenance: 0.15 };
      }
      var gen = FT.generator.create({ corpus: corpus, seed: seed + sessionCount * 31 + 7, shares: shares });
      var ctx = { frontier: frontier, targets: tg };
      return { type: type, words: gen.next(400, ctx), more: function (n) { return gen.next(n, ctx); }, targets: tg,
        noTargets: type === 'targeted' && !pinned && !tg.length };
    }
    function proseExercise(o) {
      var text = o.text, at = text.pos || 0, batch = o.batch || 400;
      function take(n) {
        var out = text.words.slice(at, at + n).map(function (w) { return { word: w, source: 'prose' }; });
        at += out.length;
        return out;
      }
      return { type: 'prose', words: take(batch), more: take, targets: [], text: { id: text.id, from: text.pos || 0 } };
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
      if (input.text) raw.text = { id: input.text.id, from: input.text.from, to: input.text.from + input.words.length };
      if (input.rounds) raw.rounds = input.rounds;
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
        timeline: FT.progress.timeline(words),
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
      if (raw.type === 'bursts' && raw.rounds) {
        summary.rounds = bursts.apply(words, raw.rounds, history, raw.startedAt);
      }
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
      bursts: { target: function () { return bursts.ensure(history); }, step: FT.bursts.step,
        reference: function () { return FT.bursts.relaxedMedian(history); } },
      history: function () { return history; },
      profile: function () {
        return { lang: lang, modelVersion: FT.MODEL_VERSION, sessionCount: sessionCount, model: model.toJSON(), subs: subs.toJSON(),
          difficulty: difficulty.toJSON(), bursts: bursts.toJSON(), history: history };
      },
    };
  }

  function rebuild(raws, opts) {
    var t = create(Object.assign({}, opts, { profile: null }));
    raws.slice().sort(function (a, b) { return a.startedAt - b.startedAt; }).forEach(function (r) { t.process(r); });
    return t;
  }

  function needsRebuild(profile) { return !!profile && profile.modelVersion !== FT.MODEL_VERSION; }

  FT.trainer = { create: create, rebuild: rebuild, dayOf: dayOf, needsRebuild: needsRebuild };
})(globalThis.FT);
