// Typing screen: input, rendering, caret and line scrolling, timers, speed-burst rounds.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EXERCISES = U.EXERCISES;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix;
  // defined in other ui files
  function go() { return U.go.apply(null, arguments); }
  function proseProgress() { return U.proseProgress.apply(null, arguments); }
  function renderNav() { return U.renderNav.apply(null, arguments); }
  function renderNotice() { return U.renderNotice.apply(null, arguments); }
  function setView() { return U.setView.apply(null, arguments); }
  function show() { return U.show.apply(null, arguments); }
  function viewBetween() { return U.viewBetween.apply(null, arguments); }
  function complete() { return U.complete.apply(null, arguments); }
  function macros() { return U.macros.apply(null, arguments); }
  function viewEffort() { return U.viewEffort.apply(null, arguments); }

  // ---------- typing ----------
  var BURST_RUN = U.BURST_RUN, BURST_REST = U.BURST_REST;
  function burstRun() { return app.burstRun || BURST_RUN; }   // overridable for tests
  function burstRest() { return app.burstRest || BURST_REST; }
  var ty = null; // active typing state
  function stopTyping() {
    if (ty) { clearInterval(ty.timer); if (ty.detach) ty.detach(); ty = null; }
  }
  function startExercise(type, opts) {
    stopTyping();
    opts = opts || {};
    app.current = 'typing';
    document.body.classList.add('typing-mode');
    renderNav();
    var exDef = EXERCISES[type];
    var ex = app.trainer.newExercise({ type: type, pinned: opts.pinned, text: opts.text, run: opts.run });
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
  // A word shows the best alignment of what was typed with its target
  // (FT.align.displayWord): extra letters at their place, and one joined mark
  // for a wrong multi-letter press. data-cursor = letters typed so far.
  function paintWord(i, el) {
    var w = ty.session.state().words[i];
    el = el || ty.els[i];
    if (!el) return;
    var d = FT.align.displayWord(w.target, w.typed, w.stream, macros(), w.committed);
    var T = Array.from(w.target), html = '';
    var letter = function (cls, ch) { return '<span class="l' + cls + '">' + esc(ch) + '</span>'; };
    var extrasBefore = function (p) { return d.extras.filter(function (x) { return x.before === p; }); };
    for (var p = 0; p <= T.length; p++) {
      extrasBefore(p).forEach(function (x) { html += letter(' extra', x.ch); });
      if (p === T.length) break;
      var pos = d.positions[p];
      if (pos.press) {
        var q = p;
        while (q + 1 < T.length && d.positions[q + 1].press && d.positions[q + 1].group === pos.group && !extrasBefore(q + 1).length) q++;
        html += '<span class="press-bad">' + T.slice(p, q + 1).map(function (ch) { return letter(' bad', ch); }).join('') + '</span>';
        p = q;
        continue;
      }
      html += letter(pos.status === 'ok' ? ' ok' : pos.status === 'bad' ? ' bad' : '', T[p]);
    }
    el.innerHTML = html;
    el.dataset.cursor = d.cursor;
  }
  // Caret and line scrolling from on-screen rectangles, relative to the typing
  // window (independent of offsetParent quirks and of the host page's CSS).
  function placeCaret() {
    var st = ty.session.state(), i = st.wordIndex, el = ty.els[i];
    if (!el || !el.isConnected) return;
    var typed = +el.dataset.cursor || 0, letters = el.querySelectorAll('.l');
    var win = ty.win.getBoundingClientRect(), inner = ty.inner.getBoundingClientRect();
    var r, x;
    if (typed < letters.length) { r = letters[typed].getBoundingClientRect(); x = r.left; }
    else if (letters.length) { r = letters[letters.length - 1].getBoundingClientRect(); x = r.right; }
    else { r = el.getBoundingClientRect(); x = r.left; }
    var lineH = el.getBoundingClientRect().height || r.height;
    var yInInner = r.top - inner.top;                       // unaffected by the app.current scroll offset
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
      hint('Round ' + b.rounds.length + ': ' + fix(l.stats.wpm) + ' WPM, ' + pct(l.stats.accuracy, 0) + ' accuracy (' +
        (l.res.result === 'met' ? 'target met' : esc(l.res.reason)) + '). Target now ' + Math.round(b.target) +
        ' WPM. Relax your hands; next round in ' + Math.ceil(left / 1000) + ' s.');
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
    // the last word of a text needs no space: complete it once typed correctly
    var cur = st.words[st.wordIndex];
    if (ty.exhausted && st.wordIndex === st.words.length - 1 && FT.text.sameStr(cur.typed, cur.target)) {
      ty.session.input({ kind: 'text', data: ' ', t: t, auto: true });
      st = ty.session.state();
    }
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
  function resting() { return ty.burst && ty.burst.phase === 'rest'; }
  function onBack(t) {
    if (!ty || ty.stopped || ty.first == null || resting()) return;
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
    if (!ty || ty.stopped || ty.first == null || resting()) return;
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
    var textDone = ty.exhausted && ty.session.state().wordIndex >= ty.session.state().words.length;
    app.typingEndedAt = Date.now(); // keys still in flight must not trigger page shortcuts
    stopTyping();
    document.body.classList.remove('typing-mode');
    if ((words.length < 10 && !textDone) || (info.rounds && !info.rounds.length)) {
      app.notice = 'That exercise was too short to analyse (fewer than 10 words), so nothing was saved.';
      if (info.opts.programme && app.run) { viewBetween(); renderNotice(); app.notice = null; return; }
      go('home');
      app.notice = null;
      return;
    }
    if (info.opts.bench) complete(info); else viewEffort(info);
  }

  Object.assign(U, { stopTyping: stopTyping, startExercise: startExercise, focusCapture: focusCapture, hint: hint, clock: clock, renderWords: renderWords, paintWord: paintWord, placeCaret: placeCaret, trimAbove: trimAbove, beginIfNeeded: beginIfNeeded, tick: tick, burstTick: burstTick, paintPace: paintPace, correctSoFar: correctSoFar, onText: onText, onBack: onBack, blocked: blocked, onBackWord: onBackWord, onEscape: onEscape, finishExercise: finishExercise });
})(globalThis.FT);
