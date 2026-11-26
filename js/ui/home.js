// Train (home): one primary action (Enter), a few alternatives by key, three numbers.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, exerciseName = FT.exercises.name;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix;

  // The one thing Enter does on Train: resume today's training, start it,
  // continue reading once it is done, or (with nothing switched on) open its settings.
  function primaryAction(steps, run, def, reading) {
    if (!steps.length) return { label: 'Choose exercises', act: function () { U.go('settings/training'); } };
    var choice = FT.programme.homeDefault({ trainedToday: FT.history.trainedOn(app.trainer.history(), U.today()), resumable: !!run });
    if (choice === 'read' && reading) return reading;
    if (run) {
      var done = run.results().length, total = done + run.upcoming().length;
      return { label: 'Resume: ' + exerciseName(run.current().type).toLowerCase() + ' (' + (done + 1) + ' of ' + total + ')', act: function () { return U.startProgramme(run); } };
    }
    return { label: 'Start daily training · ' + FT.programme.totalMinutes(def) + ' min', act: function () { return U.startProgramme(null); } };
  }
  // Drawn at once from the last known way into the book, redrawn if it changed.
  function viewHome() {
    U.screen('home', { render: function () { U.paint(homePage(app.reading)); } });
    U.readingChoice().then(U.onThisScreen(function (reading) {
      var shown = function (r) { return r ? r.label + '|' + (r.chapterStart ? r.chapterStart.label : '') : ''; };
      var changed = shown(reading) !== shown(app.reading);
      app.reading = reading;
      if (changed) U.redraw();
    }));
  }
  function homePage(reading) {
    var t = app.trainer, d = t.difficulty.state(), h = t.history();
    var targets = t.targets(), first = targets[0];
    var relaxed = h.filter(function (x) { return x.type === 'relaxed'; });
    var last = relaxed[relaxed.length - 1];
    var def = U.programmeDef(), run = FT.programme.resume(app.settings.programmeRun, U.today());
    var steps = def.steps.filter(function (x) { return x.enabled; });
    var main = primaryAction(steps, run, def, reading);
    var readingFirst = main === reading;
    var trainAgain = function () { return U.startProgramme(null); };
    var practiseFirst = first && function () { U.startExercise('targeted', { pinned: [first.key], minutes: 3 }); };
    var html = '<section class="home-start">' +
      '<h1>Daily training</h1>' +
      (steps.length ? '<p class="lead">' + steps.map(function (x) { return esc(exerciseName(x.type).toLowerCase()) + ' ' + esc(String(x.minutes)) + ' min'; }).join(' · ') + '.</p>'
        : '<p class="lead">No exercises are switched on for the daily training.</p>') +
      '<div class="row">' + U.keyButton({ label: esc(main.label), key: 'Enter', id: 'primary', kind: 'primary', onClick: main.act }) +
      (run ? U.keyButton({ label: 'Start over', id: 'restart', onClick: trainAgain }) : '') +
      (readingFirst ? U.keyButton({ label: 'Daily training again · ' + FT.programme.totalMinutes(def) + ' min', key: 'a', id: 'again', onClick: trainAgain })
        : reading ? U.keyButton({ label: esc(reading.label), key: 'c', id: 'read', onClick: reading.act }) : '') +
      (reading && reading.chapterStart ? U.keyButton({ label: esc(reading.chapterStart.label), id: 'chapterstart', onClick: reading.chapterStart.act }) : '') + '</div>' +
      '<div class="row more"><span class="muted">More:</span>' +
      U.keyButton({ label: 'Relaxed practice only · ' + esc(String(app.settings.durationMin)) + ' min', key: 'r', id: 'start', onClick: function () { U.startExercise('relaxed'); } }) +
      U.keyButton({ label: 'Benchmark · 3 × 1 min', key: 'b', id: 'bench', onClick: U.startBenchmark }) +
      (first ? U.keyButton({ label: 'Practise ' + seq(first.key) + ' · 3 min', key: 'f', id: 'one', onClick: practiseFirst }) : '') +
      '<span class="muted">' + U.benchmarkDue(h) + '</span></div>' +
      '</section>' +
      '<section class="stack"><div class="status">' +
      '<div><b class="num">' + Math.round(d.frontier).toLocaleString('en-US') + '</b><span>common words in use' + (d.manual ? ' (fixed)' : '') + '</span></div>' +
      '<div><a class="num big" href="#insights/focus">' + targets.length + '</a><span>in the focus list</span></div>' +
      '<div><b class="num">' + (last ? fix(last.wpm) + ' · ' + pct(last.firstAttemptAccuracy) : '–') + '</b><span>last relaxed WPM · accuracy</span></div>' +
      '</div></section>';
    if (readingFirst) U.shortcut({ key: 'c', label: esc(reading.label), act: reading.act });
    if (!h.length) {
      html += '<section class="stack panel"><h2>How this works</h2>' +
        '<p>LessTypos watches every keystroke and learns which letter sequences, including those across spaces, cost you errors or hesitation. ' +
        'Later exercises weave those sequences into everyday words, while about a fifth of the words stay random so progress can be measured fairly.</p>' +
        '<p>Vocabulary grows when your accuracy (first try) stays above 99.5% and typing feels comfortable. It never asks for a minimum speed.</p>' +
        '<p class="muted">For the prose exercise, add a text you would like to read in <a href="#settings/texts">Settings: Texts</a>. If your keyboard has keys that type several letters at once (such as <span class="seq">th</span>), declare them in <a href="#settings/keyboard">Settings: Keyboard</a>. Press <kbd>?</kbd> for all shortcuts.</p></section>';
    }
    return html;
  }

  U.route('home', viewHome);
})(globalThis.FT);
