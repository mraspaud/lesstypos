// Trainer: orchestrates exercises end to end and owns the derived profile.
// Raw sessions are processed deterministically by process(), both live and
// when rebuilding the profile from stored raw sessions.
(function (FT) {
  'use strict';
  var feeds = FT.exercises.feeds;

  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // A session, for the sequence statistics, is one programme run or one
  // standalone exercise (user decision). Only exercises that feed the
  // sequence model advance the clock.
  function sessionClock(saved) {
    var count = saved.sessionCount || 0, lastRun = saved.lastRun || null;
    function sessionFor(run) { return run && run === lastRun ? count : count + 1; }
    return {
      sessionFor: sessionFor,
      advance: function (run) { count = sessionFor(run); lastRun = run; return count; },
      sessionCount: function () { return count; },
      lastRun: function () { return lastRun; },
    };
  }

  function create(opts) {
    opts = opts || {};
    var settings = opts.settings || {};
    var lang = (opts.profile && opts.profile.lang) || opts.lang || 'en';
    var corpus = opts.corpus || FT.corpus.get(lang);
    var p = opts.profile || {};
    var model = p.model ? FT.model.fromJSON(p.model) : FT.model.create();
    var subs = FT.subs.create(p.subs || null);
    var difficulty = FT.difficulty.create(p.difficulty, { max: corpus.size });
    var bursts = FT.bursts.create(p.bursts || null);
    var clock = sessionClock(p);
    var seed = opts.seed || 1;
    var history = p.history || []; // compact per-exercise summaries
    var now = opts.now || function () { return Date.now(); };

    function targets(run) {
      return model.trainingTargets({ session: clock.sessionFor(run), day: FT.days.number(now()), freq: corpus.freqWeight });
    }

    // The conditions' comparison (thousands of resamples) changes only with
    // the history or its tags.
    var tagChanges = 0, comparison = null;
    function conditions() {
      var key = history.length + ':' + tagChanges;
      if (!comparison || comparison.key !== key) comparison = { key: key, rows: FT.conditions.compare(history) };
      return comparison.rows;
    }

    var exercisesMade = 0;
    function exerciseSeed() { return seed + 7919 * (++exercisesMade) + 31 * history.length; }

    // o: { type, pinned, text, batch, run }; FT.exercises builds the words.
    function newExercise(o) {
      return FT.exercises.build({
        corpus: corpus, frontier: difficulty.state().frontier, nextSeed: exerciseSeed,
        trainingTargets: function () { return targets(o.run); },
      }, o);
    }

    // The raw record of an exercise (its identity fixed here); processing it
    // is a separate step, so the record can wait for its effort rating.
    function record(input) {
      var raw = {
        id: input.id || uid(), schema: FT.SCHEMA, type: input.type, lang: lang,
        startedAt: input.startedAt, endedAt: input.endedAt || undefined, day: FT.days.number(input.startedAt), durationMs: input.durationMs,
        effort: input.effort == null ? null : input.effort,
        macros: (settings.macros || []).slice(),
        accents: settings.accents !== false,
        run: input.run || null,
        tags: input.tags && input.tags.length ? input.tags.slice() : undefined,
        set: input.set || null,
        planMs: input.planMs || null,
        words: input.words.map(function (w) { return { target: w.target, stream: w.stream.map(FT.codec.withRoundedTime), meta: w.meta || null }; }),
        keys: (input.keys || []).map(FT.codec.withRoundedTime),
        vocab: { manual: !!difficulty.state().manual, frontier: difficulty.state().frontier },
      };
      if (input.text) raw.text = { id: input.text.id, from: input.text.from, to: input.text.from + input.words.length };
      if (input.rounds) raw.rounds = input.rounds;
      return raw;
    }
    function finish(input) {
      var raw = record(input);
      return { raw: raw, summary: process(raw) };
    }

    // Processing a raw session: measure what happened, describe it, let the
    // learners (model, substitutions, burst target, difficulty) update, and
    // record a history entry. Deterministic, so replaying raw sessions
    // rebuilds the same profile.
    function process(raw) {
      var predictedBefore = raw.type === 'benchmark' ? fluencyIndex(raw) : null;
      var session = feeds(raw.type, 'sequences') ? clock.advance(raw.run || raw.id) : clock.sessionCount();
      if (raw.vocab) applyVocabulary(raw.vocab);
      var m = measure(raw);
      var summary = describe(raw, m);
      withOutcome(summary, learn(raw, session, m, summary), difficulty.state().frontier);
      var entry = historyEntry(raw, m, summary);
      history.push(entry);
      FT.history.withFluency(entry, raw.type === 'benchmark' ? predictedBefore : feeds(raw.type, 'sequences') ? fluencyIndex(raw) : null);
      return summary;
    }

    // The experimental fluency index (FT.fluency) from the model and the
    // history as they stand: after an exercise that feeds the model (its own
    // centres in the scale), before a benchmark trial, so the index never rests
    // on the trial it is checked against. The reference is typed with the
    // multi-letter keys declared for the latest exercise.
    function fluencyIndex(raw) {
      return FT.fluency.index(model.evaluate({ day: raw.day }), history, FT.fluency.reference(corpus, raw.macros), { minN: model.config.minN });
    }

    // A fixed vocabulary is part of what happened; replaying it keeps a
    // rebuild faithful.
    function applyVocabulary(v) {
      if (v.manual) difficulty.override(v.frontier);
      else if (difficulty.state().manual) difficulty.override(null);
    }

    // A raw session is analysed with the settings it was typed with.
    function analysisOptions(raw) {
      return { macros: raw.macros, equivalence: FT.text.equivalence({ accents: raw.accents }) };
    }

    function measure(raw) {
      var options = analysisOptions(raw);
      var words = raw.words, analyses = FT.align.analyzeWords(words, options);
      var tm = FT.timing.extract(words, analyses);
      // Speed bursts: speed over the words finished inside the typing rounds,
      // over the rounds' duration (not the rests, not a partial last round).
      var activeMs = raw.durationMs, scored = analyses;
      if (raw.rounds) {
        activeMs = raw.rounds.reduce(function (a, r) { return a + (r.end - r.start); }, 0);
        scored = analyses.filter(function (an, i) {
          return raw.rounds.some(function (r) { return FT.bursts.finishedWithin(words[i], r.start, r.end); });
        });
      }
      var random = analyses.filter(function (an, i) { var meta = words[i].meta; return meta && meta.source === 'random'; });
      return {
        late: FT.keyevents.lateKeys(raw.keys, words, options),
        options: options, words: words, tm: tm, analyses: analyses, pairs: FT.timing.commonPairStats(tm.records),
        metrics: FT.metrics.summarize(scored, { durationMs: activeMs }),
        random: FT.metrics.summarize(random, { durationMs: 0 }),
      };
    }

    // Expected time ratio of a keystroke: from its longest context with
    // enough timing evidence (1 = the session's typical interval for its
    // population, the geometric mean of the trimmed clean intervals).
    function expectedRatio(ev) {
      return function (r) {
        var c = FT.model.timedContext(ev, r.ctx + r.ch, model.config.minN);
        return c ? Math.exp(c.mu) : 1;
      };
    }

    function describe(raw, m, known) {
      var sources = {};
      m.words.forEach(function (w) { var s = (w.meta && w.meta.source) || 'other'; sources[s] = (sources[s] || 0) + 1; });
      return {
        id: raw.id, type: raw.type, startedAt: raw.startedAt, durationMs: raw.durationMs, effort: raw.effort,
        metrics: m.metrics,
        random: { words: m.random.words, firstAttemptAccuracy: m.random.firstAttemptAccuracy },
        hesitationRate: known && 'hesitationRate' in known ? known.hesitationRate : FT.timing.hesitationRate(m.tm.records, expectedRatio(model.evaluate({ day: raw.day }))),
        rhythmCv: FT.timing.rhythmCv(m.tm.records),
        rollover: FT.keyevents.rollover(raw.keys, { exclude: m.late.codes }),
        lateKeys: m.late.chars,
        timeline: FT.exerciseStats.timeline(m.words, m.analyses),
        keyStats: FT.exerciseStats.keyStats(m.words, m.analyses, m.options),
        baseline: m.tm.baseline,
        sources: sources,
      };
    }

    // The learners an exercise feeds update from it; returns what they
    // decided: stage changes, burst rounds and the vocabulary decision.
    function learn(raw, session, m, description) {
      var outcome = { stageChanges: [], difficulty: null };
      if (feeds(raw.type, 'sequences')) {
        model.ingest(m.tm.records, { session: session, day: raw.day, late: m.late });
        outcome.stageChanges = model.endSession({ session: session, day: raw.day });
      }
      if (feeds(raw.type, 'substitutions')) subs.ingest(m.analyses, { equivalence: m.options.equivalence, exercise: raw.type, session: session, t: raw.startedAt });
      if (feeds(raw.type, 'burstTarget') && raw.rounds) outcome.rounds = bursts.apply(m.words, m.analyses, raw.rounds, history, raw.startedAt);
      if (feeds(raw.type, 'difficulty')) {
        outcome.difficulty = difficulty.update({
          words: m.metrics.words, firstAttemptAccuracy: m.metrics.firstAttemptAccuracy,
          hesitationRate: description.hesitationRate, rhythmCv: description.rhythmCv, effort: raw.effort, at: raw.startedAt,
        });
      }
      return outcome;
    }
    function withOutcome(summary, outcome, frontier) {
      summary.stageChanges = outcome.stageChanges;
      summary.difficulty = outcome.difficulty;
      if (outcome.rounds) summary.rounds = outcome.rounds;
      summary.frontier = frontier;
      return summary;
    }

    function historyEntry(raw, m, summary) {
      return FT.history.entry(raw, {
        metrics: m.metrics, random: m.random, commonPairs: m.pairs, wordStartMs: FT.timing.wordStartMs(m.tm.records), centreMs: m.tm.centreMs,
        meanMs: m.tm.meanMs, correction: m.tm.correction,
        hesitationRate: summary.hesitationRate, rhythmCv: summary.rhythmCv, rollover: summary.rollover, keyStats: summary.keyStats,
        frontier: summary.frontier, vocabularyDecision: summary.difficulty, burstRounds: summary.rounds,
      });
    }

    // A past exercise's summary again, from its raw record: measured anew,
    // with that day's decisions and judgements taken from its history entry.
    // Nothing is learned.
    function summarize(raw) {
      var entry = history.filter(function (h) { return h.id === raw.id; })[0] || {};
      var summary = describe(raw, measure(raw), { hesitationRate: entry.hesitationRate });
      return withOutcome(summary, { stageChanges: [], difficulty: entry.vocabularyDecision || null, rounds: entry.burstRounds }, entry.frontier);
    }

    return {
      newExercise: newExercise, record: record, finish: finish, process: process, summarize: summarize, targets: targets,
      explain: function (key) { return model.explain(key, { day: FT.days.number(now()) }); },
      evaluate: function () { return model.evaluate({ day: FT.days.number(now()) }); },
      substitutions: function (o) { return subs.matrix(o); },
      swaps: function (o) { return subs.swaps(o); },
      difficulty: difficulty, model: model, corpus: corpus,
      bursts: { target: function () { return bursts.peek(history); },
        reference: function () { return FT.bursts.relaxedMedian(history); } },
      history: function () { return history; },
      // Tags typed after the exercises were processed (the raw records get them too).
      tag: function (ids, tags) {
        tagChanges++;
        history.forEach(function (h) { if (ids.indexOf(h.id) >= 0) h.tags = tags.length ? tags.slice() : undefined; });
      },
      conditions: conditions,
      profile: function () {
        return { lang: lang, modelVersion: FT.MODEL_VERSION, sessionCount: clock.sessionCount(), lastRun: clock.lastRun(), model: model.toJSON(), subs: subs.toJSON(),
          difficulty: difficulty.toJSON(), bursts: bursts.toJSON(), history: history };
      },
    };
  }

  // Replays raw sessions into a fresh profile. The user's own choices that
  // are not derived from typing (a fixed vocabulary level) carry over from
  // opts.previous.
  function rebuild(raws, opts) {
    var sorted = raws.slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    var lang = (sorted[0] && sorted[0].lang) || (opts && opts.previous && opts.previous.lang) || (opts && opts.lang);
    var t = create(Object.assign({}, opts, { profile: null, previous: null }, lang ? { lang: lang } : {}));
    sorted.forEach(function (r) { t.process(r); });
    var prev = opts && opts.previous && opts.previous.difficulty;
    if (prev) t.difficulty.override(prev.manual ? prev.frontier : null);
    return t;
  }

  function needsRebuild(profile) { return !!profile && profile.modelVersion !== FT.MODEL_VERSION; }

  FT.trainer = { create: create, rebuild: rebuild, needsRebuild: needsRebuild };
})(globalThis.FT);
