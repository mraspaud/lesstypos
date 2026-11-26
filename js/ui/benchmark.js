// The benchmark: a weekly yardstick of 3 trials on unbiased common words,
// scored by the median. Measurement only, so no effort rating.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc, pct = FT.fmt.pct, fix = FT.fmt.fix;
  var TRIALS = FT.exercises.BENCHMARK_TRIALS;

  var goHome = U.goHome, HOME_KEYS = U.HOME_KEYS;

  function benchmarkDue(h) {
    var s = FT.progress.benchmarkStatus(h, Date.now());
    if (!s.last) return 'not taken yet';
    var ago = s.days === 0 ? 'today' : s.days === 1 ? 'yesterday' : s.days + ' days ago';
    return s.due ? 'due (last ' + ago + ')' : 'last ' + ago;
  }
  function startBenchmark() {
    app.bench = { set: 'set-' + Date.now().toString(36), trial: 1 };
    startTrial();
  }
  function startTrial() { U.startExercise('benchmark', { minutes: U.testing.benchmarkMinutes || FT.exercises.BENCHMARK_MINUTES, bench: true }); }
  // After each trial: rest, then the next one; after the last, the result.
  function viewBenchStep(summary) {
    var b = app.bench;
    if (b.trial >= TRIALS) { viewBenchResult(b.set); return; }
    U.screen('summary', { keys: HOME_KEYS, render: function () {
      U.paint('<section class="stack"><h1>Trial ' + b.trial + ' of ' + TRIALS + ' done</h1>' +
        '<p>' + fix(summary.metrics.wpm) + ' WPM at ' + pct(summary.metrics.firstAttemptAccuracy) + ' accuracy (first try).</p>' +
        '<p class="muted">Rest your hands for a moment. Keep the same comfortable pace in the next trial.</p>' +
        '<div class="row">' + U.keyButton({ label: 'Next trial', key: 'Enter', id: 'nexttrial', kind: 'primary', onClick: startTrial }) + '</div></section>');
    } });
    b.trial++;
  }
  function doneButton() { return '<div class="row">' + U.keyButton({ label: 'Done', key: 'Enter', id: 'home', kind: 'primary', onClick: goHome }) + '</div>'; }
  function viewBenchResult(set) {
    var h = app.trainer.history(), r = FT.progress.benchmarkResult(h, set);
    var prev = FT.progress.previousSet(h, set);
    app.bench = null;
    U.screen('summary', { keys: HOME_KEYS, render: function () {
      if (!r || r.trials < TRIALS) {
        U.paint('<section class="stack"><h1>Benchmark incomplete</h1><p>Only ' + (r ? r.trials : 0) + ' of ' + TRIALS +
          ' trials ran their full minute, so this set is not used for your progress or the weekly reminder.</p>' + doneButton() + '</section>');
        return;
      }
      U.paint('<section class="stack"><h1>Benchmark result</h1><p class="muted">The median of ' + r.trials + ' trials, so one unusual trial does not move it.</p></section>' +
        FT.html.tiles([[fix(r.wpm), 'WPM (median of ' + r.trials + ' trials)'], [pct(r.firstAttemptAccuracy), 'accuracy (first try)'],
          [fix(r.min) + '–' + fix(r.max), 'range across trials']]) +
        (prev ? '<p class="notice info">' + (r.wpm - prev.wpm >= 0 ? '+' : '') + fix(r.wpm - prev.wpm, 1) + ' WPM compared with your previous benchmark (' +
          fix(prev.wpm) + ' WPM on ' + esc(new Date(prev.startedAt).toLocaleDateString()) + ').</p>' : '') +
        '<p class="muted">Benchmarks never change your vocabulary level, sequence statistics or training. See them over time in Insights: Progress.</p>' +
        doneButton());
    } });
  }

  Object.assign(U, { benchmarkDue: benchmarkDue, startBenchmark: startBenchmark, viewBenchStep: viewBenchStep });
})(globalThis.FT);
