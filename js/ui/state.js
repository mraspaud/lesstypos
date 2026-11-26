// Shared UI state and constants. The views live in js/ui/*.js and register
// their functions on FT.ui.
(function (FT) {
  'use strict';
  var EFFORT = [
    [1, 'No effort', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum effort', 'Pushing as hard as I could'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null };
  app.current = 'home';
  FT.ui = { app: app, EFFORT: EFFORT };
})(globalThis.FT);
