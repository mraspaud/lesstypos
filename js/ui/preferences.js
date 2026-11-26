// Settings page (including layout and programme editor) and data page (backup, import, reset).
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EXERCISES = U.EXERCISES;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix;
  // defined in other ui files
  function applySettings() { return U.applySettings.apply(null, arguments); }
  function complete() { return U.complete.apply(null, arguments); }
  function macros() { return U.macros.apply(null, arguments); }
  function makeTrainer() { return U.makeTrainer.apply(null, arguments); }
  function movement() { return U.movement.apply(null, arguments); }
  function programmeDef() { return U.programmeDef.apply(null, arguments); }
  function saveProfile() { return U.saveProfile.apply(null, arguments); }
  function saveSettings() { return U.saveSettings.apply(null, arguments); }
  function setView() { return U.setView.apply(null, arguments); }

  // ---------- settings ----------
  // Settings come in groups (tabs): typing, daily training, keyboard, appearance.
  var TEXT_SIZES = [20, 22, 24, 26, 28, 32, 36]; // px
  function viewSettings(group) {
    group = group || 'typing';
    var s = app.settings, d = app.trainer.difficulty.state();
    var sizePx = Math.round((s.fontSize || 1.6) * 16);
    var near = TEXT_SIZES.reduce(function (a, b) { return Math.abs(b - sizePx) < Math.abs(a - sizePx) ? b : a; });
    var fields = {
      typing:
        '<label for="durationMin">Exercise length</label><div><select id="durationMin">' +
        FT.settings.DURATIONS.map(function (m) { return '<option value="' + m + '"' + (s.durationMin === m ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select></div>' +
        '<label for="errorMode">After a wrong key</label><div><select id="errorMode">' +
        '<option value="continue"' + (s.errorMode === 'continue' ? ' selected' : '') + '>Keep going (fix with backspace if you like)</option>' +
        '<option value="stop"' + (s.errorMode === 'stop' ? ' selected' : '') + '>Stop until it is corrected</option></select></div>' +
        '<label for="errorStyle">Error highlighting</label><div><select id="errorStyle">' +
        '<option value="clear"' + (s.errorStyle === 'clear' ? ' selected' : '') + '>Clear</option>' +
        '<option value="subtle"' + (s.errorStyle === 'subtle' ? ' selected' : '') + '>Subtle (colour only)</option></select></div>' +
        '<label for="showTimer">Remaining time</label><div><select id="showTimer"><option value="1"' + (s.showTimer ? ' selected' : '') + '>Show</option><option value="0"' + (!s.showTimer ? ' selected' : '') + '>Hide</option></select></div>' +
        '<label for="vocabMode">Vocabulary</label><div class="row"><select id="vocabMode"><option value="auto"' + (!d.manual ? ' selected' : '') + '>Adapt automatically</option><option value="manual"' + (d.manual ? ' selected' : '') + '>Fixed</option></select>' +
        '<input type="number" id="frontier" min="100" max="' + app.trainer.corpus.size + '" step="50" value="' + Math.round(d.frontier) + '" style="max-width:8rem" aria-label="Number of common words"' + (d.manual ? '' : ' disabled') + '> <span class="muted">most common words</span></div>' +
        '<label for="showInstructions">Instructions</label><div><label class="row"><input type="checkbox" id="showInstructions"' + (s.showInstructions !== false ? ' checked' : '') + '> Show the instructions before each exercise (Enter starts)</label></div>' +
        '<label for="accents">Prose characters</label><div><label class="row"><input type="checkbox" id="accents"' + (s.accents !== false ? ' checked' : '') + '> Accept letters without accents (e for é)</label>' +
        '<p class="help">Curly quotes and long dashes always accept their plain keyboard versions.</p></div>',
      training:
        '<label>Exercises</label><div class="stack" id="progedit"></div>',
      keyboard:
        '<label for="macros">Multi-letter keys</label><div><input type="text" id="macros" value="' + esc((s.macros || []).join(' ')) + '" placeholder="th qu">' +
        '<p class="help">Keys that type several letters at once, separated by spaces. They count fully towards speed and are timed as one movement. Keys in your layout below are included automatically.</p>' +
        '<p class="help" id="layoutMacros"></p>' +
        '<label class="row"><input type="checkbox" id="autoMacros"' + (s.autoMacros ? ' checked' : '') + '> Suggest pairs that always arrive almost simultaneously</label><div id="cands" class="help"></div></div>' +
        '<label for="layoutText">Keyboard layout (optional)</label><div><textarea id="layoutText" class="mono" placeholder="q w e r t   y u i o p&#10;a s d f g   h j k l ;&#10;z x c v b   n m , . /&#10;space&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;5">' + esc(s.layoutText || '') + '</textarea>' +
        '<p class="help">Rows of keys, then the same rows again as finger numbers (0 = left pinky … 3 = left index, 4 = left thumb, 5 = right thumb, 6 = right index … 9 = right pinky). ' +
        'Write a key that types several letters as one token (<span class="seq">th</span>, <span class="seq">qu</span>) and the space bar as <span class="seq">space</span>. ' +
        'The layout is only used to describe sequences (same finger, rolls, scissors); training never depends on it. Multi-letter keys are added to the multi-letter keys above.</p><p class="help" id="layoutStatus"></p></div>',
      appearance:
        '<label for="theme">Theme</label><div><select id="theme">' + [['system', 'Follow the system'], ['light', 'Canvas (light)'], ['dark', 'Ink (dark)']].map(function (v) { return '<option value="' + v[0] + '"' + (s.theme === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select></div>' +
        '<label for="fontSize">Text size</label><div><select id="fontSize">' + TEXT_SIZES.map(function (px) { return '<option value="' + px + '"' + (px === near ? ' selected' : '') + '>' + px + ' px</option>'; }).join('') + '</select></div>',
    };
    var html = '<section class="stack">' + U.sectionHead('settings') + '</section><form class="form" id="sform">' + fields[group] + '</form>';
    setView(html);
    function layoutStatus() {
      var el = document.getElementById('layoutStatus'), lm = document.getElementById('layoutMacros');
      if (!el || !lm) return;
      lm.textContent = app.layout && app.layout.macros.length ? 'From your layout: ' + app.layout.macros.join(' ') : '';
      if (!s.layoutText.trim()) { el.textContent = ''; return; }
      try { var L = FT.layout.parse(s.layoutText); el.textContent = 'Layout read: ' + Object.keys(L.keys).length + ' keys' + (L.macros.length ? ', multi-letter: ' + L.macros.join(' ') : '') + '.'; }
      catch (e) { el.textContent = e.message; }
    }
    layoutStatus();
    renderProgEdit();
    var f = document.getElementById('sform');
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    f.addEventListener('change', function (e) {
      var id = e.target.id, v = e.target.value;
      if (id === 'durationMin') s.durationMin = +v;
      else if (id === 'errorMode') s.errorMode = v;
      else if (id === 'errorStyle') s.errorStyle = v;
      else if (id === 'showTimer') s.showTimer = v === '1';
      else if (id === 'macros') s.macros = v.split(/[\s,]+/).filter(function (x) { return Array.from(x).length > 1; });
      else if (id === 'autoMacros') { s.autoMacros = e.target.checked; candidates(); }
      else if (id === 'fontSize') s.fontSize = (+v || 26) / 16;
      else if (id === 'theme') s.theme = v;
      else if (id === 'accents') s.accents = e.target.checked;
      else if (id === 'showInstructions') s.showInstructions = e.target.checked;
      else if (e.target.dataset.step != null) {
        var def = JSON.parse(JSON.stringify(programmeDef())), st = def.steps[+e.target.dataset.step];
        if (e.target.type === 'checkbox') st.enabled = e.target.checked; else st.minutes = Math.max(0.5, Math.min(30, +v || st.minutes));
        s.programme = def; saveSettings(); renderProgEdit();
        return;
      }
      else if (id === 'layoutText') { s.layoutText = v; applySettings(); layoutStatus(); }
      else if (id === 'vocabMode' || id === 'frontier') {
        var manual = document.getElementById('vocabMode').value === 'manual';
        document.getElementById('frontier').disabled = !manual;
        app.trainer.difficulty.override(manual ? +document.getElementById('frontier').value : null);
        saveProfile();
        return;
      }
      saveSettings();
    });
    candidates();
  }
  function renderProgEdit() {
    var el = document.getElementById('progedit'), def = programmeDef();
    if (!el) return;
    el.innerHTML = def.steps.map(function (st, i) {
      return '<div class="row progstep"><input type="checkbox" data-step="' + i + '" aria-label="Include ' + esc(EXERCISES[st.type].name) + '"' + (st.enabled ? ' checked' : '') + '>' +
        '<span style="min-width:9rem">' + esc(EXERCISES[st.type].name) + '</span>' +
        '<input type="number" data-step="' + i + '" min="0.5" max="30" step="0.5" value="' + esc(String(st.minutes)) + '" style="max-width:5rem" aria-label="Minutes"> <span class="muted">min</span>' +
        '<button class="btn" type="button" id="up-' + i + '" data-up="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move ' + esc(EXERCISES[st.type].name) + ' up">↑</button>' +
        '<button class="btn" type="button" id="down-' + i + '" data-down="' + i + '"' + (i < def.steps.length - 1 ? '' : ' disabled') + ' aria-label="Move ' + esc(EXERCISES[st.type].name) + ' down">↓</button></div>';
    }).join('') + '<p class="help">' + FT.programme.totalMinutes(def) + ' minutes in total. <button class="btn" type="button" id="progreset">Restore default</button></p>';
    function move(i, d) {
      var def2 = JSON.parse(JSON.stringify(programmeDef())), x = def2.steps.splice(i, 1)[0];
      def2.steps.splice(i + d, 0, x); app.settings.programme = def2; saveSettings(); renderProgEdit();
      // keep focus on the moved step's button in the same direction (or the other one at an end)
      var j = i + d, same = document.getElementById((d > 0 ? 'down-' : 'up-') + j), other = document.getElementById((d > 0 ? 'up-' : 'down-') + j);
      (same && !same.disabled ? same : other).focus();
    }
    el.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { move(+b.dataset.up, -1); }; });
    el.querySelectorAll('[data-down]').forEach(function (b) { b.onclick = function () { move(+b.dataset.down, 1); }; });
    document.getElementById('progreset').onclick = function () { app.settings.programme = null; saveSettings(); renderProgEdit(); };
  }
  function candidates() {
    var el = document.getElementById('cands');
    if (!el) return;
    if (!app.settings.autoMacros) { el.textContent = ''; return; }
    app.store.listSessions().then(function (list) {
      var res = list.slice(-10).map(function (r) { return FT.timing.extract(r.words.map(function (w) { return { target: w.target, stream: w.stream, meta: w.meta }; }), { macros: macros() }); });
      var c = FT.timing.macroCandidates(res).filter(function (x) { return macros().indexOf(x.seq) < 0; });
      el.innerHTML = c.length ? 'Possible multi-letter keys (not applied until you add them above): ' +
        c.map(function (x) { return seq(x.seq) + ' ' + pct(x.confidence, 0) + ' of ' + x.n; }).join(', ')
        : 'No candidates in your recent exercises.';
    });
  }

  // ---------- data ----------
  function viewData() {
    var html = '<section class="stack">' + U.sectionHead('settings') +
      '<p class="muted">Everything stays in this browser' + (app.storageOk ? ' (IndexedDB)' : '') + '. Nothing is sent anywhere. Raw keystroke records are kept so statistics can be rebuilt when the method improves.</p>' +
      (app.storageOk ? '' : '<p class="notice">This browser does not allow storage for this page, so progress is lost when you close it. Export before leaving.</p>') +
      '<p class="muted num" id="usage"></p></section>' +
      '<section class="panel stack"><h2>Export</h2><p>Save a complete backup: settings, statistics and every raw exercise.</p>' +
      '<div class="row"><button class="btn primary" type="button" id="exp">Download backup</button><button class="btn" type="button" id="copy">Copy backup to clipboard</button></div>' +
      '<p class="muted" id="expmsg"></p></section>' +
      '<section class="panel stack"><h2>Import</h2><p>Restore a backup. Replacing removes the current data first. Merging adds the exercises and texts from the backup (any with the same identity are replaced), keeps your settings and the furthest reading position, then rebuilds the statistics.</p>' +
      '<div class="row"><input type="file" id="file" accept="application/json,.json"><select id="impmode"><option value="replace">Replace current data</option><option value="merge">Merge with current data</option></select></div>' +
      '<textarea id="paste" class="mono" placeholder="…or paste a backup here"></textarea><div class="row"><button class="btn" type="button" id="imp">Import pasted backup</button></div><p class="muted" id="impmsg"></p></section>' +
      '<section class="panel stack"><h2>Rebuild and reset</h2>' +
      '<div class="row"><button class="btn" type="button" id="rebuild">Rebuild statistics from raw exercises</button></div>' +
      '<div class="row"><button class="btn danger" type="button" data-reset="profile">Reset statistics only</button>' +
      '<button class="btn danger" type="button" data-reset="settings">Reset settings</button>' +
      '<button class="btn danger" type="button" data-reset="all">Delete everything</button></div>' +
      '<p class="muted">Resetting statistics keeps raw exercises, so they can be rebuilt. Each button asks once more before acting.</p><p id="resetmsg"></p></section>';
    setView(html);
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
    function backup() { return app.store.exportAll().then(function (d) { return JSON.stringify(d); }); }
    document.getElementById('exp').onclick = function () {
      backup().then(function (json) {
        var a = document.createElement('a'), url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.href = url;
        a.download = 'lesstypos-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        document.getElementById('expmsg').textContent = 'Backup prepared (' + (json.length / 1024).toFixed(0) + ' KB). If no download started, use “Copy backup to clipboard”.';
      });
    };
    document.getElementById('copy').onclick = function () {
      var msg = document.getElementById('expmsg');
      backup().then(function (json) {
        return navigator.clipboard.writeText(json).then(function () { msg.textContent = 'Backup copied to the clipboard.'; }, function () {
          var ta = document.getElementById('paste'); ta.value = json; ta.select();
          msg.textContent = 'Copying was refused; the backup is selected in the box below, copy it from there.';
        });
      });
    };
    function doImport(text) {
      var msg = document.getElementById('impmsg'), mode = document.getElementById('impmode').value, data;
      try { data = JSON.parse(text); } catch (e) { msg.textContent = 'That is not valid JSON.'; return; }
      app.store.importAll(data, { mode: mode }).then(function () { return reloadFromStore(mode === 'merge'); })
        .then(function () { msg.textContent = 'Imported. Statistics are up to date.'; })
        .catch(function (e) { msg.textContent = e.message; });
    }
    document.getElementById('file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { doImport(String(r.result)); }; r.readAsText(f);
    };
    document.getElementById('imp').onclick = function () { doImport(document.getElementById('paste').value); };
    document.getElementById('rebuild').onclick = function () {
      reloadFromStore(true).then(U.onThisScreen(function () { document.getElementById('resetmsg').textContent = 'Statistics rebuilt from ' + app.trainer.history().length + ' exercises.'; }));
    };
    app.$view.querySelectorAll('[data-reset]').forEach(function (b) {
      b.onclick = function () {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to confirm'; return; }
        var what = b.dataset.reset;
        app.store.reset(what).then(function () {
          if (what === 'settings' || what === 'all') { app.settings = FT.settings.clean({}); applySettings(); }
          return reloadFromStore(false);
        }).then(U.onThisScreen(function () { viewData(); document.getElementById('resetmsg').textContent = 'Done.'; }));
      };
    });
  }
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

  Object.assign(U, { viewSettings: viewSettings, renderProgEdit: renderProgEdit, candidates: candidates, viewData: viewData, reloadFromStore: reloadFromStore });
})(globalThis.FT);
