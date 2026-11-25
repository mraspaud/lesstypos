// Shared UI state and constants. The views live in js/ui/*.js and register
// their functions on FT.ui.
(function (FT) {
  'use strict';
  var DEFAULT_SETTINGS = {
    durationMin: 5, errorMode: 'continue', errorStyle: 'clear', macros: [], autoMacros: false,
    layoutText: '', fontSize: 1.6, theme: 'system', showTimer: true,
    accents: true, programme: null, programmeRun: null, currentText: null,
  };
  var EXERCISES = {
    warmup: { name: 'Warm-up', goal: 'Familiar words to settle your hands into a comfortable rhythm. No need to push.' },
    relaxed: { name: 'Relaxed practice', goal: 'Type calmly and look ahead. Accuracy and an even rhythm matter more than speed.' },
    bursts: { name: 'Speed bursts', goal: 'Short sprints just above your comfortable pace, with a rest between rounds. Start each round when you are ready.' },
    prose: { name: 'Prose', goal: 'Read and type naturally. Capitals and punctuation count; plain quotes and dashes are accepted.' },
    targeted: { name: 'Targeted practice', goal: 'The sequences you are training appear in many different words. Keep the rhythm relaxed.' },
  };
  var BURST_RUN = 15000, BURST_REST = 10000;
  var EFFORT = [
    [1, 'Effortless', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum', 'Pushing hard'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null };
  app.current = 'home';
  FT.ui = { app: app, EXERCISES: EXERCISES, EFFORT: EFFORT, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    BURST_RUN: BURST_RUN, BURST_REST: BURST_REST };
})(globalThis.FT);
