// The daily training: its steps in order, the bar between them, a text for
// prose when there is none, and the summary at the end.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, exerciseName = FT.exercises.name;
  var esc = FT.fmt.esc, pct = FT.fmt.pct, fix = FT.fmt.fix, H = FT.html;

  var goHome = U.goHome, HOME_KEYS = U.HOME_KEYS;

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
  // Where the training stands, the one way on (Enter) and a quiet legend of
  // the others; the next exercise's goal is on its instruction card.
  function nextLine() {
    var c = app.run.current();
    if (!c) return '<b>That was the last exercise.</b>';
    return '<b>Next: ' + esc(exerciseName(c.type)) + '</b> <span class="muted">· ' + esc(String(c.minutes)) + ' min</span>';
  }
  // Ending today's training asks once (button or x).
  var askEnd = U.onSecondPress('<kbd>x</kbd> Press again to end', function () { endEarly(); }, { id: 'pend', onArm: function () {
    U.announce('Press x again to end today\'s training.');
  } });
  function programmeBar() {
    var r = app.run, done = r.results().length, total = done + r.upcoming().length;
    return '<section class="progbar" id="progbar"><div class="row">' + H.progressDots(done, total) + '<span>' + nextLine() + '</span></div>' +
      '<div class="row">' + U.keyButton({ label: r.current() ? 'Continue' : 'See today\'s summary', key: 'Enter', id: 'pnext', kind: 'primary', onClick: runStep }) +
      '<span class="legend-keys">' +
      (r.current() ? U.legendKey({ label: 'Skip next', key: 'n', id: 'pskip', onClick: skip }) : '') +
      U.legendKey({ label: 'Repeat', key: 'r', id: 'prep', onClick: repeat, help: 'Repeat this one' }) +
      U.legendKey({ label: 'End training', key: 'x', id: 'pend', onClick: askEnd }) +
      U.legendKey({ label: 'Home', key: 'Escape', id: 'phome', onClick: goHome, help: 'Home (today’s training stays ready to resume)', title: 'Today’s training stays ready to resume' }) +
      '</span></div></section>';
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
        U.bindTextForm(U.onThisScreen(function () { return runStep(); }));
        document.getElementById(offer ? 'usebundled' : 'tbody').focus();
      }));
    } });
  }

  // ---------- the end ----------
  function viewProgrammeSummary() {
    var res = app.run ? app.run.results() : [];
    var runId = app.run && app.run.id();
    var mins = res.reduce(function (a, r) { return a + (r.ms || 0); }, 0) / 60000;
    app.run = null;   // today's training is over
    U.saveRun();
    U.screen('summary', { keys: HOME_KEYS, render: function () {
      var done = goHome;   // until the tags box is bound: then it also saves the tags typed in it
      var html = '<section class="stack"><h1>Daily training finished</h1><p class="muted">' + fix(mins, 1) + ' minutes of typing across ' +
        res.filter(function (r) { return !r.skipped; }).length + ' exercises.</p></section>' +
        H.table(['Exercise', 'Min', 'WPM', 'Accuracy', 'Effort', 'Note'], res.map(function (r) {
          return H.row([H.cell(esc(exerciseName(r.type)))].concat(r.skipped ? ['<td colspan="4" class="muted">skipped</td>', H.cell('')]
            : [H.cell(fix(r.ms / 60000, 1), 'num'), H.cell(fix(r.wpm), 'num'), H.cell(pct(r.faa), 'num'), H.cell(r.effort || '–', 'num'), H.cell(esc(r.note || ''))]));
        })) +
        '<p class="muted">Speeds from different exercises are not comparable: warm-up and bursts use easier words, prose has capitals and punctuation.</p>' +
        U.tagBox(FT.conditions.lastTags(app.trainer.history()), { saveButton: false }) +
        '<div class="row">' + U.keyButton({ label: 'Done', key: 'Enter', id: 'home', kind: 'primary', onClick: function () { done(); } }) + '<a href="#insights/progress">See progress</a></div>';
      U.paint(html);
      var ids = app.trainer.history().filter(function (h) { return runId && h.run === runId; }).map(function (h) { return h.id; });
      done = U.bindDoneTagBox(ids, goHome);
    } });
  }

  Object.assign(U, { startProgramme: startProgramme, programmeBar: programmeBar, viewBetween: viewBetween });
})(globalThis.FT);
