// Train (home): one way to train on Enter, a benchmark that is due beside it,
// every other way one step away under More (m), and one quiet line of numbers.
// Each way's key works whether More is open or not.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, exerciseName = FT.exercises.name, H = FT.html;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix;

  // What Enter does (FT.programme.homeLayout's primary), and the line under it.
  function primaryAction(id, run, def, steps, reading) {
    if (id === 'choose') return { label: 'Choose exercises', lead: 'No exercises are switched on for the daily training.', act: function () { U.go('settings/training'); } };
    if (id === 'read') return { label: esc(reading.label), lead: esc(reading.detail || ''), act: reading.act };
    var plan = FT.programme.totalMinutes(def) + ' min: ' + steps.map(function (x) { return esc(exerciseName(x.type).toLowerCase()) + ' ' + esc(String(x.minutes)); }).join(', ');
    if (id === 'resume') {
      var done = run.results().length, total = done + run.upcoming().length;
      return { label: 'Resume: ' + esc(exerciseName(run.current().type).toLowerCase()) + ' (' + (done + 1) + ' of ' + total + ')', lead: plan, act: function () { return U.startProgramme(run); } };
    }
    return { label: 'Start daily training', lead: plan, act: function () { return U.startProgramme(null); } };
  }
  // Every other way to train, by its id in FT.programme.homeLayout: label
  // and detail (markup), its key if it has one, and what it starts.
  function otherWays(def, reading, first, h) {
    var trainAgain = function () { return U.startProgramme(null); }, total = FT.programme.totalMinutes(def) + ' min';
    var chapterStart = reading && reading.chapterStart;
    return {
      read: reading && { label: esc(reading.label), detail: esc(reading.detail || ''), key: 'c', act: reading.act },
      chapterstart: chapterStart && { label: esc(chapterStart.label), detail: esc(chapterStart.detail), act: chapterStart.act },
      again: { label: 'Daily training again', detail: total, key: 'a', act: trainAgain },
      start: { label: 'Relaxed practice only', detail: esc(String(app.settings.durationMin)) + ' min', key: 'r', act: function () { U.startExercise('relaxed'); } },
      bench: { label: 'Benchmark', detail: FT.exercises.BENCHMARK_TRIALS + ' × ' + FT.exercises.BENCHMARK_MINUTES + ' min · ' + U.benchmarkDue(h), key: 'b', act: U.startBenchmark },
      one: first && { label: 'Practise ' + seq(first.key), detail: '3 min', key: 'f', act: function () { U.startExercise('targeted', { pinned: [first.key], minutes: 3 }); } },
      restart: { label: 'Start today\'s training over', detail: total, act: trainAgain },
    };
  }
  // One way as a row of a list: its key, its name, a muted detail.
  function wayRow(id, way) {
    return '<li><button type="button" class="way" data-row id="' + id + '"' + U.action(way.act) + '>' +
      '<span class="key">' + (way.key ? U.shortcut({ key: way.key, label: way.label, act: way.act }) : '') + '</span>' +
      '<span>' + way.label + '</span><span class="muted">' + way.detail + '</span></button></li>';
  }
  function wayList(ids, ways) { return ids.length ? '<ul class="ways">' + ids.map(function (id) { return wayRow(id, ways[id]); }).join('') + '</ul>' : ''; }
  function toggleMore() {
    var more = document.getElementById('more');
    more.open = !more.open;
    (more.open ? more.querySelector('[data-row]') : more.querySelector('summary')).focus();
  }

  // Drawn at once from the last known way into the book, redrawn if it changed.
  function viewHome() {
    U.screen('home', { render: function () { U.paint(homePage(app.reading)); } });
    U.readingChoice().then(U.onThisScreen(function (reading) {
      var shown = function (r) { return r ? [r.label, r.detail, r.chapterStart && r.chapterStart.detail].join('|') : ''; };
      var changed = shown(reading) !== shown(app.reading);
      app.reading = reading;
      if (changed) U.redraw();
    }));
  }
  function homePage(reading) {
    var t = app.trainer, d = t.difficulty.state(), h = t.history();
    var targets = t.targets(), first = targets[0], last = lastRelaxed(h);
    var def = U.programmeDef(), run = FT.programme.resume(app.settings.programmeRun, U.today());
    var steps = def.steps.filter(function (x) { return x.enabled; });
    var bench = FT.progress.benchmarkStatus(h, Date.now());
    var layout = FT.programme.homeLayout({ steps: steps.length > 0, trainedToday: FT.history.trainedOn(h, U.today()), resumable: !!run,
      reading: !!reading, chapterStart: !!(reading && reading.chapterStart), target: !!first,
      benchmarkDue: !!bench.last && bench.due });   // design choice: a first benchmark is offered under More, not pressed on a new profile
    var main = primaryAction(layout.primary, run, def, steps, reading), ways = otherWays(def, reading, first, h);
    if (layout.primary === 'read') U.shortcut({ key: 'c', label: main.label, act: main.act });
    var html = '<section class="home-start"><h1 class="sr-only">Train</h1>' +
      '<div class="row">' + U.keyButton({ label: main.label, key: 'Enter', id: 'primary', kind: 'primary', onClick: main.act }) + '</div>' +
      (main.lead ? '<p class="lead">' + main.lead + '</p>' : '') +
      wayList(layout.shown, ways) +
      H.disclosure('More ' + U.shortcut({ key: 'm', label: 'More ways to train', act: toggleMore }), wayList(layout.more, ways), { id: 'more' }) +
      '</section>' +
      '<p class="statusline muted num">' + Math.round(d.frontier).toLocaleString('en-US') + ' common words in use' + (d.manual ? ' (fixed)' : '') +
      ' · <a href="#insights/focus">' + targets.length + ' in the focus list</a>' +
      (last ? ' · last relaxed ' + fix(last.wpm) + ' WPM, ' + pct(last.firstAttemptAccuracy) : '') + '</p>';
    if (!h.length) html += H.disclosure('How this works', howItWorks(), { className: 'panel stack howto' });
    return html;
  }
  function lastRelaxed(h) { return h.filter(function (x) { return x.type === 'relaxed'; }).slice(-1)[0]; }
  function howItWorks() {
    return '<p>LessTypos watches every keystroke and learns which letter sequences, including those across spaces, cost you errors or hesitation. ' +
      'Later exercises weave those sequences into everyday words, while about a fifth of the words stay random so progress can be measured fairly.</p>' +
      '<p>Vocabulary grows while your accuracy (first try) on less common words keeps up with your accuracy on the most common ones, and typing feels comfortable. It never asks for a minimum speed.</p>' +
      '<p class="muted">For the prose exercise, add a text you would like to read in <a href="#settings/texts">Settings: Texts</a>. If your keyboard has keys that type several letters at once (such as <span class="seq">th</span>), declare them in <a href="#settings/keyboard">Settings: Keyboard</a>. Press <kbd>?</kbd> for all shortcuts.</p>';
  }

  U.route('home', viewHome);
})(globalThis.FT);
