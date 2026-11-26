// Settings in tabs: typing, daily training (the programme editor), keyboard
// (multi-letter keys and the layout) and appearance. Each field is a row of
// one table: where it is shown, its label, its control and how a change applies.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, exerciseName = FT.exercises.name;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, H = FT.html;
  var TABS = ['typing', 'training', 'keyboard', 'appearance'];
  var TEXT_SIZES = [20, 22, 24, 26, 28, 32, 36]; // px
  var THEMES = [['system', 'Follow the system'], ['light', 'Canvas (light)'], ['dark', 'Ink (dark)']];
  var LAYOUT_EXAMPLE = 'q w e r t   y u i o p&#10;a s d f g   h j k l ;&#10;z x c v b   n m , . /&#10;space&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;5';

  function selectField(id, options, chosen) { return '<div>' + H.select({ id: id }, options, chosen) + '</div>'; }
  function checkbox(id, checked, text) { return '<label class="row"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + text + '</label>'; }
  function nearestTextSize(fontSize) {
    var px = Math.round((fontSize || 1.6) * 16);
    return TEXT_SIZES.reduce(function (a, b) { return Math.abs(b - px) < Math.abs(a - px) ? b : a; });
  }

  // tab; label, for the control `input`; control(settings, vocabulary state): its markup.
  var FIELDS = [
    { tab: 'typing', label: 'Exercise length', input: 'durationMin',
      control: function (s) { return selectField('durationMin', FT.settings.DURATIONS.map(function (m) { return [m, m + ' min']; }), s.durationMin); } },
    { tab: 'typing', label: 'After a wrong key', input: 'errorMode',
      control: function (s) { return selectField('errorMode', [['continue', 'Keep going (fix with backspace if you like)'], ['stop', 'Stop until it is corrected']], s.errorMode); } },
    { tab: 'typing', label: 'Error highlighting', input: 'errorStyle',
      control: function (s) { return selectField('errorStyle', [['clear', 'Clear'], ['subtle', 'Subtle (colour only)']], s.errorStyle); } },
    { tab: 'typing', label: 'Remaining time', input: 'showTimer',
      control: function (s) { return selectField('showTimer', [['1', 'Show'], ['0', 'Hide']], s.showTimer ? '1' : '0'); } },
    { tab: 'typing', label: 'Vocabulary', input: 'vocabMode',
      control: function (s, d) {
        return '<div class="row">' + H.select({ id: 'vocabMode' }, [['auto', 'Adapt automatically'], ['manual', 'Fixed']], d.manual ? 'manual' : 'auto') +
          '<input type="number" id="frontier" min="100" max="' + app.trainer.corpus.size + '" step="50" value="' + Math.round(d.frontier) + '" style="max-width:8rem" aria-label="Number of common words"' + (d.manual ? '' : ' disabled') + '> <span class="muted">most common words</span></div>';
      } },
    { tab: 'typing', label: 'Instructions', input: 'showInstructions',
      control: function (s) { return '<div>' + checkbox('showInstructions', s.showInstructions !== false, 'Show the instructions before each exercise (Enter starts)') + '</div>'; } },
    { tab: 'typing', label: 'Prose characters', input: 'accents',
      control: function (s) {
        return '<div>' + checkbox('accents', s.accents !== false, 'Accept letters without accents (e for é)') +
          '<p class="help">Curly quotes and long dashes always accept their plain keyboard versions.</p></div>';
      } },
    { tab: 'training', label: 'Exercises', control: function () { return '<div class="stack" id="progedit"></div>'; } },
    { tab: 'keyboard', label: 'Multi-letter keys', input: 'macros',
      control: function (s) {
        return '<div><input type="text" id="macros" value="' + esc((s.macros || []).join(' ')) + '" placeholder="th qu">' +
          '<p class="help">Keys that type several letters at once, separated by spaces. They count fully towards speed and are timed as one movement. Keys in your layout below are included automatically.</p>' +
          '<p class="help" id="layoutMacros"></p>' +
          checkbox('autoMacros', s.autoMacros, 'Suggest pairs that always arrive almost simultaneously') + '<div id="cands" class="help"></div></div>';
      } },
    { tab: 'keyboard', label: 'Keyboard layout (optional)', input: 'layoutText',
      control: function (s) {
        return '<div><textarea id="layoutText" class="mono" placeholder="' + LAYOUT_EXAMPLE + '">' + esc(s.layoutText || '') + '</textarea>' +
          '<p class="help">Rows of keys, then the same rows again as finger numbers (0 = left pinky … 3 = left index, 4 = left thumb, 5 = right thumb, 6 = right index … 9 = right pinky). ' +
          'Write a key that types several letters as one token (<span class="seq">th</span>, <span class="seq">qu</span>) and the space bar as <span class="seq">space</span>. ' +
          'The layout is only used to describe sequences (same finger, rolls, scissors); training never depends on it. Multi-letter keys are added to the multi-letter keys above.</p><p class="help" id="layoutStatus"></p></div>';
      } },
    { tab: 'appearance', label: 'Theme', input: 'theme', control: function (s) { return selectField('theme', THEMES, s.theme); } },
    { tab: 'appearance', label: 'Text size', input: 'fontSize',
      control: function (s) { return selectField('fontSize', TEXT_SIZES.map(function (px) { return [px, px + ' px']; }), nearestTextSize(s.fontSize)); } },
  ];

  // How a change to each control applies to the settings, which are then
  // saved; a change that returns false saved something else itself.
  function changeVocabulary() {
    var manual = document.getElementById('vocabMode').value === 'manual';
    document.getElementById('frontier').disabled = !manual;
    app.trainer.difficulty.override(manual ? +document.getElementById('frontier').value : null);
    U.saveProfile();
    return false;
  }
  var CHANGES = {
    durationMin: function (s, el) { s.durationMin = +el.value; },
    errorMode: function (s, el) { s.errorMode = el.value; },
    errorStyle: function (s, el) { s.errorStyle = el.value; },
    showTimer: function (s, el) { s.showTimer = el.value === '1'; },
    vocabMode: changeVocabulary,
    frontier: changeVocabulary,
    showInstructions: function (s, el) { s.showInstructions = el.checked; },
    accents: function (s, el) { s.accents = el.checked; },
    macros: function (s, el) { s.macros = el.value.split(/[\s,]+/).filter(function (x) { return Array.from(x).length > 1; }); },
    autoMacros: function (s, el) { s.autoMacros = el.checked; candidates(); },
    layoutText: function (s, el) { s.layoutText = el.value; U.applySettings(); layoutStatus(); },
    theme: function (s, el) { s.theme = el.value; },
    fontSize: function (s, el) { s.fontSize = (+el.value || 26) / 16; },
  };

  function viewSettings(tab) {
    U.screen('settings/' + tab, { render: function () {
      var s = app.settings, d = app.trainer.difficulty.state();
      U.paint('<section class="stack">' + U.sectionHead('settings') + '</section><form class="form" id="sform">' +
        FIELDS.filter(function (f) { return f.tab === tab; }).map(function (f) {
          return '<label' + (f.input ? ' for="' + f.input + '"' : '') + '>' + f.label + '</label>' + f.control(s, d);
        }).join('') + '</form>');
      layoutStatus();
      renderProgEdit();
      var form = document.getElementById('sform');
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      form.addEventListener('change', function (e) {
        if (e.target.dataset.step != null) { changeStep(e.target); return; }
        var change = CHANGES[e.target.id];
        if (change && change(s, e.target) === false) return;
        U.saveSettings();
      });
      candidates();
    } });
  }

  // ---------- keyboard ----------
  function layoutStatus() {
    var el = document.getElementById('layoutStatus'), fromLayout = document.getElementById('layoutMacros'), text = app.settings.layoutText;
    if (!el || !fromLayout) return;
    fromLayout.textContent = app.layout && app.layout.macros.length ? 'From your layout: ' + app.layout.macros.join(' ') : '';
    if (!text.trim()) { el.textContent = ''; return; }
    try { var L = FT.layout.parse(text); el.textContent = 'Layout read: ' + Object.keys(L.keys).length + ' keys' + (L.macros.length ? ', multi-letter: ' + L.macros.join(' ') : '') + '.'; }
    catch (e) { el.textContent = e.message; }
  }
  function candidates() {
    var el = document.getElementById('cands');
    if (!el) return;
    if (!app.settings.autoMacros) { el.textContent = ''; return; }
    app.store.listSessions().then(function (list) {
      var res = list.slice(-10).map(function (r) { return FT.timing.extract(r.words, FT.align.analyzeWords(r.words, U.analysisOptions())); });
      var c = FT.timing.macroCandidates(res).filter(function (x) { return U.macros().indexOf(x.seq) < 0; });
      el.innerHTML = c.length ? 'Possible multi-letter keys (not applied until you add them above): ' +
        c.map(function (x) { return seq(x.seq) + ' ' + pct(x.confidence, 0) + ' of ' + x.n; }).join(', ')
        : 'No candidates in your recent exercises.';
    });
  }

  // ---------- daily training ----------
  function editedProgramme(edit) {
    var def = JSON.parse(JSON.stringify(U.programmeDef()));
    edit(def);
    app.settings.programme = def;
    U.saveSettings();
    renderProgEdit();
  }
  function changeStep(input) {
    editedProgramme(function (def) {
      var st = def.steps[+input.dataset.step];
      if (input.type === 'checkbox') st.enabled = input.checked; else st.minutes = Math.max(0.5, Math.min(30, +input.value || st.minutes));
    });
  }
  function moveStep(i, d) {
    editedProgramme(function (def) { def.steps.splice(i + d, 0, def.steps.splice(i, 1)[0]); });
    // keep focus on the moved step's button in the same direction (or the other one at an end)
    var j = i + d, same = document.getElementById((d > 0 ? 'down-' : 'up-') + j), other = document.getElementById((d > 0 ? 'up-' : 'down-') + j);
    (same && !same.disabled ? same : other).focus();
  }
  function renderProgEdit() {
    var el = document.getElementById('progedit'), def = U.programmeDef();
    if (!el) return;
    el.innerHTML = def.steps.map(function (st, i) {
      var name = esc(exerciseName(st.type));
      return '<div class="row progstep"><input type="checkbox" data-step="' + i + '" aria-label="Include ' + name + '"' + (st.enabled ? ' checked' : '') + '>' +
        '<span style="min-width:9rem">' + name + '</span>' +
        '<input type="number" data-step="' + i + '" min="0.5" max="30" step="0.5" value="' + esc(String(st.minutes)) + '" style="max-width:5rem" aria-label="Minutes"> <span class="muted">min</span>' +
        '<button class="btn" type="button" id="up-' + i + '" data-up="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move ' + name + ' up">↑</button>' +
        '<button class="btn" type="button" id="down-' + i + '" data-down="' + i + '"' + (i < def.steps.length - 1 ? '' : ' disabled') + ' aria-label="Move ' + name + ' down">↓</button></div>';
    }).join('') + '<p class="help">' + FT.programme.totalMinutes(def) + ' minutes in total. <button class="btn" type="button" id="progreset">Restore default</button></p>';
    el.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { moveStep(+b.dataset.up, -1); }; });
    el.querySelectorAll('[data-down]').forEach(function (b) { b.onclick = function () { moveStep(+b.dataset.down, 1); }; });
    document.getElementById('progreset').onclick = function () { app.settings.programme = null; U.saveSettings(); renderProgEdit(); };
  }

  TABS.forEach(function (tab) { U.route('settings/' + tab, function () { viewSettings(tab); }); });
})(globalThis.FT);
