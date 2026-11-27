// The exercise types, in one table: what each is called and tells the typist,
// where its words come from, and which learners its typing feeds.
(function (FT) {
  'use strict';
  var BURST_ROUND_MS = 15000, BURST_REST_MS = 10000, BENCHMARK_TRIALS = 3, BENCHMARK_MINUTES = 1;
  // Benchmark: a fresh, unbiased sample of the most common words.
  var BENCHMARK_RANKS = 5000;
  var FAMILIAR_FLOOR = 60, FIRST_BATCH = 400, MAX_TARGETS = 10;
  var FAMILIAR_SHARES = { random: 0.2, target: 0, maintenance: 0 };
  var TARGETED_SHARES = { random: 0.2, target: 0.5, maintenance: 0.15 };
  // Sequences chosen by the user replace the model's targets and get a larger
  // share of the text.
  var PINNED_SHARES = { random: 0.2, target: 0.5, maintenance: 0 };

  var percent = function (x) { return Math.round(x * 1000) / 10 + '%'; };

  // Builders. ctx: { corpus, frontier, nextSeed(), trainingTargets() };
  // o: the request ({ type, pinned, text, batch }). Every exercise gets its
  // own stream of words.
  function generated(def) {
    return function (ctx, o) {
      var pinned = def.targets && o.pinned && o.pinned.length;
      var shares = def.shares, targets = [];
      if (pinned) {
        targets = o.pinned.map(function (k) { return { key: k, priority: 1, stage: 'weak' }; });
        shares = PINNED_SHARES;
      } else if (def.targets) {
        targets = ctx.trainingTargets().slice(0, MAX_TARGETS);
      }
      var frontier = def.familiar ? Math.max(def.familiar * ctx.frontier, FAMILIAR_FLOOR) : ctx.frontier;
      var gen = FT.generator.create({ corpus: ctx.corpus, seed: ctx.nextSeed(), shares: shares });
      var request = { frontier: frontier, targets: targets };
      return { type: o.type, words: gen.next(FIRST_BATCH, request), more: function (n) { return gen.next(n, request); }, targets: targets,
        noTargets: !!def.reportsMissingTargets && !pinned && !targets.length };
    };
  }
  // The benchmark's words: drawn uniformly from the BENCHMARK_RANKS most
  // common, never the same word twice in a row. Returns take(n) -> words.
  function benchmarkSampler(corpus, rng) {
    var last = null;
    return function take(n) {
      var out = [];
      while (out.length < n) {
        var w = corpus.words[Math.floor(rng() * Math.min(BENCHMARK_RANKS, corpus.size))];
        if (w === last && corpus.size > 1) continue;
        out.push(w); last = w;
      }
      return out;
    };
  }
  function benchmark(ctx) {
    var sample = benchmarkSampler(ctx.corpus, FT.rng(ctx.nextSeed()));
    function take(n) { return sample(n).map(function (w) { return { word: w, source: 'benchmark' }; }); }
    return { type: 'benchmark', words: take(FIRST_BATCH), more: take, targets: [] };
  }
  // The next words of the current text, from its saved position.
  function prose(ctx, o) {
    var text = o.text, at = text.pos || 0, ends = {};
    (text.breaks || []).forEach(function (i) { ends[i] = true; });
    function take(n) {
      var out = text.words.slice(at, at + n).map(function (w, k) {
        var item = { word: w, source: 'prose' };
        if (ends[at + k]) item.sep = FT.session.PARAGRAPH;
        return item;
      });
      at += out.length;
      return out;
    }
    return { type: 'prose', words: take(o.batch || FIRST_BATCH), more: take, targets: [], text: { id: text.id, from: text.pos || 0 } };
  }

  // feeds: the learners an exercise's typing updates.
  //   sequences      the sequence model (and the session clock);
  //   substitutions  the substitution matrix;
  //   difficulty     the vocabulary frontier (relaxed practice only: product decision);
  //   burstTarget    the speed-burst pace target.
  // familiar: the frontier scale for familiar words (look-ahead stays below
  // the current frontier).
  var TYPES = {
    warmup: {
      name: 'Warm-up',
      build: generated({ familiar: 0.5, shares: FAMILIAR_SHARES }),
      feeds: { sequences: true, substitutions: true },
      card: function () {
        return ['Familiar words at an easy, comfortable pace, to settle your hands. Do not push.',
          'It helps find the sequences to practise; only relaxed practice changes your vocabulary.'];
      },
    },
    relaxed: {
      name: 'Relaxed practice',
      build: generated({ targets: true }),
      feeds: { sequences: true, substitutions: true, difficulty: true },
      card: function () {
        return ['Your normal, comfortable pace. Look ahead, keep an even rhythm, and do not push for speed.',
          'This exercise sets your vocabulary: it grows while your accuracy (first try) on its less common words stays close to your accuracy on the ' +
            FT.difficulty.EASIEST_RANKS + ' most common, and typing feels comfortable. It never goes below the ' + FT.difficulty.TUNING.min + ' most common words.'];
      },
    },
    bursts: {
      name: 'Speed bursts',
      build: generated({ familiar: 0.6, shares: FAMILIAR_SHARES }),
      feeds: { substitutions: true, burstTarget: true },
      card: function () {
        return ['Sprint about ' + percent(FT.bursts.START_ABOVE - 1) + ' above your comfortable pace for ' + BURST_ROUND_MS / 1000 + ' seconds, then rest for ' + BURST_REST_MS / 1000 + '. Start each round when you are ready.',
          'A round counts when you reach the target (the mark on the bar) with at least ' + percent(FT.bursts.MIN_ACC) + ' accuracy; the target rises after a round that counts and eases after one that does not. Bursts never change your vocabulary or sequence statistics.'];
      },
    },
    prose: {
      name: 'Prose',
      build: prose,
      feeds: { sequences: true, substitutions: true },
      card: function (settings) {
        var accents = !settings || settings.accents !== false;
        return ['Read and type a real text at your normal pace. Capitals and punctuation count; plain quotes' + (accents ? ', dashes and unaccented letters are' : ' and dashes are') + ' accepted.',
          'Your place in the text is saved, so the next prose exercise continues from it.'];
      },
    },
    benchmark: {
      name: 'Benchmark',
      build: benchmark,
      feeds: {},
      card: function () {
        return ['A steady, comfortable pace, as in relaxed practice. ' + BENCHMARK_TRIALS + ' trials of ' + (BENCHMARK_MINUTES === 1 ? 'one minute' : BENCHMARK_MINUTES + ' minutes') + '.',
          'Measurement only: the same kind of text every time, compared week to week. It never changes your training.'];
      },
    },
    targeted: {
      name: 'Targeted practice',
      build: generated({ targets: true, shares: TARGETED_SHARES, reportsMissingTargets: true }),
      feeds: { sequences: true, substitutions: true },
      card: function () {
        return ['Words that carry the sequences in your focus list. Your normal, relaxed pace; keep the rhythm even.',
          'It gives the sequences you are training many varied repetitions.'];
      },
    },
  };

  function name(type) { return TYPES[type] ? TYPES[type].name : type; }
  // What the instruction card says. goal: how to type it; counts: what it does with what you type.
  function instructions(type, settings) {
    var card = TYPES[type].card(settings);
    return { name: TYPES[type].name, goal: card[0], counts: card[1] };
  }
  function feeds(type, learner) { return !!(TYPES[type] && TYPES[type].feeds[learner]); }
  function build(ctx, o) { return TYPES[o.type].build(ctx, o); }

  FT.exercises = { name: name, instructions: instructions, feeds: feeds, build: build, benchmarkSampler: benchmarkSampler, TYPE_NAMES: Object.keys(TYPES),
    BURST_ROUND_MS: BURST_ROUND_MS, BURST_REST_MS: BURST_REST_MS, BENCHMARK_TRIALS: BENCHMARK_TRIALS, BENCHMARK_MINUTES: BENCHMARK_MINUTES };
})(globalThis.FT);
