// Settings: Data. Backup (download or copy), import (replace or merge),
// rebuilding the statistics and resetting.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, H = FT.html;

  function button(label, onClick, kind, id) { return U.keyButton({ label: label, onClick: onClick, kind: kind, id: id }); }
  // Each reset button asks once more before acting.
  function resetButton(what, label) {
    return button(label, function (b) {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to confirm'; return; }
      app.store.reset(what).then(function () {
        if (what === 'settings' || what === 'all') { app.settings = FT.settings.clean({}); U.applySettings(); }
        return U.reloadFromStore(false);
      }).then(U.onThisScreen(function () { viewData(); message('resetmsg', 'Done.'); }));
    }, 'danger');
  }
  function message(id, text) { document.getElementById(id).textContent = text; }

  function backup() { return app.store.exportAll().then(function (d) { return JSON.stringify(d); }); }
  function download() {
    backup().then(function (json) {
      var a = document.createElement('a'), url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.href = url;
      a.download = 'lesstypos-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      message('expmsg', 'Backup prepared (' + (json.length / 1024).toFixed(0) + ' KB). If no download started, use “Copy backup to clipboard”.');
    });
  }
  function copy() {
    backup().then(function (json) {
      return navigator.clipboard.writeText(json).then(function () { message('expmsg', 'Backup copied to the clipboard.'); }, function () {
        var ta = document.getElementById('paste'); ta.value = json; ta.select();
        message('expmsg', 'Copying was refused; the backup is selected in the box below, copy it from there.');
      });
    });
  }
  function importBackup(text) {
    var mode = document.getElementById('impmode').value, data;
    try { data = JSON.parse(text); } catch (e) { message('impmsg', 'That is not valid JSON.'); return; }
    app.store.importAll(data, { mode: mode }).then(function () { return U.reloadFromStore(mode === 'merge'); })
      .then(function () { message('impmsg', 'Imported. Statistics are up to date.'); })
      .catch(function (e) { message('impmsg', e.message); });
  }
  function rebuild() {
    U.reloadFromStore(true).then(U.onThisScreen(function () { message('resetmsg', 'Statistics rebuilt from ' + app.trainer.history().length + ' exercises.'); }));
  }
  // Storage used, filled in once the browser and the store have answered.
  function showUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        var el = document.getElementById('usage');
        if (el && e.usage != null) el.textContent = 'Using ' + (e.usage / 1048576).toFixed(1) + ' MB of storage. ' + el.textContent;
      }).catch(function () {});
    }
    app.store.sizes().then(function (z) {
      var el = document.getElementById('usage');
      if (el) el.textContent = (el.textContent ? el.textContent + ' ' : '') + FT.fmt.storageLine(z);
    }).catch(function () {});
  }

  function viewData() {
    U.screen('settings/data', { render: function () {
      U.paint('<section class="stack">' + U.sectionHead('settings') +
        '<p class="muted">Everything stays in this browser' + (app.storageOk ? ' (IndexedDB)' : '') + '. Nothing is sent anywhere. Raw keystroke records are kept so statistics can be rebuilt when the method improves.</p>' +
        (app.storageOk ? '' : '<p class="notice">This browser does not allow storage for this page, so progress is lost when you close it. Export before leaving.</p>') +
        '<p class="muted num" id="usage"></p></section>' +
        H.panel('Export', '<p>Save a complete backup: settings, statistics and every raw exercise.</p>' +
          '<div class="row">' + button('Download backup', download, 'primary', 'exp') + button('Copy backup to clipboard', copy, null, 'copy') + '</div>' +
          '<p class="muted" id="expmsg"></p>') +
        H.panel('Import', '<p>Restore a backup. Replacing removes the current data first. Merging adds the exercises and texts from the backup (any with the same identity are replaced), keeps your settings and the furthest reading position, then rebuilds the statistics.</p>' +
          '<div class="row"><input type="file" id="file" accept="application/json,.json">' + H.select({ id: 'impmode' }, [['replace', 'Replace current data'], ['merge', 'Merge with current data']]) + '</div>' +
          '<textarea id="paste" class="mono" placeholder="…or paste a backup here"></textarea><div class="row">' +
          button('Import pasted backup', function () { importBackup(document.getElementById('paste').value); }, null, 'imp') + '</div><p class="muted" id="impmsg"></p>') +
        H.panel('Rebuild and reset', '<div class="row">' + button('Rebuild statistics from raw exercises', rebuild, null, 'rebuild') + '</div>' +
          '<div class="row">' + resetButton('profile', 'Reset statistics only') + resetButton('settings', 'Reset settings') + resetButton('all', 'Delete everything') + '</div>' +
          '<p class="muted">Resetting statistics keeps raw exercises, so they can be rebuilt. Each button asks once more before acting.</p><p id="resetmsg"></p>'));
      showUsage();
      document.getElementById('file').onchange = function (e) {
        var f = e.target.files[0]; if (!f) return;
        var r = new FileReader(); r.onload = function () { importBackup(String(r.result)); }; r.readAsText(f);
      };
    } });
  }

  U.route('settings/data', viewData);
})(globalThis.FT);
