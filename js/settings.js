// Settings: their defaults, and cleaning of anything read from storage or a
// pasted backup to known keys, types and values.
(function (FT) {
  'use strict';
  var DEFAULTS = {
    durationMin: 5, errorMode: 'continue', errorStyle: 'clear', macros: [], autoMacros: false,
    layoutText: '', fontSize: 1.6, theme: 'system', showTimer: true,
    accents: true, programme: null, programmeRun: null, currentText: null, showInstructions: true,
  };
  var DURATIONS = [1, 2, 3, 5, 7, 10];
  var CHOICES = { errorMode: ['continue', 'stop'], errorStyle: ['clear', 'subtle'], theme: ['system', 'light', 'dark'] };
  var MACRO = /^[^\s<>&"]{2,8}$/;

  function choice(key, v) { return CHOICES[key].indexOf(v) >= 0 ? v : DEFAULTS[key]; }
  function flag(key, v) { return v === undefined || v === null ? DEFAULTS[key] : !!v; }

  function clean(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var duration = Number(s.durationMin), size = Number(s.fontSize);
    return {
      durationMin: DURATIONS.indexOf(duration) >= 0 ? duration : DEFAULTS.durationMin,
      errorMode: choice('errorMode', s.errorMode),
      errorStyle: choice('errorStyle', s.errorStyle),
      macros: Array.isArray(s.macros) ? s.macros.filter(function (m) { return typeof m === 'string' && MACRO.test(m); }) : [],
      autoMacros: flag('autoMacros', s.autoMacros),
      layoutText: typeof s.layoutText === 'string' ? s.layoutText : '',
      fontSize: size >= 1 && size <= 3 ? size : DEFAULTS.fontSize,
      theme: choice('theme', s.theme),
      showTimer: flag('showTimer', s.showTimer),
      accents: flag('accents', s.accents),
      programme: FT.programme.clean(s.programme),
      programmeRun: FT.programme.cleanRun(s.programmeRun),
      currentText: typeof s.currentText === 'string' ? s.currentText : null,
      showInstructions: flag('showInstructions', s.showInstructions),
    };
  }

  FT.settings = { DEFAULTS: DEFAULTS, DURATIONS: DURATIONS, clean: clean };
})(globalThis.FT);
