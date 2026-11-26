// The daily training: its steps in order, the bar between them, a text for
// prose when there is none, and the summary at the end.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, exerciseName = FT.exercises.name;
  var esc = FT.fmt.esc, pct = FT.fmt.pct, fix = FT.fmt.fix, H = FT.html;

  function goHome() { U.go('home'); }
  var HOME_KEYS = [{ key: 'Escape', label: 'Home', act: goHome }];

  function startProgramme(run) {
    app.run = run || FT.programme.runner(U.programmeDef(), { day: U.today() });
    U.saveRun();
    return runStep();
  }
  function runStep() {
    var c = app.run && app.run.current();
    if (!c) { viewProgrammeSummary(); return; }
    if (c.type === 'prose') {
      return U.currentText().then(U.onThisScreen(function (text) {
        if (text && text.pos < text.words.length) U.startExercise('prose', { minutes: c.minutes, programme: true, text: text, run: app.run.id() });
        else viewNeedText();
      }));
    }
    U.startExercise(c.type, { minutes: c.minutes, programme: true, run: app.run.id() });
  }
  function skip() { app.run.skip(); U.saveRun(); viewBetween(); }
  function repeat() { app.run.repeat(); U.saveRun(); return runStep(); }
  function endEarly() { app.run.finishEarly(); U.saveRun(); viewProgrammeSummary(); }

  // ---------- between exercises ----------
  function nextLine() {
    var c = app.run.current();
    if (!c) return '<p>That was the last exercise.</p>';
    return '<p><b>Next: ' + esc(exerciseName(c.type)) + '</b>, ' + esc(String(c.minutes)) + ' min. <span class="muted">' + esc(FT.exercises.instructions(c.type, app.settings).goal) + '</span></p>';
  }
  // Ending today's training asks once (button or x).
  function askEnd() {
    var pend = document.getElementById('pend');
    if (pend.classList.contains('armed')) { endEarly(); return; }
    pend.classList.add('armed');
    pend.innerHTML = 'Press again to end <kbd>x</kbd>';
    U.announce('Press x again to end today\'s training.');
    var note = document.getElementById('endnote');
    if (note) note.hidden = false;
  }
  function programmeBar() {
    var r = app.run, done = r.results().length, total = done + r.upcoming().length;
    return '<section class="panel stack" id="progbar"><h3>Daily training · ' + Math.min(done, total) + ' of ' + total + ' done</h3>' + nextLine() +
      '<div class="row">' + (r.current()
        ? U.keyButton({ label: 'Continue', key: 'Enter', id: 'pnext', kind: 'primary', onClick: runStep }) + U.keyButton({ label: 'Skip next', key: 'n', id: 'pskip', onClick: skip })
        : U.keyButton({ label: 'See today\'s summary', key: 'Enter', id: 'pnext', kind: 'primary', onClick: runStep })) +
      U.keyButton({ label: 'Repeat this one', key: 'r', id: 'prep', onClick: repeat }) +
      U.keyButton({ label: 'End training', key: 'x', id: 'pend', onClick: askEnd }) + '</div>' +
      '<p class="muted" id="endnote" hidden>Press x again to end today\'s training.</p>' +
      '<p class="muted">' + U.shortcut({ key: 'Escape', label: 'Home (today\'s training stays ready to resume)', act: goHome }) +
      ' goes home; today\'s training stays ready to resume.</p></section>';
  }
  function viewBetween() {
    U.screen('summary', { render: function () { U.paint(programmeBar()); } });
  }

  // ---------- prose without a text ----------
  function viewNeedText() {
    U.screen('needtext', { keys: HOME_KEYS, render: function () {
      U.bundledOffer().then(U.onThisScreen(function (offer) {
        var useBundled = function () { return U.addBundled().then(U.onThisScreen(runStep)).catch(U.storageError); };
        U.paint('<section class="stack"><h1>Prose needs a text</h1>' +
          (offer ? '<div class="row">' + U.keyButton({ label: 'Type ' + esc(U.bundledLabel(offer)), id: 'usebundled', kind: 'primary', onClick: useBundled }) + '</div>' +
            '<p class="muted">It comes with the app. Or add a text you would enjoy reading:</p>'
            : '<p>Paste something you would enjoy reading: a chapter, an article, a public-domain book from Project Gutenberg. LessTypos remembers where you stop.</p>') +
          U.textForm() +
          '<div class="row">' + U.keyButton({ label: 'Skip prose today', id: 'skipprose', onClick: skip }) + '</div></section>');
        U.bindTextForm(function () { runStep(); });
        document.getElementById(offer ? 'usebundled' : 'tbody').focus();
      }));
    } });
  }

  // ---------- the end ----------
  function viewProgrammeSummary() {
    var res = app.run ? app.run.results() : [];
    var runId = app.run && app.run.id();
    var mins = res.reduce(function (a, r) { return a + (r.ms || 0); }, 0) / 60000;
    U.screen('summary', { keys: HOME_KEYS, render: function () {
      var html = '<section class="stack"><h1>Daily training finished</h1><p class="muted">' + fix(mins, 1) + ' minutes of typing across ' +
        res.filter(function (r) { return !r.skipped; }).length + ' exercises.</p></section>' +
        H.table(['Exercise', 'Min', 'WPM', 'Accuracy', 'Effort', 'Note'], res.map(function (r) {
          return H.row([H.cell(esc(exerciseName(r.type)))].concat(r.skipped ? ['<td colspan="4" class="muted">skipped</td>', H.cell('')]
            : [H.cell(fix(r.ms / 60000, 1), 'num'), H.cell(fix(r.wpm), 'num'), H.cell(pct(r.faa), 'num'), H.cell(r.effort || '–', 'num'), H.cell(esc(r.note || ''))]));
        })) +
        '<p class="muted">Speeds from different exercises are not comparable: warm-up and bursts use easier words, prose has capitals and punctuation.</p>' +
        U.tagBox(FT.conditions.lastTags(app.trainer.history())) +
        '<div class="row">' + U.keyButton({ label: 'Done', key: 'Enter', id: 'home', kind: 'primary', onClick: goHome }) + '<a href="#insights/progress">See progress</a></div>';
      app.run = null;
      U.saveRun();
      U.paint(html);
      var ids = app.trainer.history().filter(function (h) { return runId && h.run === runId; }).map(function (h) { return h.id; });
      U.bindTagBox(ids, document.getElementById('home'), true);
    } });
  }

  Object.assign(U, { startProgramme: startProgramme, programmeBar: programmeBar, viewBetween: viewBetween });
})(globalThis.FT);
