// Practice flow: home, daily programme, effort rating, exercise summary.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EXERCISES = U.EXERCISES, EFFORT = U.EFFORT;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix, pill = FT.fmt.pill;
  // defined in other ui files
  function bindTextForm() { return U.bindTextForm.apply(null, arguments); }
  function currentText() { return U.currentText.apply(null, arguments); }
  function go() { return U.go.apply(null, arguments); }
  function programmeDef() { return U.programmeDef.apply(null, arguments); }
  function proseProgress() { return U.proseProgress.apply(null, arguments); }
  function renderNav() { return U.renderNav.apply(null, arguments); }
  function saveProfile() { return U.saveProfile.apply(null, arguments); }
  function saveSettings() { return U.saveSettings.apply(null, arguments); }
  function setView() { return U.setView.apply(null, arguments); }
  function startExercise() { return U.startExercise.apply(null, arguments); }
  function storageError() { return U.storageError.apply(null, arguments); }
  function textForm() { return U.textForm.apply(null, arguments); }
  function today() { return U.today.apply(null, arguments); }

  // ---------- home ----------
  // The one thing Enter does on Train: resume today's training, start it, or
  // (with nothing switched on) open its settings.
  function primaryAction(steps, run, def) {
    if (!steps.length) return { label: 'Choose exercises', act: function () { go('settings/training'); } };
    if (run) {
      var done = run.results().length, total = done + run.upcoming().length;
      return { label: 'Resume: ' + EXERCISES[run.current().type].name.toLowerCase() + ' (' + (done + 1) + ' of ' + total + ')', act: function () { startProgramme(run); } };
    }
    return { label: 'Start daily training · ' + FT.programme.totalMinutes(def) + ' min', act: function () { startProgramme(null); } };
  }
  // One primary action (Enter), a few alternatives by key, three numbers.
  function viewHome() {
    var t = app.trainer, d = t.difficulty.state(), h = t.history();
    var targets = t.targets();
    var relaxed = h.filter(function (x) { return x.type === 'relaxed'; });
    var last = relaxed[relaxed.length - 1];
    var def = programmeDef(), run = FT.programme.resume(app.settings.programmeRun, today());
    var steps = def.steps.filter(function (x) { return x.enabled; });
    var first = targets[0];
    var main = primaryAction(steps, run, def);
    var html = '<section class="home-start">' +
      '<h1>Daily training</h1>' +
      (steps.length ? '<p class="lead">' + steps.map(function (x) { return esc(EXERCISES[x.type].name.toLowerCase()) + ' ' + esc(String(x.minutes)) + ' min'; }).join(' · ') + '.</p>'
        : '<p class="lead">No exercises are switched on for the daily training.</p>') +
      '<div class="row"><button class="btn primary" type="button" id="primary">' + esc(main.label) + ' <kbd>Enter</kbd></button>' +
      (run ? '<button class="btn" type="button" id="restart">Start over</button>' : '') + '</div>' +
      '<div class="row more"><span class="muted">More:</span>' +
      '<button class="btn" type="button" id="start">Relaxed practice only · ' + esc(String(app.settings.durationMin)) + ' min <kbd>r</kbd></button>' +
      '<button class="btn" type="button" id="bench">Benchmark · 3 × 1 min <kbd>b</kbd></button>' +
      (first ? '<button class="btn" type="button" id="one">Practise ' + seq(first.key) + ' · 3 min <kbd>f</kbd></button>' : '') +
      '<span class="muted">' + benchmarkDue(h) + '</span></div>' +
      '</section>' +
      '<section class="stack"><div class="status">' +
      '<div><b class="num">' + Math.round(d.frontier).toLocaleString('en-US') + '</b><span>common words in use' + (d.manual ? ' (fixed)' : '') + '</span></div>' +
      '<div><a class="num big" href="#insights/focus">' + targets.length + '</a><span>in the focus list</span></div>' +
      '<div><b class="num">' + (last ? fix(last.wpm) + ' · ' + pct(last.faa) : '–') + '</b><span>last relaxed WPM · accuracy</span></div>' +
      '</div></section>';
    if (!h.length) {
      html += '<section class="stack panel"><h2>How this works</h2>' +
        '<p>LessTypos watches every keystroke and learns which letter sequences, including those across spaces, cost you errors or hesitation. ' +
        'Later exercises weave those sequences into everyday words, while about a fifth of the words stay random so progress can be measured fairly.</p>' +
        '<p>Vocabulary grows when your accuracy (first try) stays above 99.5% and typing feels comfortable. It never asks for a minimum speed.</p>' +
        '<p class="muted">For the prose exercise, add a text you would like to read in <a href="#settings/texts">Settings: Texts</a>. If your keyboard has keys that type several letters at once (such as <span class="seq">th</span>), declare them in <a href="#settings/keyboard">Settings: Keyboard</a>. Press <kbd>?</kbd> for all shortcuts.</p></section>';
    }
    setView(html);
    var relaxedOnly = function () { startExercise('relaxed'); };
    var one = first ? function () { startExercise('targeted', { pinned: [first.key], minutes: 3 }); } : null;
    document.getElementById('start').onclick = relaxedOnly;
    document.getElementById('bench').onclick = startBenchmark;
    document.getElementById('primary').onclick = main.act;
    var restart = document.getElementById('restart');
    if (restart) restart.onclick = function () { startProgramme(null); };
    if (one) document.getElementById('one').onclick = one;
    app.keys = { Enter: main.act, r: relaxedOnly, b: startBenchmark };
    if (one) app.keys.f = one;
  }

  // ---------- benchmark ----------
  // A weekly yardstick: 3 trials on unbiased common words, scored by the median.
  var BENCH_TRIALS = 3;
  function benchmarkDue(h) {
    var s = FT.progress.benchmarkStatus(h, Date.now());
    if (!s.last) return 'not taken yet';
    var ago = s.days === 0 ? 'today' : s.days === 1 ? 'yesterday' : s.days + ' days ago';
    return s.due ? 'due (last ' + ago + ')' : 'last ' + ago;
  }
  function startBenchmark() {
    app.bench = { set: 'set-' + Date.now().toString(36), trial: 1 };
    benchTrial();
  }
  function benchTrial() { startExercise('benchmark', { minutes: app.benchMinutes || 1, bench: true }); }
  function viewBenchStep(s) {
    app.current = 'summary';
    renderNav();
    var b = app.bench;
    if (b.trial < BENCH_TRIALS) {
      setView('<section class="stack"><h1>Trial ' + b.trial + ' of ' + BENCH_TRIALS + ' done</h1>' +
        '<p>' + fix(s.metrics.wpm) + ' WPM at ' + pct(s.metrics.firstAttemptAccuracy) + ' accuracy (first try).</p>' +
        '<p class="muted">Rest your hands for a moment. Keep the same comfortable pace in the next trial.</p>' +
        '<div class="row"><button class="btn primary" type="button" id="nexttrial">Next trial <kbd>Enter</kbd></button></div></section>');
      b.trial++;
      app.keys = { Enter: benchTrial, Escape: function () { go('home'); } };
      document.getElementById('nexttrial').onclick = benchTrial;
      return;
    }
    viewBenchResult(b.set);
  }
  function viewBenchResult(set) {
    var h = app.trainer.history(), r = FT.progress.benchmarkResult(h, set);
    var prev = FT.progress.previousSet(h, set);
    if (!r || r.trials < BENCH_TRIALS) {
      app.bench = null;
      setView('<section class="stack"><h1>Benchmark incomplete</h1><p>Only ' + (r ? r.trials : 0) + ' of ' + BENCH_TRIALS +
        ' trials ran their full minute, so this set is not used for your progress or the weekly reminder.</p>' +
        '<div class="row"><button class="btn primary" type="button" id="home">Done <kbd>Enter</kbd></button></div></section>');
      document.getElementById('home').onclick = function () { go('home'); };
      app.keys = { Enter: function () { go('home'); }, Escape: function () { go('home'); } };
      return;
    }
    var html = '<section class="stack"><h1>Benchmark result</h1><p class="muted">The median of ' + r.trials + ' trials, so one unusual trial does not move it.</p></section>' +
      '<div class="tiles"><div class="tile"><b>' + fix(r.wpm) + '</b><span>WPM (median of ' + r.trials + ' trials)</span></div>' +
      '<div class="tile"><b>' + pct(r.faa) + '</b><span>accuracy (first try)</span></div>' +
      '<div class="tile"><b>' + fix(r.min) + '–' + fix(r.max) + '</b><span>range across trials</span></div></div>';
    if (prev) html += '<p class="notice info">' + (r.wpm - prev.wpm >= 0 ? '+' : '') + fix(r.wpm - prev.wpm, 1) + ' WPM compared with your previous benchmark (' + fix(prev.wpm) + ' WPM on ' + esc(new Date(prev.t).toLocaleDateString()) + ').</p>';
    html += '<p class="muted">Benchmarks never change your vocabulary level, sequence statistics or training. See them over time in Insights: Progress.</p>' +
      '<div class="row"><button class="btn primary" type="button" id="home">Done <kbd>Enter</kbd></button></div>';
    app.bench = null;
    setView(html);
    document.getElementById('home').onclick = function () { go('home'); };
    app.keys = { Enter: function () { go('home'); }, Escape: function () { go('home'); } };
  }

  // ---------- programme ----------
  function saveRun() { app.settings.programmeRun = app.run ? app.run.toJSON() : null; return saveSettings(); }
  function startProgramme(run) {
    app.run = run || FT.programme.runner(programmeDef(), { day: today() });
    saveRun();
    runStep();
  }
  function runStep() {
    var c = app.run && app.run.current();
    if (!c) { viewProgrammeSummary(); return; }
    if (c.type === 'prose') {
      currentText().then(U.onThisScreen(function (text) {
        if (text && text.pos < text.words.length) startExercise('prose', { minutes: c.minutes, programme: true, text: text, run: app.run.id() });
        else viewNeedText(c);
      }));
      return;
    }
    startExercise(c.type, { minutes: c.minutes, programme: true, run: app.run.id() });
  }
  function nextLine() {
    var c = app.run.current();
    if (!c) return '<p>That was the last exercise.</p>';
    return '<p><b>Next: ' + esc(EXERCISES[c.type].name) + '</b>, ' + esc(String(c.minutes)) + ' min. <span class="muted">' + esc(EXERCISES[c.type].goal) + '</span></p>';
  }
  function programmeBar() {
    var r = app.run, done = r.results().length, total = done + r.upcoming().length;
    return '<section class="panel stack" id="progbar"><h3>Daily training · ' + Math.min(done, total) + ' of ' + total + ' done</h3>' + nextLine() +
      '<div class="row">' + (r.current() ? '<button class="btn primary" type="button" id="pnext">Continue <kbd>Enter</kbd></button>' +
        '<button class="btn" type="button" id="pskip">Skip next <kbd>n</kbd></button>' : '<button class="btn primary" type="button" id="pnext">See today\'s summary <kbd>Enter</kbd></button>') +
      '<button class="btn" type="button" id="prep">Repeat this one <kbd>r</kbd></button>' +
      '<button class="btn" type="button" id="pend">End training <kbd>x</kbd></button></div>' +
      '<p class="muted" id="endnote" hidden>Press x again to end today\'s training.</p>' +
      '<p class="muted"><kbd>Esc</kbd> goes home; today\'s training stays ready to resume.</p></section>';
  }
  // extra: keys of the screen around the bar (e.g. d for Details)
  function bindProgrammeBar(extra) {
    var act = {
      next: function () { runStep(); },
      skip: function () { app.run.skip(); saveRun(); viewBetween(); },
      repeat: function () { app.run.repeat(); saveRun(); runStep(); },
      end: function () { app.run.finishEarly(); saveRun(); viewProgrammeSummary(); },
      home: function () { go('home'); },
    };
    // ending today's training asks once (button or x)
    var pend = document.getElementById('pend');
    function askEnd() {
      if (pend.classList.contains('armed')) { act.end(); return; }
      pend.classList.add('armed');
      pend.innerHTML = 'Press again to end <kbd>x</kbd>';
      U.announce('Press x again to end today\'s training.');
      var note = document.getElementById('endnote');
      if (note) note.hidden = false;
      bindKeys();
    }
    function bindKeys() {
      app.keys = Object.assign({ Enter: act.next, r: act.repeat, Escape: act.home, x: askEnd }, extra || {});
      if (sk) app.keys.n = act.skip;
    }
    document.getElementById('pnext').onclick = act.next;
    var sk = document.getElementById('pskip'); if (sk) sk.onclick = act.skip;
    document.getElementById('prep').onclick = act.repeat;
    pend.onclick = askEnd;
    bindKeys();
  }
  function viewBetween() {
    app.current = 'summary';
    renderNav();
    setView(programmeBar());
    bindProgrammeBar();
  }
  function viewNeedText(c) {
    app.current = 'needtext';
    renderNav();
    setView('<section class="stack"><h1>Prose needs a text</h1><p>Paste something you would enjoy reading: a chapter, an article, a public-domain book from Project Gutenberg. ' +
      'LessTypos remembers where you stop.</p>' + textForm() +
      '<div class="row"><button class="btn" type="button" id="skipprose">Skip prose today</button></div></section>');
    bindTextForm(function () { runStep(); });
    document.getElementById('tbody').focus();
    document.getElementById('skipprose').onclick = function () { app.run.skip(); saveRun(); viewBetween(); };
    app.keys = { Escape: function () { go('home'); } };
  }
  function viewProgrammeSummary() {
    app.current = 'summary';
    renderNav();
    var res = app.run ? app.run.results() : [];
    var mins = res.reduce(function (a, r) { return a + (r.ms || 0); }, 0) / 60000;
    var html = '<section class="stack"><h1>Daily training finished</h1><p class="muted">' + fix(mins, 1) + ' minutes of typing across ' +
      res.filter(function (r) { return !r.skipped; }).length + ' exercises.</p></section>' +
      '<div class="tablewrap"><table><thead><tr><th>Exercise</th><th>Min</th><th>WPM</th><th>Accuracy</th><th>Effort</th><th>Note</th></tr></thead><tbody>' +
      res.map(function (r) {
        return '<tr><td>' + esc(EXERCISES[r.type].name) + '</td>' + (r.skipped ? '<td colspan="4" class="muted">skipped</td><td></td>'
          : '<td class="num">' + fix(r.ms / 60000, 1) + '</td><td class="num">' + fix(r.wpm) + '</td><td class="num">' + pct(r.faa) + '</td><td class="num">' + (r.effort || '–') + '</td><td>' + esc(r.note || '') + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="muted">Speeds from different exercises are not comparable: warm-up and bursts use easier words, prose has capitals and punctuation.</p>' +
      '<div class="row"><button class="btn primary" type="button" id="home">Done <kbd>Enter</kbd></button><a href="#insights/progress">See progress</a></div>';
    app.run = null;
    saveRun();
    setView(html);
    document.getElementById('home').onclick = function () { go('home'); };
    app.keys = { Enter: function () { go('home'); }, Escape: function () { go('home'); } };
  }

  // ---------- effort ----------
  function viewEffort(info) {
    app.store.saveDraft(draftOf(info)).catch(storageError); // kept until rated, so a reload cannot lose it
    app.current = 'effort';
    renderNav();
    setView('<section class="effort"><h1>How much effort did that take?</h1>' +
      '<p class="muted">Your rating lets LessTypos compare speed at the same effort, and it holds vocabulary growth when typing feels demanding.</p>' +
      '<div class="scale">' + EFFORT.map(function (e) {
        return '<button type="button" data-effort="' + e[0] + '"><b>' + e[0] + '</b><span>' + esc(e[1]) + '</span><span class="muted">' + esc(e[2]) + '</span></button>';
      }).join('') + '</div>' +
      '<p class="muted" id="effortkeys">Press 1–5, or 0, Enter or Esc to skip.</p>' +
      '<div class="row"><button class="btn" type="button" data-effort="">Skip <kbd>Enter</kbd></button></div></section>');
    var done = false;
    function pick(v, render) {
      if (done) return;
      done = true;
      app.leaveEffort = null;
      app.typingEndedAt = 0; // answering is deliberate: keys from the exercise are no longer in flight
      document.removeEventListener('keydown', onKey, true);
      info.effort = v;
      complete(info, render !== false);
    }
    app.leaveEffort = function () { pick(null, false); };
    function onKey(e) {
      if (Date.now() < (app.effortGuardUntil || 0)) { e.preventDefault(); return; } // still in flight from typing
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick(+e.key); }
      else if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('[data-effort]')) { e.preventDefault(); var v = e.target.closest('[data-effort]').dataset.effort; pick(v ? +v : null); }
      else if (e.key === 'Enter' || e.key === '0' || e.key === 'Escape') { e.preventDefault(); pick(null); }
    }
    document.addEventListener('keydown', onKey, true);
    app.$view.querySelectorAll('[data-effort]').forEach(function (b) {
      b.onclick = function () { pick(b.dataset.effort ? +b.dataset.effort : null); };
    });
  }

  // What a reload needs to ask for the rating again: the recorded exercise and
  // the few screen options that shape what follows.
  function draftOf(info) {
    var o = info.opts;
    return { raw: info.raw, ui: { programme: !!o.programme, run: o.run || null, minutes: o.minutes || null,
      pinned: o.pinned || null, textId: o.text ? o.text.id : null } };
  }
  function infoFromDraft(draft, text) {
    var ui = draft.ui;
    var opts = { programme: ui.programme, run: ui.run, minutes: ui.minutes, pinned: ui.pinned };
    if (text) opts.text = text;
    return { type: draft.raw.type, raw: draft.raw, opts: opts };
  }

  function complete(info, render) {
    var raw = info.raw;
    raw.effort = info.effort == null ? null : info.effort;
    var res = { raw: raw, summary: app.trainer.process(raw) };
    var writes = [app.store.saveSession(raw).then(saveProfile).then(function () { return app.store.clearDraft(); })];
    var t = info.opts.text;
    if (raw.text && t) {
      t.pos = res.raw.text.to;
      res.summary.textProgress = { title: t.title, pos: t.pos, total: t.words.length };
      writes.push(app.store.saveText(t));
    }
    Promise.all(writes).catch(storageError);
    if (info.opts.programme && app.run) {
      var m = res.summary.metrics;
      app.run.complete({ ms: res.summary.durationMs, wpm: m.wpm, faa: m.firstAttemptAccuracy, effort: info.effort,
        note: res.summary.rounds ? 'target ' + Math.round(app.trainer.bursts.target()) + ' WPM' : res.summary.textProgress ? proseProgress(res.summary.textProgress, res.summary.textProgress.pos) : '' });
      saveRun();
    }
    if (info.opts.bench) { viewBenchStep(res.summary); return; }
    if (render !== false) viewSummary(res.summary, info);
  }

  // ---------- summary ----------
  // The decision first (what next), then speed, accuracy and one sentence each
  // on vocabulary and the focus list; everything else is under Details (d).
  function viewSummary(s, info) {
    app.current = 'summary';
    renderNav();
    var m = s.metrics, h = app.trainer.history();
    var cur = h[h.length - 1];
    var cmp = FT.progress.compare(h.slice(0, -1), cur);
    var inProg = info.opts && info.opts.programme && app.run;
    var tg = app.trainer.targets();
    var html = (inProg ? programmeBar() : '') +
      '<section class="stack"><h1>' + esc(EXERCISES[s.type].name) + ' finished</h1>' +
      (inProg ? '' : '<div class="row"><button class="btn primary" type="button" id="again">Practise again <kbd>Enter</kbd></button>' +
        '<button class="btn" type="button" id="seqs">See the focus list <kbd>q</kbd></button></div>') +
      '<div class="tiles">' +
      '<div class="tile"><b>' + fix(m.wpm) + '</b><span>WPM</span></div>' +
      '<div class="tile"><b>' + pct(m.firstAttemptAccuracy) + '</b><span>accuracy (first try)</span></div>' +
      '</div>' +
      (s.textProgress ? '<p>' + esc(s.textProgress.title) + ': ' + proseProgress(s.textProgress, s.textProgress.pos) + '. Your place is saved.</p>' : '') +
      (s.difficulty ? '<p>' + esc(FT.fmt.vocabSentence(s.difficulty, s.frontier)) + '</p>' : '') +
      '<p>' + focusSentence(s, tg) + '</p>' +
      '</section>';
    if (s.rounds) {
      html += '<section class="stack"><h3>Rounds</h3><div class="tablewrap"><table><thead><tr><th>Round</th><th>WPM</th><th>Accuracy</th><th>Target</th><th>Result</th></tr></thead><tbody>' +
        s.rounds.map(function (r) {
          return '<tr><td class="num">' + r.round + '</td><td class="num">' + fix(r.wpm) + '</td><td class="num">' + pct(r.accuracy) + '</td><td class="num">' +
            Math.round(r.before) + ' → ' + Math.round(r.after) + '</td><td>' + esc(r.reason) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="muted">The target rises a little after each round that meets it with at least 95% accuracy and eases otherwise, so it settles where you reach it about half the time. Bursts never change your vocabulary level or the sequence statistics.</p></section>';
    }
    html += '<details id="details" class="stack"><summary>Details <kbd>d</kbd></summary>' + details(s, m, cmp) + '</details>';
    setView(html);
    var drawn = false, det = document.getElementById('details');
    function draw() {
      if (drawn || !det.open) return;
      drawn = true;
      if (s.timeline && s.timeline.length > 1) FT.chart.timeline(document.getElementById('chart'), s.timeline);
      if (app.layout && s.keyStats) FT.chart.heatmap(document.getElementById('hmex'), FT.layout.grid(app.layout), s.keyStats);
    }
    det.addEventListener('toggle', draw);
    var toggle = function () { det.open = !det.open; draw(); bindKeys(); };
    var again = function () { startExercise(info.type, info.opts); };
    function bindKeys() {
      if (inProg) bindProgrammeBar({ d: toggle });
      else app.keys = { Enter: again, q: function () { go('insights/focus'); }, d: toggle };
    }
    if (!inProg) {
      document.getElementById('again').onclick = again;
      document.getElementById('seqs').onclick = function () { go('insights/focus'); };
    }
    bindKeys();
  }
  function focusSentence(s, tg) {
    var changes = s.stageChanges || [];
    var lead = tg.length ? 'Focus list: ' + tg.length + ' sequence' + (tg.length === 1 ? '' : 's') + ', led by ' + tg.slice(0, 3).map(function (x) { return seq(x.key); }).join(', ') + '.'
      : 'Nothing in the focus list yet.';
    if (!changes.length) return lead;
    return lead + ' ' + changes.slice(0, 3).map(function (c) { return seq(c.key) + ' ' + esc(c.from ? FT.fmt.stageLabel(c.from) + ' → ' : 'now ') + esc(FT.fmt.stageLabel(c.to)); }).join(', ') +
      (changes.length > 3 ? ' and ' + (changes.length - 3) + ' more' : '') + '.';
  }
  function details(s, m, cmp) {
    var html = '<div class="tiles">' +
      '<div class="tile"><b>' + pct(s.random.firstAttemptAccuracy) + '</b><span>on the ' + s.random.words + ' random words</span></div>' +
      '<div class="tile"><b>' + pct(s.hesitationRate) + '</b><span>keystrokes over twice their usual time</span></div>' +
      '<div class="tile"><b>' + fix(s.rhythmCv, 2) + '</b><span>rhythm variation (lower is more even)</span></div>' +
      '<div class="tile"><b>' + pct(s.rollover, 0) + '</b><span>keys pressed before the last was released</span></div>' +
      '</div>' +
      '<p class="muted">' + fix(s.durationMs / 60000, 1) + ' minutes, ' + m.words + ' words' +
      (s.effort ? ', effort ' + s.effort + ' (' + esc(EFFORT[s.effort - 1][1].toLowerCase()) + ')' : '') + '. ' +
      (m.IF ? m.IF + ' corrected keystrokes, ' : '') + m.F + ' backspaces, ' + fix(m.INF) + ' uncorrected errors.</p>';
    if (cmp) html += '<p class="notice info">' + esc(cmp.message) + '</p>';
    if (s.timeline && s.timeline.length > 1) {
      html += '<section class="stack"><h3>Speed through the exercise</h3>' +
        '<div class="legend"><span><i class="k1"></i>Running average</span><span><i class="k2"></i>Each word</span>' +
        '<span><i class="kx">×</i>Word with an error on the first try</span></div>' +
        '<div class="chart" id="chart"></div>' +
        '<details class="tableview"><summary>Show as table</summary><div class="tablewrap"><table><thead><tr><th>#</th><th>Word</th><th>WPM (word)</th><th>WPM (running)</th><th>Error</th></tr></thead><tbody>' +
        s.timeline.map(function (p) {
          return '<tr><td class="num">' + p.i + '</td><td>' + esc(p.word) + '</td><td class="num">' + fix(p.burst) + '</td><td class="num">' + fix(p.running) + '</td><td>' + (p.error ? '×' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></details></section>';
    }
    if (app.layout && s.keyStats) html += '<section class="stack"><h3>Errors by key</h3><div class="heatmap" id="hmex"></div></section>';
    return html;
  }

  Object.assign(U, { infoFromDraft: infoFromDraft, startBenchmark: startBenchmark, viewBenchResult: viewBenchResult, viewHome: viewHome, saveRun: saveRun, startProgramme: startProgramme, runStep: runStep, nextLine: nextLine, programmeBar: programmeBar, bindProgrammeBar: bindProgrammeBar, viewBetween: viewBetween, viewNeedText: viewNeedText, viewProgrammeSummary: viewProgrammeSummary, viewEffort: viewEffort, complete: complete, viewSummary: viewSummary });
})(globalThis.FT);
