// Application controller and views (browser only).
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;

  var DEFAULT_SETTINGS = {
    durationMin: 5, errorMode: 'continue', errorStyle: 'clear', macros: [], autoMacros: false,
    layoutText: '', fontSize: 1.6, theme: 'system', showTimer: true,
    accents: true, programme: null, programmeRun: null, currentText: null,
  };
  var EXERCISES = {
    warmup: { name: 'Warm-up', goal: 'Familiar words to settle your hands into a comfortable rhythm. No need to push.' },
    relaxed: { name: 'Relaxed practice', goal: 'Type calmly and look ahead. Accuracy and an even rhythm matter more than speed.' },
    bursts: { name: 'Speed bursts', goal: 'Short sprints just above your comfortable pace, with a rest between rounds. Start each round when you are ready.' },
    prose: { name: 'Prose', goal: 'Read and type naturally. Capitals and punctuation count; plain quotes and dashes are accepted.' },
    targeted: { name: 'Targeted practice', goal: 'The sequences you are training appear in many different words. Keep the rhythm relaxed.' },
  };
  var BURST_RUN = 15000, BURST_REST = 10000;
  function burstRun() { return app.burstRun || BURST_RUN; }   // overridable for tests
  function burstRest() { return app.burstRest || BURST_REST; }
  var EFFORT = [
    [1, 'Effortless', 'Typing ran on its own'],
    [2, 'Comfortable', 'Little attention needed'],
    [3, 'Moderate', 'Some concentration'],
    [4, 'Demanding', 'Constant concentration'],
    [5, 'Maximum', 'Pushing hard'],
  ];

  var app = { store: null, settings: null, trainer: null, storageOk: true, notice: null, layout: null };
  var $view, $nav;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function seq(k) { return '<span class="seq">' + esc(String(k).replace(/ /g, '␣')) + '</span>'; }
  function pct(x, d) { return x == null ? '–' : (100 * x).toFixed(d == null ? 1 : d) + '%'; }
  function fix(x, d) { return x == null || !isFinite(x) ? '–' : x.toFixed(d == null ? 0 : d); }
  function pill(name) { return name ? '<span class="pill ' + esc(name) + '">' + esc(name) + '</span>' : ''; }

  // ---------- settings ----------
  function macros() {
    var m = (app.settings.macros || []).slice();
    if (app.layout) app.layout.macros.forEach(function (x) { if (m.indexOf(x) < 0) m.push(x); });
    return m;
  }
  function applySettings() {
    var s = app.settings;
    document.documentElement.style.setProperty('--type-size', s.fontSize + 'rem');
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', s.theme);
    app.layout = null;
    if (s.layoutText && s.layoutText.trim()) { try { app.layout = FT.layout.parse(s.layoutText); } catch (e) { app.layout = null; } }
    if (app.trainerSettings) app.trainerSettings.macros = macros();
    FT.text.setOptions({ accents: s.accents !== false });
  }
  function programmeDef() { return app.settings.programme || FT.programme.DEFAULT; }
  function today() { return FT.trainer.dayOf(Date.now()); }
  function saveSettings() {
    applySettings();
    return app.store.saveSettings(app.settings).catch(storageError);
  }
  function saveProfile() { return app.store.saveProfile(app.trainer.profile()).catch(storageError); }
  function storageError(e) {
    app.notice = 'Your progress could not be saved (' + (e && e.message || e) + '). Export your data from the Data page to keep it.';
    renderNotice();
  }

  function makeTrainer(profile, sessions) {
    app.trainerSettings = { macros: macros() };
    var opts = { settings: app.trainerSettings, seed: (Date.now() % 1e6) + 1 };
    if (profile) return FT.trainer.create(Object.assign({ profile: profile }, opts));
    if (sessions && sessions.length) return FT.trainer.rebuild(sessions, opts);
    return FT.trainer.create(opts);
  }

  // ---------- routing ----------
  var ROUTES = ['home', 'texts', 'sequences', 'errors', 'history', 'preferences', 'data'];
  var NAV = [['home', 'Practice', 'p'], ['texts', 'Texts', 't'], ['sequences', 'Sequences', 'q'], ['errors', 'Errors', 'e'],
    ['history', 'History', 'h'], ['preferences', 'Settings', 's'], ['data', 'Data', 'd']];
  var current = 'home';
  function go(name) {
    if (ROUTES.indexOf(name) < 0) name = 'home';
    if (location.hash.slice(1) !== name) { try { location.hash = name; } catch (e) { /* ignore */ } }
    show(name);
  }
  function show(name) {
    stopTyping();
    current = name;
    document.body.classList.remove('typing-mode');
    renderNav();
    ({ home: viewHome, texts: viewTexts, sequences: viewSequences, errors: viewErrors, history: viewHistory,
      preferences: viewSettings, data: viewData })[name]();
  }
  function renderNav() {
    $nav.innerHTML = NAV.map(function (n) {
      return '<button type="button" data-go="' + n[0] + '"' + (current === n[0] ? ' aria-current="page"' : '') + '>' +
        esc(n[1]) + '<kbd>' + n[2] + '</kbd></button>';
    }).join('');
  }
  function renderNotice() {
    var el = document.getElementById('notice');
    if (!el) return;
    el.hidden = !app.notice;
    el.textContent = app.notice || '';
  }
  function setView(html) {
    $view.innerHTML = '<div id="notice" class="notice" hidden></div>' + html;
    renderNotice();
  }

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
        if (text && text.pos < text.words.length) startExercise('prose', { minutes: c.minutes, programme: true, text: text });
        else viewNeedText(c);
      });
      return;
    }
    startExercise(c.type, { minutes: c.minutes, programme: true });
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
    current = 'summary';
    renderNav();
    setView(programmeBar());
    bindProgrammeBar();
  }
  function viewNeedText(c) {
    current = 'needtext';
    renderNav();
    setView('<section class="stack"><h1>Prose needs a text</h1><p>Paste something you would enjoy reading: a chapter, an article, a public-domain book from Project Gutenberg. ' +
      'LessTypos remembers where you stop.</p>' + textForm() +
      '<div class="row"><button class="btn" type="button" id="skipprose">Skip prose today</button></div></section>');
    bindTextForm(function () { runStep(); });
    document.getElementById('skipprose').onclick = function () { app.run.skip(); saveRun(); viewBetween(); };
  }
  function viewProgrammeSummary() {
    current = 'summary';
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
    saveRun();
    setView(html);
    document.getElementById('home').onclick = function () { go('home'); };
    app.homeEnter = null;
  }

  // ---------- typing ----------
  var ty = null; // active typing state
  function stopTyping() {
    if (ty) { clearInterval(ty.timer); if (ty.detach) ty.detach(); ty = null; }
  }
  function startExercise(type, opts) {
    stopTyping();
    opts = opts || {};
    current = 'typing';
    document.body.classList.add('typing-mode');
    renderNav();
    var exDef = EXERCISES[type];
    var ex = app.trainer.newExercise({ type: type, pinned: opts.pinned, text: opts.text });
    var durationMs = (opts.minutes || app.settings.durationMin) * 60000;
    var nRounds = Math.max(1, Math.floor(durationMs / (2 * burstRun())));
    setView('<section class="typing">' +
      '<div class="ex-head"><span class="name">' + esc(exDef.name) + (opts.pinned ? ' ' + opts.pinned.map(seq).join(' ') : '') + '</span>' +
      '<span>' + esc(exDef.goal) + '</span>' +
      (type === 'prose' ? '<span class="muted">' + esc(opts.text.title) + ', ' + proseProgress(opts.text, opts.text.pos) + '</span>' : '') +
      '<span class="timer num" id="timer"' + (app.settings.showTimer || type === 'bursts' ? '' : ' hidden') + '>' + (type === 'bursts' ? 'Round 1 of ' + nRounds : clock(durationMs)) + '</span></div>' +
      (type === 'bursts' ? '<div class="pace" id="pace" aria-hidden="true"><div class="pace-fill" id="pacefill"></div><div class="pace-target" id="pacetarget"></div></div>' +
        '<div class="pace-label muted num" id="pacelabel">Target ' + Math.round(app.trainer.bursts.target()) + ' WPM</div>' : '') +
      '<div class="window' + (app.settings.errorStyle === 'subtle' ? ' subtle' : '') + '" id="window"><div class="inner" id="inner"></div><div class="caret" id="caret"></div></div>' +
      '<div class="focus-hint" id="hint">Start typing when ready. <kbd>Esc</kbd> stops, <kbd>Tab</kbd> restarts.</div>' +
      '<div id="stopbar" class="stopbar" hidden></div>' +
      '<textarea id="capture" class="capture" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Typing input"></textarea>' +
      '</section>');
    var session = FT.session.create(ex.words.slice(0, 120));
    var fed = 120;
    ty = { type: type, ex: ex, session: session, fed: fed, durationMs: durationMs, keys: [], first: null, startedAt: null,
      els: [], inner: document.getElementById('inner'), caret: document.getElementById('caret'),
      win: document.getElementById('window'), capture: document.getElementById('capture'), stopped: false, opts: opts, offset: 0 };
    if (type === 'bursts') ty.burst = { total: nRounds, rounds: [], phase: 'ready', target: app.trainer.bursts.target(), ref: app.trainer.bursts.reference() };
    renderWords(0);
    ty.detach = FT.input.attach(ty.capture, {
      onText: onText, onBack: onBack, onBackWord: onBackWord,
      onKey: function (k) { if (ty && ty.first != null && !ty.stopped) ty.keys.push(k); },
      onEscape: onEscape, onTab: function () { startExercise(type, opts); },
      onEnter: function () { if (ty && ty.stopped) finishExercise(); },
    });
    ty.win.addEventListener('click', focusCapture);
    ty.capture.addEventListener('blur', function () { if (ty) { ty.win.classList.add('blurred'); hint('Click here or press any key to continue typing.'); } });
    ty.capture.addEventListener('focus', function () { if (ty) { ty.win.classList.remove('blurred'); hint(ty.first == null ? 'Start typing when ready. <kbd>Esc</kbd> stops, <kbd>Tab</kbd> restarts.' : ''); } });
    focusCapture();
    placeCaret();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ty) placeCaret(); });
  }
  window.addEventListener('resize', function () { if (ty) placeCaret(); });
  function focusCapture() { if (ty) ty.capture.focus({ preventScroll: true }); }
  function hint(html) { var el = document.getElementById('hint'); if (el) el.innerHTML = html; }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function renderWords(from) {
    var words = ty.session.state().words;
    var frag = document.createDocumentFragment();
    for (var i = from; i < words.length; i++) {
      var el = document.createElement('span');
      el.className = 'w';
      ty.els[i] = el;
      paintWord(i, el);
      frag.appendChild(el);
    }
    ty.inner.appendChild(frag);
  }
  function paintWord(i, el) {
    var w = ty.session.state().words[i];
    el = el || ty.els[i];
    if (!el) return;
    var T = Array.from(w.target), typed = Array.from(w.typed.replace(/ $/, ''));
    var n = Math.max(T.length, typed.length), html = '';
    for (var j = 0; j < n; j++) {
      var cls = 'l', ch = T[j];
      if (j >= T.length) { cls += ' extra'; ch = typed[j]; }
      else if (j < typed.length) cls += FT.text.same(typed[j], T[j]) ? ' ok' : ' bad';
      html += '<span class="' + cls + '">' + esc(ch) + '</span>';
    }
    el.innerHTML = html;
    el.classList.toggle('missed', w.committed && typed.length < T.length);
  }
  // Caret and line scrolling from on-screen rectangles, relative to the typing
  // window (independent of offsetParent quirks and of the host page's CSS).
  function placeCaret() {
    var st = ty.session.state(), i = st.wordIndex, el = ty.els[i];
    if (!el || !el.isConnected) return;
    var typed = Array.from(st.words[i].typed).length, letters = el.children;
    var win = ty.win.getBoundingClientRect(), inner = ty.inner.getBoundingClientRect();
    var r, x;
    if (typed < letters.length) { r = letters[typed].getBoundingClientRect(); x = r.left; }
    else if (letters.length) { r = letters[letters.length - 1].getBoundingClientRect(); x = r.right; }
    else { r = el.getBoundingClientRect(); x = r.left; }
    var lineH = el.getBoundingClientRect().height || r.height;
    var yInInner = r.top - inner.top;                       // unaffected by the current scroll offset
    var line = Math.round((el.getBoundingClientRect().top - inner.top) / lineH);
    var offset = Math.max(0, line - 1) * lineH;
    if (offset !== ty.offset) {
      ty.offset = offset;
      ty.inner.style.transform = 'translateY(' + (-offset) + 'px)';
    }
    ty.caret.style.left = (x - win.left) + 'px';
    ty.caret.style.top = (yInInner - offset + (r.height - ty.caret.offsetHeight) / 2) + 'px';
  }
  function trimAbove() {
    // Drop committed words more than one line above the view to keep the DOM small.
    // Measure everything first: removing a word reflows the following ones.
    var st = ty.session.state(), cur = ty.els[st.wordIndex];
    if (!cur) return;
    var lh = cur.getBoundingClientRect().height, top = ty.inner.getBoundingClientRect().top, drop = [];
    for (var i = 0; i < st.wordIndex; i++) {
      var el = ty.els[i];
      if (!el || !el.parentNode) continue;
      if (el.getBoundingClientRect().top - top + lh <= ty.offset - lh) drop.push(el); else break;
    }
    drop.forEach(function (el) { el.parentNode.removeChild(el); });
    if (drop.length) { ty.offset = -1; placeCaret(); }
  }
  function beginIfNeeded(t) {
    if (ty.burst && ty.burst.phase === 'ready') {
      ty.burst.phase = 'run'; ty.burst.start = t; ty.burst.startNow = performance.now();
      if (ty.first == null) { ty.first = t; ty.startedAt = Date.now(); ty.t0 = performance.now(); ty.timer = setInterval(tick, 200); }
      hint('');
      return;
    }
    if (ty.first != null) return;
    ty.first = t; ty.startedAt = Date.now(); ty.t0 = performance.now();
    hint('');
    ty.timer = setInterval(tick, 200);
  }
  function tick() {
    if (!ty || ty.stopped) return;
    if (ty.burst) { burstTick(); return; }
    var left = ty.durationMs - (performance.now() - ty.t0);
    var el = document.getElementById('timer');
    if (el) el.textContent = clock(left);
    if (left <= 0) finishExercise();
  }
  // Speed bursts: rounds of BURST_RUN ms, each started by the first keystroke
  // after a BURST_REST ms rest. A live pace bar compares the round's speed
  // with the adaptive target (FT.bursts).
  function burstTick() {
    var b = ty.burst, now = performance.now(), timer = document.getElementById('timer');
    if (b.phase === 'run') {
      var elapsed = now - b.startNow, end = b.start + burstRun();
      var words = ty.session.state().words.filter(function (w) { return w.committed; });
      var st = FT.bursts.roundStats(words, b.start, b.start + Math.min(elapsed, burstRun()));
      paintPace(st.wpm, b.target);
      timer.textContent = 'Round ' + (b.rounds.length + 1) + ' of ' + b.total + ' · ' + clock(burstRun() - elapsed);
      if (elapsed >= burstRun()) {
        b.rounds.push({ start: b.start, end: end });
        var full = FT.bursts.roundStats(words, b.start, end);
        var res = FT.bursts.step(b.target, full, b.ref);
        b.last = { stats: full, res: res };
        b.target = res.after;
        if (b.rounds.length >= b.total) { finishExercise(); return; }
        b.phase = 'rest'; b.restEnd = now + burstRest();
      }
    } else if (b.phase === 'rest') {
      var left = b.restEnd - now, l = b.last;
      timer.textContent = 'Rest · ' + clock(left);
      hint('Round ' + b.rounds.length + ': ' + fix(l.stats.wpm) + ' WPM at ' + pct(l.stats.accuracy, 0) + ' — ' + esc(l.res.reason) +
        '. Target now ' + Math.round(b.target) + ' WPM. Relax your hands; next round in ' + Math.ceil(left / 1000) + ' s.');
      paintPace(null, b.target);
      if (left <= 0) { b.phase = 'ready'; hint('Round ' + (b.rounds.length + 1) + ' of ' + b.total + ': start typing when ready.'); timer.textContent = 'Round ' + (b.rounds.length + 1) + ' of ' + b.total; }
    }
  }
  function paintPace(wpm, target) {
    var max = target * 1.5, fill = document.getElementById('pacefill'), mark = document.getElementById('pacetarget');
    if (!fill) return;
    fill.style.width = Math.min(100, ((wpm || 0) / max) * 100) + '%';
    fill.classList.toggle('over', wpm != null && wpm >= target);
    mark.style.left = (100 / 1.5) + '%';
    document.getElementById('pacelabel').textContent = (wpm != null ? fix(wpm) + ' WPM · ' : '') + 'target ' + Math.round(target) + ' WPM';
  }
  function correctSoFar() {
    var w = ty.session.current();
    return FT.text.isPrefix(w.typed, w.target + ' ');
  }
  function onText(data, t) {
    if (!ty || ty.stopped) return;
    if (ty.burst && ty.burst.phase === 'rest') return;
    if (app.settings.errorMode === 'stop' && !correctSoFar()) return;
    beginIfNeeded(t);
    if (ty.hinted) { hint(''); ty.hinted = false; }
    var before = ty.session.state().wordIndex;
    ty.session.input({ kind: 'text', data: data, t: t });
    var st = ty.session.state();
    for (var i = before; i <= Math.min(st.wordIndex, st.words.length - 1); i++) paintWord(i);
    if (st.words.length - st.wordIndex < 60 && !ty.exhausted) {
      var more = ty.ex.more(100);
      if (!more.length) ty.exhausted = true;
      var from = st.words.length;
      ty.session.append(more);
      renderWords(from);
    }
    if (st.wordIndex >= st.words.length) { finishExercise(); return; } // end of a prose text
    placeCaret();
    if (st.wordIndex !== before) trimAbove();
  }
  function onBack(t) {
    if (!ty || ty.stopped || ty.first == null) return;
    var before = ty.session.state().wordIndex;
    if (ty.session.input({ kind: 'back', t: t }) === false) { blocked(); return; }
    var now = ty.session.state().wordIndex;
    paintWord(now);
    if (now !== before) paintWord(before);
    placeCaret();
  }
  // Backspace at the start of a word after a correctly typed word does nothing;
  // say why, briefly, and nudge the caret.
  function blocked() {
    hint('Nothing to fix nearby: backspace only goes back to a recent mistake.');
    ty.hinted = true;
    ty.caret.classList.remove('nudge');
    void ty.caret.offsetWidth;
    ty.caret.classList.add('nudge');
  }
  function onBackWord(t) {
    if (!ty || ty.stopped || ty.first == null) return;
    var before = ty.session.state().wordIndex;
    if (!ty.session.current().typed.length) ty.session.input({ kind: 'back', t: t }); // step into a wrong previous word
    var w = ty.session.current();
    while (w.typed.length) ty.session.input({ kind: 'back', t: t });
    var now = ty.session.state().wordIndex;
    paintWord(now);
    if (now !== before) paintWord(before);
    placeCaret();
  }
  function onEscape() {
    if (!ty) return;
    if (ty.stopped) { show('home'); return; }
    if (ty.first == null) { show('home'); return; }
    ty.stopped = true;
    var bar = document.getElementById('stopbar');
    bar.hidden = false;
    bar.innerHTML = '<span>Stopped.</span><button class="btn primary" type="button" id="fin">Finish and save <kbd>Enter</kbd></button>' +
      '<button class="btn" type="button" id="dis">Discard <kbd>Esc</kbd></button>';
    document.getElementById('fin').onclick = finishExercise;
    document.getElementById('dis').onclick = function () { show('home'); };
    focusCapture();
  }
  function finishExercise() {
    if (!ty) return;
    var words = ty.session.state().words.filter(function (w) { return w.committed; });
    var info = { type: ty.type, startedAt: ty.startedAt, words: words, keys: ty.keys, opts: ty.opts,
      durationMs: words.length ? words[words.length - 1].tEnd - ty.first : 0,
      text: ty.ex.text || null, rounds: ty.burst ? ty.burst.rounds : null };
    stopTyping();
    document.body.classList.remove('typing-mode');
    if (words.length < 10 || (info.rounds && !info.rounds.length)) {
      app.notice = 'That exercise was too short to analyse (fewer than 10 words), so nothing was saved.';
      if (info.opts.programme && app.run) { viewBetween(); renderNotice(); app.notice = null; return; }
      go('home');
      app.notice = null;
      return;
    }
    viewEffort(info);
  }

  // ---------- effort ----------
  function viewEffort(info) {
    current = 'effort';
    renderNav();
    setView('<section class="effort"><h1>How much effort did that take?</h1>' +
      '<p class="muted">Your rating lets LessTypos compare speed at the same effort, and it holds vocabulary growth when typing feels demanding.</p>' +
      '<div class="scale">' + EFFORT.map(function (e) {
        return '<button type="button" data-effort="' + e[0] + '"><b>' + e[0] + '</b><span>' + esc(e[1]) + '</span><span class="muted">' + esc(e[2]) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="row"><button class="btn" type="button" data-effort="">Skip <kbd>Enter</kbd></button></div></section>');
    var done = false;
    function pick(v) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      info.effort = v;
      complete(info);
    }
    function onKey(e) {
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick(+e.key); }
      else if (e.key === 'Enter' || e.key === '0') { e.preventDefault(); pick(null); }
    }
    document.addEventListener('keydown', onKey, true);
    $view.querySelectorAll('[data-effort]').forEach(function (b) {
      b.onclick = function () { pick(b.dataset.effort ? +b.dataset.effort : null); };
    });
  }

  function complete(info) {
    var res = app.trainer.finish({ type: info.type, startedAt: info.startedAt, durationMs: info.durationMs,
      words: info.words, keys: info.keys, effort: info.effort, text: info.text, rounds: info.rounds });
    var saving = app.store.saveSession(res.raw).then(saveProfile);
    if (res.raw.text) {
      var t = info.opts.text;
      t.pos = res.raw.text.to;
      res.summary.textProgress = { title: t.title, pos: t.pos, total: t.words.length };
      saving = saving.then(function () { return app.store.saveText(t); });
    }
    saving.catch(storageError);
    if (info.opts.programme && app.run) {
      var m = res.summary.metrics;
      app.run.complete({ ms: res.summary.durationMs, wpm: m.wpm, faa: m.firstAttemptAccuracy, effort: info.effort,
        note: res.summary.rounds ? 'target ' + Math.round(app.trainer.bursts.target()) + ' WPM' : res.summary.textProgress ? proseProgress(res.summary.textProgress, res.summary.textProgress.pos) : '' });
      saveRun();
    }
    viewSummary(res.summary, info);
  }

  // ---------- summary ----------
  function viewSummary(s, info) {
    current = 'summary';
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
      if (s.timeline && s.timeline.length > 1) drawTimeline(document.getElementById('chart'), s.timeline);
      app.again = null;
      return;
    }
    app.progKeys = null;
    if (s.timeline && s.timeline.length > 1) drawTimeline(document.getElementById('chart'), s.timeline);
    document.getElementById('again').onclick = function () { startExercise(info.type, info.opts); };
    document.getElementById('seqs').onclick = function () { go('sequences'); };
    app.again = function () { startExercise(info.type, info.opts); };
  }

  // ---------- texts ----------
  function proseProgress(t, pos) {
    var total = t.words ? t.words.length : t.total;
    return pct(total ? pos / total : 0, 0) + ' (word ' + pos.toLocaleString() + ' of ' + total.toLocaleString() + ')';
  }
  function currentText() {
    return app.store.listTexts().then(function (list) {
      var t = list.filter(function (x) { return x.id === app.settings.currentText; })[0];
      return t || list.filter(function (x) { return x.pos < x.words.length; })[0] || null;
    });
  }
  function textForm() {
    return '<form class="stack" id="tform"><label for="ttitle">Title</label><input type="text" id="ttitle" placeholder="Moby-Dick, chapter 1">' +
      '<label for="tbody">Text</label><textarea id="tbody" class="mono" placeholder="Paste the text here"></textarea>' +
      '<div class="row"><input type="file" id="tfile" accept=".txt,text/plain"><button class="btn primary" type="submit" id="tsave">Add text</button></div><p class="muted" id="tmsg"></p></form>';
  }
  function bindTextForm(after) {
    var f = document.getElementById('tform');
    document.getElementById('tfile').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        document.getElementById('tbody').value = String(r.result);
        if (!document.getElementById('ttitle').value) document.getElementById('ttitle').value = file.name.replace(/\.txt$/i, '');
      };
      r.readAsText(file);
    };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var words = FT.text.prepare(document.getElementById('tbody').value), msg = document.getElementById('tmsg');
      if (words.length < 20) { msg.textContent = 'That text is too short: paste at least a paragraph.'; return; }
      var t = { id: 'x' + Date.now().toString(36), title: document.getElementById('ttitle').value.trim() || words.slice(0, 5).join(' '),
        words: words, pos: 0, addedAt: Date.now() };
      app.store.saveText(t).then(function () {
        app.settings.currentText = t.id;
        return saveSettings();
      }).then(function () { after(t); }).catch(storageError);
    });
  }
  function viewTexts() {
    app.store.listTexts().then(function (list) {
      var html = '<section class="stack"><h1>Texts</h1><p class="muted">Prose exercises continue the current text from where you stopped. Texts stay in this browser and are included in backups.</p></section>';
      if (list.length) {
        html += '<div class="tablewrap"><table><thead><tr><th>Title</th><th>Words</th><th>Progress</th><th></th></tr></thead><tbody>' +
          list.map(function (t) {
            var cur = t.id === app.settings.currentText;
            return '<tr><td>' + esc(t.title) + (cur ? ' ' + pill('current') : '') + '</td><td class="num">' + t.words.length.toLocaleString() + '</td><td class="num">' +
              proseProgress(t, t.pos) + '</td><td><div class="row">' +
              (cur ? '' : '<button class="btn" type="button" data-use="' + esc(t.id) + '">Make current</button>') +
              '<button class="btn" type="button" data-type="' + esc(t.id) + '">Type now</button>' +
              '<button class="btn danger" type="button" data-del="' + esc(t.id) + '">Delete</button></div></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      html += '<section class="panel stack"><h2>Add a text</h2>' + textForm() + '</section>';
      setView(html);
      bindTextForm(function () { viewTexts(); });
      $view.querySelectorAll('[data-use]').forEach(function (b) { b.onclick = function () { app.settings.currentText = b.dataset.use; saveSettings().then(viewTexts); }; });
      $view.querySelectorAll('[data-type]').forEach(function (b) {
        b.onclick = function () { app.store.getText(b.dataset.type).then(function (t) { startExercise('prose', { text: t }); }); };
      });
      $view.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to delete'; return; }
          app.store.deleteText(b.dataset.del).then(viewTexts);
        };
      });
    });
  }

  // ---------- timeline chart (one WPM axis; error marks are annotations) ----------
  function niceStep(range) {
    var raw = range / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }
  function monotonePath(pts) {
    var n = pts.length;
    if (!n) return '';
    if (n < 3) return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { var t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var out = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      var dx = (pts[i + 1][0] - pts[i][0]) / 3;
      out += 'C' + (pts[i][0] + dx).toFixed(1) + ' ' + (pts[i][1] + m[i] * dx).toFixed(1) + ' ' +
        (pts[i + 1][0] - dx).toFixed(1) + ' ' + (pts[i + 1][1] - m[i + 1] * dx).toFixed(1) + ' ' +
        pts[i + 1][0].toFixed(1) + ' ' + pts[i + 1][1].toFixed(1);
    }
    return out;
  }
  function drawTimeline(el, tl) {
    var W = Math.max(300, el.clientWidth || 600), H = 230, L = 44, R = 54, T = 22, B = 26;
    var bursts = tl.map(function (p) { return p.burst; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    var p98 = bursts[Math.floor(0.98 * (bursts.length - 1))] || 0;
    var top = Math.max(p98, Math.max.apply(null, tl.map(function (p) { return p.running || 0; }))) * 1.1 || 10;
    var step = niceStep(top), yMax = Math.ceil(top / step) * step;
    var n = tl.length;
    var x = function (i) { return L + (W - L - R) * (n === 1 ? 0.5 : (i - 1) / (n - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - Math.min(v, yMax) / yMax); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Words per minute for each word and as a running average across the exercise">';
    svg += '<g class="axis">';
    for (var v = 0; v <= yMax + 1e-9; v += step) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v) + '</text>';
    }
    var xs = niceStep(Math.max(n - 1, 1) * 0.8);
    xs = Math.max(1, Math.round(xs));
    for (var i = 1; i <= n; i += (i === 1 && xs > 1 ? xs - 1 : xs)) {
      svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + i + '</text>';
    }
    svg += '<text transform="translate(10 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">WPM</text></g>';
    // Per-word speed is lightly smoothed ([1 2 1] / 4 over neighbouring words);
    // the tooltip and table keep the raw values. Lines are monotone cubic
    // curves (Fritsch-Carlson), which never overshoot the data.
    var smooth = tl.map(function (p, k) {
      var a = tl[k - 1], c = tl[k + 1], sum = 2 * (p.burst || 0), w = 2;
      if (a && a.burst != null) { sum += a.burst; w++; }
      if (c && c.burst != null) { sum += c.burst; w++; }
      return p.burst == null ? null : sum / w;
    });
    var path = function (key) {
      var pts = tl.map(function (p, k) { var v = key === 'burst' ? smooth[k] : p[key]; return v == null ? null : [x(p.i), y(v)]; })
        .filter(Boolean);
      return monotonePath(pts);
    };
    svg += '<path class="burst" d="' + path('burst') + '"/>';
    svg += '<path class="run" d="' + path('running') + '"/>';
    tl.forEach(function (p) {
      if (!p.error) return;
      var cx = x(p.i), cy = T - 11;
      svg += '<path class="errmark" d="M' + (cx - 3) + ' ' + (cy - 3) + 'L' + (cx + 3) + ' ' + (cy + 3) + 'M' + (cx + 3) + ' ' + (cy - 3) + 'L' + (cx - 3) + ' ' + (cy + 3) + '"/>';
    });
    var last = tl[n - 1];
    if (last.running != null) svg += '<text class="endlabel" x="' + (x(n) + 8) + '" y="' + (y(last.running) + 4) + '">' + Math.round(last.running) + '</text>';
    svg += '<g id="hover" visibility="hidden"><line class="cross" id="cross" y1="' + T + '" y2="' + (H - B) + '"/>' +
      '<circle class="dot2" id="d2" r="4"/><circle class="dot1" id="d1" r="4"/></g>' +
      '<rect id="hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>';
    el.innerHTML = svg + '<div class="tip" id="tip" hidden></div>';
    var root = el.querySelector('svg'), hit = el.querySelector('#hit'), g = el.querySelector('#hover'), tip = el.querySelector('#tip');
    function at(evt) {
      var r = root.getBoundingClientRect(), sx = (evt.clientX - r.left) * (W / r.width);
      var i = Math.round(1 + (sx - L) / (W - L - R) * (n - 1));
      return tl[Math.min(n, Math.max(1, i)) - 1];
    }
    function showPoint(p) {
      var cx = x(p.i);
      el.querySelector('#cross').setAttribute('x1', cx); el.querySelector('#cross').setAttribute('x2', cx);
      var d1 = el.querySelector('#d1'), d2 = el.querySelector('#d2');
      d1.setAttribute('cx', cx); d1.setAttribute('cy', y(p.running || 0));
      d2.setAttribute('cx', cx); d2.setAttribute('cy', y(p.burst || 0));
      g.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = '<b>' + esc(p.word) + '</b> <span class="muted">word ' + p.i + '</span><br>' +
        fix(p.burst) + ' WPM this word · ' + fix(p.running) + ' average' + (p.error ? '<br><span style="color:var(--err)">× first-attempt error</span>' : '');
      var r = root.getBoundingClientRect(), px = cx * r.width / W;
      var left = px + 14, w = tip.offsetWidth;
      if (left + w > r.width) left = px - 14 - w;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = '24px';
    }
    hit.addEventListener('pointermove', function (e) { showPoint(at(e)); });
    hit.addEventListener('pointerleave', function () { g.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  // ---------- sequences ----------
  var seqTab = 'focus', seqSel = null;
  function viewSequences() {
    var t = app.trainer, ev = t.evaluate(), all = ev.all, ctxs = t.model.state().contexts;
    var pr = {};
    t.targets().forEach(function (x) { pr[x.key] = x.priority; });
    var keys = Object.keys(all);
    var counts = { insufficient: 0 };
    keys.forEach(function (k) { if (all[k].state === 'insufficient') counts.insufficient++; });
    var rows = keys.filter(function (k) {
      var c = all[k], st = ctxs[k].stage && ctxs[k].stage.name;
      if (seqTab === 'focus') return st === 'weak' || st === 'improving' || c.weak || c.hesitant || c.state === 'emerging';
      if (seqTab === 'kept') return st === 'consolidating' || st === 'mastered';
      return c.state !== 'insufficient' && c.state !== 'redundant';
    });
    rows.sort(function (a, b) {
      if (seqTab === 'focus') return (pr[b] || 0) - (pr[a] || 0) || all[b].latRel - all[a].latRel;
      return all[b].n - all[a].n;
    });
    var shown = rows.slice(0, 200);
    var html = '<section class="stack"><h1>Sequences</h1>' +
      '<p class="muted">Each sequence is the last one to four characters you typed, spaces included. It is flagged only when it is credibly worse than its shorter version in other words (for example ' + seq('str') + ' against ' + seq('tr') + '), so a single slip never flags anything.</p>' +
      '<div class="tabs" role="group">' +
      [['focus', 'In training'], ['kept', 'Consolidating and mastered'], ['all', 'All with enough evidence']].map(function (x) {
        return '<button type="button" data-tab="' + x[0] + '" aria-pressed="' + (seqTab === x[0]) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>' +
      '<p class="muted num">' + keys.length + ' sequences observed; ' + counts.insufficient + ' do not have enough observations yet.</p></section>';
    if (!shown.length) {
      html += '<p class="panel">' + (seqTab === 'focus' ? 'Nothing needs extra practice yet. Sequences appear here once the evidence shows they cost errors or time.' : 'No sequences in this group yet.') + '</p>';
    } else {
      html += '<div class="tablewrap"><table><thead><tr><th>Sequence</th><th>Status</th><th>Seen</th><th>Errors</th><th>Time vs shorter</th>' +
        (app.layout ? '<th>Movement</th>' : '') + '<th>Examples</th></tr></thead><tbody>' +
        shown.map(function (k) {
          var c = all[k], st = ctxs[k].stage;
          return '<tr class="clickable' + (seqSel === k ? ' selected' : '') + '" data-key="' + esc(k) + '"><td>' + seq(k) + '</td>' +
            '<td>' + pill(st ? st.name : c.state) + (st && st.regressed ? ' <span class="muted">returned</span>' : '') + '</td>' +
            '<td class="num">' + fix(c.n) + '</td>' +
            '<td class="num">' + pct(c.errorRate) + ' <span class="muted">vs ' + pct(c.parentErrorRate) + '</span></td>' +
            '<td class="num">×' + fix(c.latRel, 2) + '</td>' +
            (app.layout ? '<td>' + esc(movement(k)) + '</td>' : '') +
            '<td class="ex">' + esc(ctxs[k].ex.slice(-3).reverse().join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<section id="why"></section>';
    setView(html);
    $view.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { seqTab = b.dataset.tab; viewSequences(); }; });
    $view.querySelectorAll('tr[data-key]').forEach(function (r) { r.onclick = function () { seqSel = r.dataset.key; showWhy(seqSel); markSel(); }; });
    if (seqSel && all[seqSel]) showWhy(seqSel);
  }
  function markSel() { $view.querySelectorAll('tr[data-key]').forEach(function (r) { r.classList.toggle('selected', r.dataset.key === seqSel); }); }
  // Movement type of the last two or three key presses of a sequence, on the
  // declared layout. Across spaces only when the layout declares a space key.
  function movement(k) {
    var L = app.layout;
    if (!L) return '';
    var s = L.keys[' '] ? k : k.replace(/^.*\s/, '');
    var toks = FT.layout.presses(L, s);
    if (!toks || toks.length < 2 && !(toks.length === 1 && Array.from(toks[0]).length > 1)) return '';
    var c = FT.layout.classify(L, toks.slice(-3).join('')) || FT.layout.classify(L, toks.slice(-2).join(''));
    return c ? c.type + (c.tags.length ? ' (' + c.tags.join(', ') + ')' : '') : '';
  }
  function showWhy(k) {
    var x = app.trainer.explain(k), el = document.getElementById('why');
    if (!x || !el) return;
    var lines = [];
    var parent = x.parent ? seq(x.parent) : 'all your typing';
    lines.push(['Errors', pct(x.errorRate) + ' of first attempts, against ' + pct(x.parentErrorRate) + ' for ' + parent + ' elsewhere. ' +
      'Probability that it is genuinely worse: ' + pct(x.pWorse, 0) + '.']);
    lines.push(['Timing', 'Typed in ×' + fix(x.latency.relative, 2) + ' the time of ' + parent + ' elsewhere (' + fix(x.latency.n) + ' timed keystrokes). ' +
      'Probability that it is genuinely slower: ' + pct(x.latency.pSlower, 0) + '.']);
    lines.push(['Evidence', fix(x.n) + ' recency-weighted observations across ' + x.sessions + ' session record' + (x.sessions === 1 ? '' : 's') + '.']);
    if (x.state === 'emerging') {
      lines.push(['Confirmation', 'Seen in ' + x.sessionsWithDeficit + ' session so far; it needs ' + x.minSessions +
        ' separate sessions before it is trained, so one unusual session cannot fill the training list.']);
    } else if (x.state === 'weak' || x.state === 'hesitant') {
      lines.push(['Confirmation', 'Worse than ' + parent + ' in ' + x.sessionsWithDeficit + ' separate sessions.']);
    }
    lines.push(['Judgement', esc(x.state) + (x.redundant ? ': every occurrence also belongs to ' + parent + ', so it is judged there.' : '') +
      (x.explainedBy ? ': the difficulty is explained by ' + x.explainedBy.map(seq).join(', ') + '.' : '')]);
    if (x.stage) lines.push(['Training', pill(x.stage.name) + (x.stage.due ? ' next check from session ' + x.stage.due : '') + (x.stage.regressed ? ', returned after a failed check' : '')]);
    if (app.layout) { var mv = movement(k); if (mv) lines.push(['Movement', esc(mv)]); }
    lines.push(['Seen in', esc(x.examples.join(', '))]);
    el.className = 'panel stack';
    el.innerHTML = '<h2>Why ' + seq(k) + ' is ' + esc(x.state) + '</h2><dl class="why">' +
      lines.map(function (l) { return '<dt>' + l[0] + '</dt><dd>' + l[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="row"><button class="btn primary" type="button" id="practise">Practise ' + seq(k) + ' for 3 minutes</button></div>';
    document.getElementById('practise').onclick = function () { startExercise('targeted', { pinned: [k], minutes: 3 }); };
  }

  // ---------- errors ----------
  function viewErrors() {
    var rows = app.trainer.substitutions({ minOpp: 30 }).filter(function (r) { return r.count >= 2; }).slice(0, 40);
    var html = '<section class="stack"><h1>Recurring substitutions</h1>' +
      '<p class="muted">Which key comes out when another was intended. Rates are per opportunity to type the intended character and include errors you corrected. Rare pairs are shrunk toward the overall substitution rate, so a one-off does not top the list.</p></section>';
    if (!rows.length) html += '<p class="panel">No recurring substitutions yet.</p>';
    else {
      html += '<div class="tablewrap"><table><thead><tr><th>Intended</th><th>Typed</th><th>Rate</th><th>Times</th><th>Opportunities</th><th>Recent examples</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          return '<tr class="clickable" data-i="' + i + '"><td>' + seq(r.expected) + '</td><td>' + seq(r.actual) + '</td>' +
            '<td class="num">' + pct(r.rate, 2) + '</td><td class="num">' + fix(r.count) + '</td><td class="num">' + r.opportunities + '</td>' +
            '<td class="ex">' + esc(r.examples.slice(0, 3).map(function (e) { return e.context; }).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div><section id="subex"></section>';
    }
    setView(html);
    $view.querySelectorAll('tr[data-i]').forEach(function (tr) {
      tr.onclick = function () {
        var r = rows[+tr.dataset.i], el = document.getElementById('subex');
        el.className = 'panel stack';
        el.innerHTML = '<h2>' + seq(r.expected) + ' typed as ' + seq(r.actual) + '</h2><div class="tablewrap"><table><thead><tr><th>Word</th><th>Where</th><th>Corrected</th><th>Later letter</th><th>Exercise</th></tr></thead><tbody>' +
          r.examples.map(function (e) {
            return '<tr><td>' + esc(e.word) + '</td><td>' + seq(e.context) + '</td><td>' + (e.corrected ? 'yes' : 'no') + '</td><td>' + (e.premature ? 'yes' : '') + '</td><td>' + esc(e.exercise || '') + '</td></tr>';
          }).join('') + '</tbody></table></div><p class="muted">“Later letter” marks a typed letter that occurs later in the same word.</p>';
      };
    });
  }

  // ---------- history ----------
  function viewHistory() {
    var h = app.trainer.history().slice().reverse();
    var html = '<section class="stack"><h1>History</h1><p class="muted">Every exercise, newest first. “Random words” is the unbiased sample that targeted practice never influences.</p></section>';
    if (!h.length) html += '<p class="panel">No exercises yet.</p>';
    else html += '<div class="tablewrap"><table><thead><tr><th>When</th><th>Exercise</th><th>Min</th><th>WPM</th><th>Accuracy</th><th>Random words</th><th>Effort</th><th>Hesitation</th><th>Rhythm</th><th>Vocabulary</th></tr></thead><tbody>' +
      h.map(function (x) {
        var d = new Date(x.t);
        return '<tr><td class="num">' + esc(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</td>' +
          '<td>' + esc((EXERCISES[x.type] || { name: x.type }).name) + '</td><td class="num">' + fix(x.ms / 60000, 1) + '</td>' +
          '<td class="num">' + fix(x.wpm) + '</td><td class="num">' + pct(x.faa) + '</td><td class="num">' + pct(x.randomFaa) + '</td>' +
          '<td class="num">' + (x.effort || '–') + '</td><td class="num">' + pct(x.hes) + '</td><td class="num">' + fix(x.cv, 2) + '</td>' +
          '<td class="num">' + Math.round(x.frontier) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    setView(html);
  }

  // ---------- settings ----------
  function viewSettings() {
    var s = app.settings, d = app.trainer.difficulty.state();
    var html = '<section class="stack"><h1>Settings</h1></section><form class="form" id="sform">' +
      '<label for="durationMin">Exercise length</label><div><select id="durationMin">' +
      [1, 2, 3, 5, 7, 10].map(function (m) { return '<option value="' + m + '"' + (s.durationMin === m ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select></div>' +
      '<label for="errorMode">After a wrong key</label><div><select id="errorMode">' +
      '<option value="continue"' + (s.errorMode === 'continue' ? ' selected' : '') + '>Keep going (fix with backspace if you like)</option>' +
      '<option value="stop"' + (s.errorMode === 'stop' ? ' selected' : '') + '>Stop until it is corrected</option></select></div>' +
      '<label for="errorStyle">Error highlighting</label><div><select id="errorStyle">' +
      '<option value="clear"' + (s.errorStyle === 'clear' ? ' selected' : '') + '>Clear</option>' +
      '<option value="subtle"' + (s.errorStyle === 'subtle' ? ' selected' : '') + '>Subtle (colour only)</option></select></div>' +
      '<label for="showTimer">Remaining time</label><div><select id="showTimer"><option value="1"' + (s.showTimer ? ' selected' : '') + '>Show</option><option value="0"' + (!s.showTimer ? ' selected' : '') + '>Hide</option></select></div>' +
      '<label for="macros">Multi-letter keys</label><div><input type="text" id="macros" value="' + esc((s.macros || []).join(' ')) + '" placeholder="th qu">' +
      '<p class="help">Keys that type several letters at once, separated by spaces. They count fully towards speed and are timed as one movement. Keys in your layout below are included automatically.</p>' +
      '<p class="help" id="layoutMacros"></p>' +
      '<label class="row"><input type="checkbox" id="autoMacros"' + (s.autoMacros ? ' checked' : '') + '> Suggest pairs that always arrive almost simultaneously</label><div id="cands" class="help"></div></div>' +
      '<label for="frontier">Vocabulary</label><div class="row"><select id="vocabMode"><option value="auto"' + (!d.manual ? ' selected' : '') + '>Adapt automatically</option><option value="manual"' + (d.manual ? ' selected' : '') + '>Fixed</option></select>' +
      '<input type="number" id="frontier" min="100" max="' + app.trainer.corpus.size + '" step="50" value="' + Math.round(d.frontier) + '" style="max-width:8rem"' + (d.manual ? '' : ' disabled') + '> <span class="muted">most common words</span></div>' +
      '<label for="fontSize">Text size</label><div><input type="number" id="fontSize" min="1" max="3" step="0.1" value="' + s.fontSize + '" style="max-width:6rem"> <span class="muted">rem</span></div>' +
      '<label>Daily training</label><div class="stack" id="progedit"></div>' +
      '<label for="accents">Prose characters</label><div><label class="row"><input type="checkbox" id="accents"' + (s.accents !== false ? ' checked' : '') + '> Accept letters without accents (e for é)</label>' +
      '<p class="help">Curly quotes and long dashes always accept their plain keyboard versions.</p></div>' +
      '<label for="theme">Theme</label><div><select id="theme">' + ['system', 'light', 'dark'].map(function (v) { return '<option' + (s.theme === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></div>' +
      '<label for="layoutText">Keyboard layout (optional)</label><div><textarea id="layoutText" class="mono" placeholder="q w e r t   y u i o p&#10;a s d f g   h j k l ;&#10;z x c v b   n m , . /&#10;space&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;0 1 2 3 3   6 6 7 8 9&#10;5">' + esc(s.layoutText || '') + '</textarea>' +
      '<p class="help">Rows of keys, then the same rows again as finger numbers (0 = left pinky … 3 = left index, 4 = left thumb, 5 = right thumb, 6 = right index … 9 = right pinky). ' +
      'Write a key that types several letters as one token (<span class="seq">th</span>, <span class="seq">qu</span>) and the space bar as <span class="seq">space</span>. ' +
      'The layout is only used to describe sequences (same finger, rolls, scissors); training never depends on it. Multi-letter keys are added to the multi-letter keys above.</p><p class="help" id="layoutStatus"></p></div>' +
      '</form>';
    setView(html);
    function layoutStatus() {
      var el = document.getElementById('layoutStatus'), lm = document.getElementById('layoutMacros');
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
      else if (id === 'fontSize') s.fontSize = Math.min(3, Math.max(1, +v || 1.6));
      else if (id === 'theme') s.theme = v;
      else if (id === 'accents') s.accents = e.target.checked;
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
        '<input type="number" data-step="' + i + '" min="0.5" max="30" step="0.5" value="' + st.minutes + '" style="max-width:5rem" aria-label="Minutes"> <span class="muted">min</span>' +
        '<button class="btn" type="button" data-up="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button>' +
        '<button class="btn" type="button" data-down="' + i + '"' + (i < def.steps.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button></div>';
    }).join('') + '<p class="help">' + FT.programme.totalMinutes(def) + ' minutes in total. <button class="btn" type="button" id="progreset">Restore default</button></p>';
    function move(i, d) {
      var def2 = JSON.parse(JSON.stringify(programmeDef())), x = def2.steps.splice(i, 1)[0];
      def2.steps.splice(i + d, 0, x); app.settings.programme = def2; saveSettings(); renderProgEdit();
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
    var html = '<section class="stack"><h1>Your data</h1>' +
      '<p class="muted">Everything stays in this browser' + (app.storageOk ? ' (IndexedDB)' : '') + '. Nothing is sent anywhere. Raw keystroke records are kept so statistics can be rebuilt when the method improves.</p>' +
      (app.storageOk ? '' : '<p class="notice">This browser does not allow storage for this page, so progress is lost when you close it. Export before leaving.</p>') +
      '<p class="muted num" id="usage"></p></section>' +
      '<section class="panel stack"><h2>Export</h2><p>Save a complete backup: settings, statistics and every raw exercise.</p>' +
      '<div class="row"><button class="btn primary" type="button" id="exp">Download backup</button><button class="btn" type="button" id="copy">Copy backup to clipboard</button></div>' +
      '<p class="muted" id="expmsg"></p></section>' +
      '<section class="panel stack"><h2>Import</h2><p>Restore a backup. Replacing removes the current data first; merging adds exercises that are not already here and then rebuilds the statistics.</p>' +
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
        if (el && e.usage != null) el.textContent = 'Using ' + (e.usage / 1048576).toFixed(1) + ' MB of storage.';
      }).catch(function () {});
    }
    function backup() { return app.store.exportAll().then(function (d) { return JSON.stringify(d); }); }
    document.getElementById('exp').onclick = function () {
      backup().then(function (json) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'lesstypos-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        document.getElementById('expmsg').textContent = 'Backup prepared (' + (json.length / 1024).toFixed(0) + ' KB). If no download started, use “Copy backup to clipboard”.';
      });
    };
    document.getElementById('copy').onclick = function () {
      var msg = document.getElementById('expmsg');
      backup().then(function (json) {
        return navigator.clipboard.writeText(json).then(function () { msg.textContent = 'Backup copied to the clipboard.'; });
      }).catch(function () {
        backup().then(function (json) {
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
      reloadFromStore(true).then(function () { document.getElementById('resetmsg').textContent = 'Statistics rebuilt from ' + app.trainer.history().length + ' exercises.'; });
    };
    $view.querySelectorAll('[data-reset]').forEach(function (b) {
      b.onclick = function () {
        if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to confirm'; return; }
        var what = b.dataset.reset;
        app.store.reset(what).then(function () {
          if (what === 'settings' || what === 'all') { app.settings = Object.assign({}, DEFAULT_SETTINGS); applySettings(); }
          return reloadFromStore(false);
        }).then(function () { viewData(); document.getElementById('resetmsg').textContent = 'Done.'; });
      };
    });
  }
  function reloadFromStore(rebuild) {
    return app.store.load().then(function (d) {
      app.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
      applySettings();
      return app.store.listSessions().then(function (sessions) {
        app.trainer = makeTrainer(rebuild ? null : d.profile, sessions);
        return saveProfile();
      });
    });
  }

  // ---------- global keys ----------
  function onGlobalKey(e) {
    if (current === 'typing' || current === 'effort') return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (current === 'summary' && app.progKeys) {
      var k = { Enter: 'next', n: 'skip', r: 'repeat', Escape: 'end' }[e.key];
      if (k && !(k === 'next' && /BUTTON|A/.test(tag))) {
        if (k === 'skip' && !document.getElementById('pskip')) return;
        e.preventDefault(); var f = app.progKeys[k]; app.progKeys = null; f(); return;
      }
    }
    if (e.key === 'Enter' && (current === 'home' || current === 'summary') && !/BUTTON|A/.test(tag)) {
      e.preventDefault();
      if (current === 'summary' && app.again) app.again();
      else if (current === 'summary' && document.getElementById('home')) go('home');
      else if (current === 'home' && app.homeEnter) app.homeEnter();
      else startExercise('relaxed');
      return;
    }
    var n = NAV.filter(function (x) { return x[2] === e.key; })[0];
    if (n) { e.preventDefault(); go(n[0]); }
  }

  // ---------- boot ----------
  function boot() {
    $view = document.getElementById('view');
    $nav = document.getElementById('nav');
    document.addEventListener('keydown', onGlobalKey);
    $nav.addEventListener('click', function (e) { var b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (h !== current && ROUTES.indexOf(h) >= 0) show(h); });
    var adapter;
    var ready = Promise.resolve().then(function () {
      adapter = FT.store.idbAdapter('lesstypos');
      return adapter.keys();
    }).catch(function () { adapter = FT.store.memoryAdapter(); app.storageOk = false; })
      .then(function () {
        app.store = FT.store.create({ adapter: adapter });
        return app.store.load();
      }).then(function (d) {
        app.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
        applySettings();
        var rebuild = !d.profile || FT.trainer.needsRebuild(d.profile);
        return (rebuild ? app.store.listSessions() : Promise.resolve([])).then(function (sessions) {
          app.trainer = makeTrainer(rebuild ? null : d.profile, sessions);
          if (rebuild && sessions.length) return saveProfile();
        });
      }).then(function () {
        if (!app.storageOk) app.notice = 'This browser does not allow storage for this page, so progress will be lost when you close it. Use Data → Export to keep it.';
        var h = location.hash.slice(1);
        show(ROUTES.indexOf(h) >= 0 ? h : 'home');
      }).catch(function (e) {
        $view.innerHTML = '<p class="notice">LessTypos could not start: ' + esc(e && e.message || e) + '</p>';
      });
    FT.app = app;
    FT.ready = ready;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis.FT);
