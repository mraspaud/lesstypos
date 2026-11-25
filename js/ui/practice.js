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
  function viewHome() {
    var t = app.trainer, d = t.difficulty.state(), h = t.history();
    var targets = t.targets().slice(0, 6);
    var relaxed = h.filter(function (x) { return x.type === 'relaxed'; });
    var last = relaxed[relaxed.length - 1];
    var def = programmeDef(), run = FT.programme.resume(app.settings.programmeRun, today());
    var steps = def.steps.filter(function (x) { return x.enabled; });
    var html = '<section class="home-start">' +
      '<h1>Daily training</h1>' +
      '<p class="lead">' + steps.map(function (x) { return esc(EXERCISES[x.type].name.toLowerCase()) + ' ' + x.minutes + ' min'; }).join(' · ') + '.</p>' +
      '<div class="row">' +
      (run ? '<button class="btn primary" type="button" id="resume">Resume: ' + esc(EXERCISES[run.current().type].name.toLowerCase()) + ' (' + (run.results().length + 1) + ' of ' + (run.results().length + run.upcoming().length) + ')</button>' +
        '<button class="btn" type="button" id="prog">Start over</button>'
        : '<button class="btn primary" type="button" id="prog">Start daily training · ' + FT.programme.totalMinutes(def) + ' min</button>') +
      '<span class="muted">or press <kbd>Enter</kbd></span></div>' +
      '<div class="row"><button class="btn" type="button" id="start">Relaxed practice only · ' + app.settings.durationMin + ' min</button></div>' +
      '</section>' +
      '<section class="stack"><h3>Where you are</h3><div class="status">' +
      '<div><b class="num">' + Math.round(d.frontier) + '</b><span>most common words in use' + (d.manual ? ' (manual)' : '') + '</span></div>' +
      '<div><b class="num">' + t.targets().length + '</b><span>sequences in training</span></div>' +
      '<div><b class="num">' + h.length + '</b><span>exercises so far</span></div>' +
      (last ? '<div><b class="num">' + fix(last.wpm) + ' · ' + pct(last.faa) + '</b><span>last relaxed WPM · accuracy</span></div>' : '') +
      '</div></section>';
    if (targets.length) {
      html += '<section class="stack"><h3>Training focus</h3><div class="row">' +
        targets.map(function (x) { return seq(x.key) + ' ' + pill(x.stage); }).join('&nbsp;&nbsp;') + '</div>' +
        '<p class="muted">These sequences will appear inside ordinary words. <a href="#sequences">Why these?</a></p></section>';
    } else if (!h.length) {
      html += '<section class="stack panel"><h2>How this works</h2>' +
        '<p>LessTypos watches every keystroke and learns which letter sequences, including those across spaces, cost you errors or hesitation. ' +
        'Later exercises weave those sequences into everyday words, while about a fifth of the words stay random so progress can be measured fairly.</p>' +
        '<p>Vocabulary grows when your first-attempt accuracy stays above 99.5% and typing feels comfortable. It never asks for a minimum speed.</p>' +
        '<p class="muted">For the prose exercise, add a text you would like to read on the <a href="#texts">Texts</a> page. If your keyboard has keys that type several letters at once (such as <span class="seq">th</span>), declare them in Settings.</p></section>';
    }
    setView(html);
    document.getElementById('start').onclick = function () { startExercise('relaxed'); };
    document.getElementById('prog').onclick = function () { startProgramme(null); };
    var r = document.getElementById('resume');
    if (r) r.onclick = function () { startProgramme(run); };
    app.homeEnter = function () { startProgramme(run); };
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
      currentText().then(function (text) {
        if (text && text.pos < text.words.length) startExercise('prose', { minutes: c.minutes, programme: true, text: text, run: app.run.id() });
        else viewNeedText(c);
      });
      return;
    }
    startExercise(c.type, { minutes: c.minutes, programme: true, run: app.run.id() });
  }
  function nextLine() {
    var c = app.run.current();
    if (!c) return '<p>That was the last exercise.</p>';
    return '<p><b>Next: ' + esc(EXERCISES[c.type].name) + '</b>, ' + c.minutes + ' min. <span class="muted">' + esc(EXERCISES[c.type].goal) + '</span></p>';
  }
  function programmeBar() {
    var r = app.run, done = r.results().length, total = done + r.upcoming().length;
    return '<section class="panel stack" id="progbar"><h3>Daily training · ' + Math.min(done, total) + ' of ' + total + ' done</h3>' + nextLine() +
      '<div class="row">' + (r.current() ? '<button class="btn primary" type="button" id="pnext">Continue <kbd>Enter</kbd></button>' +
        '<button class="btn" type="button" id="pskip">Skip next <kbd>n</kbd></button>' : '<button class="btn primary" type="button" id="pnext">See the session summary <kbd>Enter</kbd></button>') +
      '<button class="btn" type="button" id="prep">Repeat this one <kbd>r</kbd></button>' +
      '<button class="btn" type="button" id="pend">End training <kbd>Esc</kbd></button></div></section>';
  }
  function bindProgrammeBar() {
    var act = {
      next: function () { runStep(); },
      skip: function () { app.run.skip(); saveRun(); viewBetween(); },
      repeat: function () { app.run.repeat(); saveRun(); runStep(); },
      end: function () { app.run.finishEarly(); saveRun(); viewProgrammeSummary(); },
    };
    document.getElementById('pnext').onclick = act.next;
    var sk = document.getElementById('pskip'); if (sk) sk.onclick = act.skip;
    document.getElementById('prep').onclick = act.repeat;
    document.getElementById('pend').onclick = act.end;
    app.progKeys = act;
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
    document.getElementById('skipprose').onclick = function () { app.run.skip(); saveRun(); viewBetween(); };
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
      '<div class="row"><button class="btn primary" type="button" id="home">Done <kbd>Enter</kbd></button><a href="#history">See history</a></div>';
    app.run = null;
    app.progKeys = null; app.again = null;
    saveRun();
    setView(html);
    document.getElementById('home').onclick = function () { go('home'); };
    app.homeEnter = null;
  }

  // ---------- effort ----------
  function viewEffort(info) {
    app.current = 'effort';
    renderNav();
    setView('<section class="effort"><h1>How much effort did that take?</h1>' +
      '<p class="muted">Your rating lets LessTypos compare speed at the same effort, and it holds vocabulary growth when typing feels demanding.</p>' +
      '<div class="scale">' + EFFORT.map(function (e) {
        return '<button type="button" data-effort="' + e[0] + '"><b>' + e[0] + '</b><span>' + esc(e[1]) + '</span><span class="muted">' + esc(e[2]) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="row"><button class="btn" type="button" data-effort="">Skip <kbd>Enter</kbd></button></div></section>');
    var done = false;
    function pick(v, render) {
      if (done) return;
      done = true;
      app.leaveEffort = null;
      document.removeEventListener('keydown', onKey, true);
      info.effort = v;
      complete(info, render !== false);
    }
    app.leaveEffort = function () { pick(null, false); };
    function onKey(e) {
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick(+e.key); }
      else if (e.key === 'Enter' || e.key === '0') { e.preventDefault(); pick(null); }
    }
    document.addEventListener('keydown', onKey, true);
    app.$view.querySelectorAll('[data-effort]').forEach(function (b) {
      b.onclick = function () { pick(b.dataset.effort ? +b.dataset.effort : null); };
    });
  }

  function complete(info, render) {
    var res = app.trainer.finish({ type: info.type, startedAt: info.startedAt, durationMs: info.durationMs,
      words: info.words, keys: info.keys, effort: info.effort, text: info.text, rounds: info.rounds, run: info.opts.run });
    var writes = [app.store.saveSession(res.raw).then(saveProfile)];
    if (res.raw.text) {
      var t = info.opts.text;
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
    if (render !== false) viewSummary(res.summary, info);
  }

  // ---------- summary ----------
  function viewSummary(s, info) {
    app.current = 'summary';
    renderNav();
    var m = s.metrics, h = app.trainer.history();
    var cur = h[h.length - 1];
    var cmp = FT.progress.compare(h.slice(0, -1), cur);
    var html = '<section class="stack"><h1>' + esc(EXERCISES[s.type].name) + ' finished</h1>' +
      '<p class="muted">' + fix(s.durationMs / 60000, 1) + ' minutes, ' + m.words + ' words' +
      (s.effort ? ', effort ' + s.effort + ' (' + esc(EFFORT[s.effort - 1][1].toLowerCase()) + ')' : '') + '.</p></section>' +
      '<div class="tiles">' +
      '<div class="tile"><b>' + fix(m.wpm) + '</b><span>WPM</span></div>' +
      '<div class="tile"><b>' + pct(m.firstAttemptAccuracy) + '</b><span>first-attempt accuracy</span></div>' +
      '<div class="tile"><b>' + pct(s.random.firstAttemptAccuracy) + '</b><span>on the ' + s.random.words + ' random words</span></div>' +
      '<div class="tile"><b>' + pct(s.hesitationRate) + '</b><span>hesitations</span></div>' +
      '<div class="tile"><b>' + fix(s.rhythmCv, 2) + '</b><span>rhythm variation (lower is more even)</span></div>' +
      '<div class="tile"><b>' + pct(s.rollover, 0) + '</b><span>keys overlapped (rollover)</span></div>' +
      '</div>';
    if (cmp) html += '<p class="notice info">' + esc(cmp.message) + '</p>';
    if (s.textProgress) html += '<p>' + esc(s.textProgress.title) + ': ' + proseProgress(s.textProgress, s.textProgress.pos) + '. Your place is saved.</p>';
    if (s.rounds) {
      html += '<section class="stack"><h3>Rounds</h3><div class="tablewrap"><table><thead><tr><th>Round</th><th>WPM</th><th>Accuracy</th><th>Target</th><th>Result</th></tr></thead><tbody>' +
        s.rounds.map(function (r) {
          return '<tr><td class="num">' + r.round + '</td><td class="num">' + fix(r.wpm) + '</td><td class="num">' + pct(r.accuracy) + '</td><td class="num">' +
            Math.round(r.before) + ' → ' + Math.round(r.after) + '</td><td>' + esc(r.reason) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="muted">The target rises a little after each round that meets it with at least 95% accuracy and eases otherwise, so it settles where you reach it about half the time. Bursts never change your vocabulary level or the sequence statistics.</p></section>';
    }
    if (s.timeline && s.timeline.length > 1) {
      html += '<section class="stack"><h3>Speed through the exercise</h3>' +
        '<div class="legend"><span><i class="k1"></i>Running average</span><span><i class="k2"></i>Each word</span>' +
        '<span><i class="kx">×</i>Word with a first-attempt error</span></div>' +
        '<div class="chart" id="chart"></div>' +
        '<details class="tableview"><summary>Show as table</summary><div class="tablewrap"><table><thead><tr><th>#</th><th>Word</th><th>WPM (word)</th><th>WPM (running)</th><th>Error</th></tr></thead><tbody>' +
        s.timeline.map(function (p) {
          return '<tr><td class="num">' + p.i + '</td><td>' + esc(p.word) + '</td><td class="num">' + fix(p.burst) + '</td><td class="num">' + fix(p.running) + '</td><td>' + (p.error ? '×' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></details></section>';
    }
    var notes = [];
    if (s.difficulty) {
      var d = s.difficulty;
      var verb = { advance: 'Vocabulary grows', hold: 'Vocabulary stays', retreat: 'Vocabulary eases', wait: 'Collecting evidence', manual: 'Manual vocabulary' }[d.action];
      notes.push('<li><b>' + esc(verb) + '</b> at the ' + Math.round(s.frontier) + ' most common words: ' + esc(d.reasons.join('; ')) + '.</li>');
    }
    s.stageChanges.slice(0, 8).forEach(function (c) {
      notes.push('<li>' + seq(c.key) + ' ' + (c.from ? pill(c.from) + ' → ' : 'is now ') + pill(c.to) + '</li>');
    });
    var corrected = m.IF ? m.IF + ' corrected keystrokes, ' : '';
    notes.push('<li>' + corrected + m.F + ' backspaces, ' + fix(m.INF) + ' uncorrected errors.</li>');
    html += '<section class="stack"><h3>What happened</h3><ul class="list">' + notes.join('') + '</ul></section>';
    var tg = app.trainer.targets().slice(0, 6);
    if (tg.length) html += '<section class="stack"><h3>Next focus</h3><div class="row">' + tg.map(function (x) { return seq(x.key) + ' ' + pill(x.stage); }).join('&nbsp;&nbsp;') + '</div></section>';
    var inProg = info.opts && info.opts.programme && app.run;
    if (inProg) html = programmeBar() + html;
    else html += '<div class="row"><button class="btn primary" type="button" id="again">Practise again <kbd>Enter</kbd></button>' +
      '<button class="btn" type="button" id="seqs">See sequences <kbd>q</kbd></button></div>';
    setView(html);
    if (inProg) {
      bindProgrammeBar();
      if (s.timeline && s.timeline.length > 1) FT.chart.timeline(document.getElementById('chart'), s.timeline);
      app.again = null;
      return;
    }
    app.progKeys = null;
    if (s.timeline && s.timeline.length > 1) FT.chart.timeline(document.getElementById('chart'), s.timeline);
    document.getElementById('again').onclick = function () { startExercise(info.type, info.opts); };
    document.getElementById('seqs').onclick = function () { go('sequences'); };
    app.again = function () { startExercise(info.type, info.opts); };
  }

  Object.assign(U, { viewHome: viewHome, saveRun: saveRun, startProgramme: startProgramme, runStep: runStep, nextLine: nextLine, programmeBar: programmeBar, bindProgrammeBar: bindProgrammeBar, viewBetween: viewBetween, viewNeedText: viewNeedText, viewProgrammeSummary: viewProgrammeSummary, viewEffort: viewEffort, complete: complete, viewSummary: viewSummary });
})(globalThis.FT);
