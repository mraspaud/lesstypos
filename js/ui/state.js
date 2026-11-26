// Shared UI state: the app object, its settings applied to the page, the
// trainer built from them, and saving. The views live in js/ui/*.js and
// register on FT.ui.
(function (FT) {
  'use strict';
  var EFFORT = [
    [1, 'No effort', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum effort', 'Pushing as hard as I could'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null, current: 'home' };

  function macros() {
    var m = (app.settings.macros || []).slice();
    if (app.layout) app.layout.macros.forEach(function (x) { if (m.indexOf(x) < 0) m.push(x); });
    return m;
  }
  function equivalence() { return FT.text.equivalence({ accents: app.settings.accents }); }
  // How typing is analysed live: the multi-letter keys and the accent setting.
  function analysisOptions() { return { macros: macros(), equivalence: equivalence() }; }
  function applySettings() {
    var s = app.settings;
    document.documentElement.style.setProperty('--type-size', s.fontSize + 'rem');
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', s.theme);
    app.layout = null;
    if (s.layoutText && s.layoutText.trim()) { try { app.layout = FT.layout.parse(s.layoutText); } catch (e) { app.layout = null; } }
    if (app.trainerSettings) app.trainerSettings.macros = macros();
    if (app.trainerSettings) app.trainerSettings.accents = s.accents !== false;
  }
  function programmeDef() { return app.settings.programme || FT.programme.DEFAULT; }
  function today() { return FT.days.number(Date.now()); }
  function saveSettings() {
    applySettings();
    return app.store.saveSettings(app.settings).catch(storageError);
  }
  // Today's daily training (app.run), kept in the settings so it can be resumed.
  function saveRun() { app.settings.programmeRun = app.run ? app.run.toJSON() : null; return saveSettings(); }
  function saveProfile() { return app.store.saveProfile(app.trainer.profile()).catch(storageError); }
  function storageError(e) {
    app.notice = 'Your progress could not be saved (' + (e && e.message || e) + '). Export your data from Settings: Data to keep it.';
    FT.ui.renderNotice();
  }

  // previous: the stored profile, whose user choices (fixed vocabulary)
  // survive a rebuild from raw sessions.
  function makeTrainer(profile, sessions, previous) {
    app.trainerSettings = { macros: macros(), accents: app.settings.accents !== false };
    var opts = { settings: app.trainerSettings, seed: (Date.now() % 1e6) + 1 };
    if (profile) return FT.trainer.create(Object.assign({ profile: profile }, opts));
    if (sessions && sessions.length) return FT.trainer.rebuild(sessions, Object.assign({ previous: previous }, opts));
    return FT.trainer.create(opts);
  }
  // Settings and statistics as stored now (after an import, a reset or a
  // rebuild); rebuild: from the raw exercises even if the stored statistics are current.
  function reloadFromStore(rebuild) {
    return app.store.load().then(function (d) {
      app.settings = FT.settings.clean(d.settings);
      applySettings();
      return app.store.listSessions().then(function (sessions) {
        var stale = !d.profile || FT.trainer.needsRebuild(d.profile); // e.g. a backup from an older version
        app.trainer = makeTrainer(rebuild || stale ? null : d.profile, sessions, d.profile);
        return saveProfile();
      });
    });
  }

  FT.ui = { app: app, EFFORT: EFFORT, macros: macros, equivalence: equivalence, analysisOptions: analysisOptions, applySettings: applySettings,
    programmeDef: programmeDef, today: today, saveSettings: saveSettings, saveRun: saveRun, saveProfile: saveProfile, storageError: storageError,
    makeTrainer: makeTrainer, reloadFromStore: reloadFromStore };
})(globalThis.FT);
