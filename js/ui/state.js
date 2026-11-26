// Shared UI state and constants. The views live in js/ui/*.js and register
// their functions on FT.ui.
(function (FT) {
  'use strict';
  var BURST_RUN = 15000, BURST_REST = 10000, BENCH_TRIALS = 3;
  var percent = function (x) { return Math.round(x * 1000) / 10 + '%'; };
  var EXERCISE_NAMES = { warmup: 'Warm-up', relaxed: 'Relaxed practice', bursts: 'Speed bursts', prose: 'Prose', benchmark: 'Benchmark', targeted: 'Targeted practice' };
  // What the instruction card says. goal: how to type it; counts: what it does with what you type.
  function exerciseText(type, settings) {
    var accents = !settings || settings.accents !== false;
    var texts = {
      warmup: ['Familiar words at an easy, comfortable pace, to settle your hands. Do not push.',
        'It helps find the sequences to practise; only relaxed practice changes your vocabulary.'],
      relaxed: ['Your normal, comfortable pace. Look ahead, keep an even rhythm, and do not push for speed.',
        'This exercise sets your vocabulary: it grows while your accuracy (first try) stays above ' + percent(FT.difficulty.TUNING.high) + ' and typing feels comfortable.'],
      bursts: ['Sprint about ' + percent(FT.bursts.START_ABOVE - 1) + ' above your comfortable pace for ' + BURST_RUN / 1000 + ' seconds, then rest for ' + BURST_REST / 1000 + '. Start each round when you are ready.',
        'A round counts when you reach the target (the mark on the bar) with at least ' + percent(FT.bursts.MIN_ACC) + ' accuracy; the target rises after a round that counts and eases after one that does not. Bursts never change your vocabulary or sequence statistics.'],
      prose: ['Read and type a real text at your normal pace. Capitals and punctuation count; plain quotes' + (accents ? ', dashes and unaccented letters are' : ' and dashes are') + ' accepted.',
        'Your place in the text is saved, so the next prose exercise continues from it.'],
      benchmark: ['A steady, comfortable pace, as in relaxed practice. ' + BENCH_TRIALS + ' trials of one minute.',
        'Measurement only: the same kind of text every time, compared week to week. It never changes your training.'],
      targeted: ['Words that carry the sequences in your focus list. Your normal, relaxed pace; keep the rhythm even.',
        'It gives the sequences you are training many varied repetitions.'],
    };
    return { name: EXERCISE_NAMES[type], goal: texts[type][0], counts: texts[type][1] };
  }
  var EXERCISES = {};
  Object.keys(EXERCISE_NAMES).forEach(function (type) { EXERCISES[type] = { name: EXERCISE_NAMES[type] }; });

  var EFFORT = [
    [1, 'No effort', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum effort', 'Pushing as hard as I could'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null };
  app.current = 'home';
  FT.ui = { app: app, EXERCISES: EXERCISES, exerciseText: exerciseText, EFFORT: EFFORT,
    BURST_RUN: BURST_RUN, BURST_REST: BURST_REST, BENCH_TRIALS: BENCH_TRIALS };
})(globalThis.FT);
