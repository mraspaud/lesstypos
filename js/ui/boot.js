// Starts the app once every ui file has registered on FT.ui: the page's
// listeners, the store, the trainer, then the first screen.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;

  function listen() {
    document.addEventListener('keydown', U.onGlobalKey);
    var skip = document.querySelector('a.skip');
    if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); app.$view.focus(); });
    app.$nav.addEventListener('click', function (e) { var b = e.target.closest('[data-go]'); if (b) U.go(b.dataset.go); });
    window.addEventListener('hashchange', U.followAddress);
  }
  function openStore() {
    var adapter;
    return Promise.resolve().then(function () {
      adapter = FT.store.idbAdapter('lesstypos');
      return adapter.keys();
    }).catch(function () { adapter = FT.store.memoryAdapter(); app.storageOk = false; })
      .then(function () {
        app.store = FT.store.create({ adapter: adapter });
        // sessions stored before compaction are re-saved compactly (once)
        return app.store.compactSessions().catch(function () {})
          .then(function () { return app.store.repairReadingPlaces().catch(function () {}); }).then(app.store.load);
      });
  }
  function loadTrainer(stored) {
    app.settings = FT.settings.clean(stored.settings);
    U.applySettings();
    var rebuild = !stored.profile || FT.trainer.needsRebuild(stored.profile);
    return (rebuild ? U.listRaw() : Promise.resolve(null)).then(function (raw) {
      app.trainer = U.makeTrainer(rebuild ? null : stored.profile, raw, stored.profile);
      if (raw && raw.sessions.length) return U.saveProfile();
    });
  }
  // An exercise that was waiting for its effort rating when the page closed;
  // one already saved (its draft was not cleared) is not asked again.
  function resumeDraft(draft) {
    return app.store.getSession(draft.raw.id).then(function (saved) {
      if (saved) { U.showAddressed(); return app.store.clearDraft(); }
      return (draft.ui.textId ? app.store.getText(draft.ui.textId) : Promise.resolve(null)).then(function (text) {
        if (draft.ui.programme) app.run = FT.programme.resume(app.settings.programmeRun, U.today()) || null;
        U.viewEffort(U.infoFromDraft(draft, text));
      });
    });
  }

  function boot() {
    app.$view = document.getElementById('view');
    app.$nav = document.getElementById('nav');
    app.$footer = document.getElementById('footer');
    listen();
    var ready = openStore().then(loadTrainer).then(function () {
      if (!app.storageOk) app.notice = 'This browser does not allow storage for this page, so progress will be lost when you close it. Use Settings: Data → Export to keep it.';
      return U.readingChoice().then(function (r) { app.reading = r; }, function () {});
    }).then(function () {
      return app.store.getDraft().catch(function () { return null; });
    }).then(function (draft) {
      if (draft) return resumeDraft(draft);
      U.showAddressed();
    }).catch(function (e) {
      app.$view.innerHTML = '<p class="notice">LessTypos could not start: ' + FT.fmt.esc(e && e.message || e) + '</p>';
    });
    FT.ready = ready;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis.FT);
