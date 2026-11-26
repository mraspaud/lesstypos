// Shared UI state and constants. The views live in js/ui/*.js and register
// their functions on FT.ui.
(function (FT) {
  'use strict';
  // goal: how to type it; counts: what it does with what you type.
  var EXERCISES = {
    warmup: { name: 'Warm-up', goal: 'Familiar words at an easy, comfortable pace, to settle your hands. Do not push.',
      counts: 'It helps find the sequences to practise; only relaxed practice changes your vocabulary.' },
    relaxed: { name: 'Relaxed practice', goal: 'Your normal, comfortable pace. Look ahead, keep an even rhythm, and do not push for speed.',
      counts: 'This exercise sets your vocabulary: it grows while your accuracy (first try) stays above 99.5% and typing feels comfortable.' },
    bursts: { name: 'Speed bursts', goal: 'Sprint about 10% above your comfortable pace for 15 seconds, then rest for 10. Start each round when you are ready.',
      counts: 'A round counts when you reach the target (the mark on the bar) with at least 95% accuracy; the target rises after a round that counts and eases after one that does not. Bursts never change your vocabulary or sequence statistics.' },
    prose: { name: 'Prose', goal: 'Read and type a real text at your normal pace. Capitals and punctuation count; plain quotes, dashes and unaccented letters are accepted.',
      counts: 'Your place in the text is saved, so the next prose exercise continues from it.' },
    benchmark: { name: 'Benchmark', goal: 'A steady, comfortable pace, as in relaxed practice. Three trials of one minute.',
      counts: 'Measurement only: the same kind of text every time, compared week to week. It never changes your training.' },
    targeted: { name: 'Targeted practice', goal: 'Words that carry the sequences in your focus list. Your normal, relaxed pace; keep the rhythm even.',
      counts: 'It gives the sequences you are training many varied repetitions.' },
  };

  var BURST_RUN = 15000, BURST_REST = 10000;
  var EFFORT = [
    [1, 'No effort', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum effort', 'Pushing as hard as I could'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null };
  app.current = 'home';
  FT.ui = { app: app, EXERCISES: EXERCISES, EFFORT: EFFORT,
    BURST_RUN: BURST_RUN, BURST_REST: BURST_REST };
})(globalThis.FT);
