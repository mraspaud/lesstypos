// Typing screen: one instance per exercise, with its input, rendering, caret
// and line scrolling, timers and speed-burst rounds. What it records is built
// in record.js.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix;
  var WORDS_SHOWN = 120, WORDS_ADDED = 100;   // the DOM holds a window of the exercise's words
  var WORDS_LEFT_BEFORE_MORE = 60;            // more words are added when fewer are left
  var TICK_MS = 200, TAB_AGAIN_MS = 3000;
  var EFFORT_GUARD_MS = 1000;                 // keys ignored by the effort question once the timer ends
  var PACE_SCALE = 1.5;                       // the pace bar runs to 1.5 × the target
  var SPACE_MARK = '␣';
  var START_HINT = 'Start typing when ready. <kbd>Esc</kbd> pauses, <kbd>Tab</kbd> restarts.';

  function burstRoundMs() { return U.testing.burstRoundMs || FT.exercises.BURST_ROUND_MS; }
  function burstRestMs() { return U.testing.burstRestMs || FT.exercises.BURST_REST_MS; }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function proseChapter(text) {
    var c = FT.books.chapterAt(text, text.pos);
    return c ? ' · ' + esc(c.title) : '';
  }
  // The card over the text: what to do and what counts, read before starting.
  function briefingCard(exDef, nRounds, type) {
    return '<div class="briefing" id="briefing" role="dialog" aria-labelledby="briefing-title">' +
      '<h2 id="briefing-title">' + esc(exDef.name) + (type === 'bursts' ? ' · ' + nRounds + ' rounds' : '') + '</h2>' +
      '<p>' + esc(exDef.goal) + '</p><p class="muted">' + esc(exDef.counts) + '</p>' +
      '<p><kbd>Enter</kbd> start · <kbd>Esc</kbd> leave · <kbd>Tab</kbd> restart</p></div>';
  }

  // The typing screen's markup: the exercise's heading, the burst pace bar,
  // the window of words, the card, the hint, the pause bar and the input.
  function typingPage(type, opts, exDef, view) {
    return '<section class="typing">' +
      '<div class="ex-head"><span class="name">' + esc(exDef.name) + (opts.pinned ? ' ' + opts.pinned.map(seq).join(' ') : '') + '</span>' +
      '<span>' + esc(exDef.goal) + '</span>' +
      (type === 'prose' ? '<span class="muted">' + esc(opts.text.title) + proseChapter(opts.text) + ', ' + FT.fmt.textProgress(opts.text, opts.text.pos) + '</span>' : '') +
      '<span class="timer num" id="timer"' + (app.settings.showTimer || type === 'bursts' || view.free ? '' : ' hidden') + '>' +
        (type === 'bursts' ? 'Round 1 of ' + view.rounds : clock(view.free ? 0 : view.durationMs)) + '</span></div>' +
      (type === 'bursts' ? '<div class="pace" id="pace" aria-hidden="true"><div class="pace-fill" id="pacefill"></div><div class="pace-target" id="pacetarget"></div></div>' +
        '<div class="pace-label muted num" id="pacelabel">Target ' + Math.round(app.trainer.bursts.target()) + ' WPM</div>' : '') +
      '<div class="stage"><div class="window' + (app.settings.errorStyle === 'subtle' ? ' subtle' : '') + '" id="window"><div class="inner" id="inner"></div><div class="caret" id="caret"></div></div>' +
      (view.briefing ? briefingCard(exDef, view.rounds, type) : '') + '</div>' +
      '<div class="focus-hint" id="hint">' + (view.briefing ? '' : START_HINT) + '</div>' +
      '<div id="stopbar" class="stopbar" hidden></div>' +
      '<textarea id="capture" class="capture" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Typing input"' + (view.briefing ? ' aria-describedby="briefing"' : '') + '></textarea>' +
      '</section>';
  }

  function startExercise(type, opts) {
    var typing = typingScreen(type, opts || {});
    U.screen('typing', {
      render: typing.render,
      onLeave: typing.stop,
      holdOnNavigation: typing.holdForLeave,
      onKey: function (e) { if (e.target && e.target.id !== 'capture') typing.keyElsewhere(e); },
    });
  }

  function typingScreen(type, opts) {
    var live = false;   // between render and stop
    var ex, session, pending, durationMs, keys = [], startKey = null, firstKeyAt = null, startedAt = null, clockStart = null;
    var els = [], inner, caret, win, capture, offset = 0, timer = null, detachInput = null;
    var paused = false, pausedAt = null, pauses = [], briefing, free, burst = null;
    var overtime = false, hinted = false, exhausted = false, tabArmedAt = 0;

    function render() {
      live = true;
      ex = app.trainer.newExercise({ type: type, pinned: opts.pinned, text: opts.text, run: opts.run });
      durationMs = (opts.minutes || app.settings.durationMin) * 60000;
      var rounds = Math.max(1, Math.floor(durationMs / (2 * burstRoundMs())));
      briefing = app.settings.showInstructions !== false;
      free = type === 'prose' && !!opts.free;   // free reading: no time limit, the clock counts up
      U.paint(typingPage(type, opts, FT.exercises.instructions(type, app.settings), { rounds: rounds, durationMs: durationMs, briefing: briefing, free: free }));
      session = FT.session.create(ex.words.slice(0, WORDS_SHOWN), { equivalence: U.equivalence(), macros: U.macros(),
        stopOnError: app.settings.errorMode === 'stop' });
      pending = ex.words.slice(WORDS_SHOWN);
      inner = document.getElementById('inner'); caret = document.getElementById('caret');
      win = document.getElementById('window'); capture = document.getElementById('capture');
      if (type === 'bursts') burst = { total: rounds, rounds: [], phase: 'ready', target: app.trainer.bursts.target(), ref: app.trainer.bursts.reference() };
      renderWords(0);
      listen();
      focusCapture();
      placeCaret();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeCaret);
    }
    // The input, the clicks that bring the focus back, and the page's resize
    // and unload, until stop().
    function listen() {
      detachInput = FT.input.attach(capture, {
        onText: onText, onBack: onBack, onBackWord: onBackWord,
        onKey: function (k) {
          if (!live || paused) return;
          if (firstKeyAt != null) keys.push(k);
          else if (k.k === 'd') startKey = k; // the keydown that will start the exercise comes before its letter
        },
        onEscape: onEscape, onTab: onTab,
        onEnter: function (t) {
          if (!live) return;
          if (briefing) closeBriefing();
          else if (paused) finish();
          else onText(FT.session.PARAGRAPH, t);   // the end of a paragraph
        },
        onDelete: function () { if (live && paused) discard(); },
      });
      win.addEventListener('click', focusCapture);
      if (briefing) document.getElementById('briefing').addEventListener('click', focusCapture);
      capture.addEventListener('blur', function () { if (live) { win.classList.add('blurred'); hint('Click here or press any key to continue typing.'); } });
      capture.addEventListener('focus', function () { if (live) { win.classList.remove('blurred'); hint(firstKeyAt == null && !briefing ? START_HINT : ''); } });
      window.addEventListener('resize', placeCaret);
      window.addEventListener('beforeunload', askBeforeUnload);
    }
    function stop() {
      if (!live) return;
      live = false;
      clearInterval(timer);
      if (detachInput) detachInput();
      window.removeEventListener('resize', placeCaret);
      window.removeEventListener('beforeunload', askBeforeUnload);
    }
    // Reloading or closing the tab mid-exercise asks first (nothing is dropped without asking).
    function askBeforeUnload(e) { if (firstKeyAt != null) { e.preventDefault(); e.returnValue = ''; } }
    function focusCapture() { if (live) capture.focus({ preventScroll: true }); }
    function hint(html) { var el = document.getElementById('hint'); if (el) el.innerHTML = html; }

    // ---------- words, caret and lines ----------
    function renderWords(from) {
      var words = session.state().words;
      var frag = document.createDocumentFragment();
      for (var i = from; i < words.length; i++) {
        var el = document.createElement('span');
        el.className = 'w';
        els[i] = el;
        paintWord(i, el);
        frag.appendChild(el);
        if (FT.session.separatorOf(words[i]) === FT.session.PARAGRAPH) frag.appendChild(document.createElement('br'));
      }
      inner.appendChild(frag);
    }
    // A word shows its typed presses compared by position (FT.align.displayWord):
    // one joined mark for a wrong multi-letter press, extra letters at the end.
    // data-cursor = letters typed so far.
    function paintWord(i, el) {
      var w = session.state().words[i];
      el = el || els[i];
      if (!el) return;
      var shown = FT.align.displayWord(w.target, w.stream, Object.assign({ committed: w.committed }, U.analysisOptions()));
      var target = Array.from(w.target), html = '';
      var letter = function (cls, ch) { return '<span class="l' + cls + '">' + esc(ch) + '</span>'; };
      for (var p = 0; p < target.length; p++) {
        var pos = shown.positions[p];
        if (pos.press) {
          var q = p;
          while (q + 1 < target.length && shown.positions[q + 1].press && shown.positions[q + 1].group === pos.group) q++;
          html += '<span class="press-bad">' + target.slice(p, q + 1).map(function (ch) { return letter(' bad', ch); }).join('') + '</span>';
          p = q;
          continue;
        }
        html += letter(pos.status === 'ok' ? ' ok' : pos.status === 'bad' ? ' bad' : '', target[p]);
      }
      shown.extras.forEach(function (ch) { html += letter(' extra', ch); });
      html += separatorMark(w, letter);
      el.innerHTML = html;
      el.dataset.cursor = shown.cursor;
    }
    // A paragraph end always shows its mark; a space shows one only when the
    // word was ended by Enter instead.
    function separatorMark(w, letter) {
      var status = FT.session.separatorStatus(w), paragraph = FT.session.separatorOf(w) === FT.session.PARAGRAPH;
      if (paragraph) return letter(' sep' + (status ? ' ' + status : ''), '¶');
      return status === 'bad' ? letter(' sep bad', SPACE_MARK) : '';
    }
    // Caret and line scrolling from on-screen rectangles, relative to the typing
    // window (independent of offsetParent quirks and of the host page's CSS).
    function placeCaret() {
      if (!live) return;
      var st = session.state(), el = els[st.wordIndex];
      if (!el || !el.isConnected) return;
      var typed = +el.dataset.cursor || 0, letters = el.querySelectorAll('.l');
      var winBox = win.getBoundingClientRect(), innerBox = inner.getBoundingClientRect();
      var r, x;
      if (typed < letters.length) { r = letters[typed].getBoundingClientRect(); x = r.left; }
      else if (letters.length) { r = letters[letters.length - 1].getBoundingClientRect(); x = r.right; }
      else { r = el.getBoundingClientRect(); x = r.left; }
      var lineH = el.getBoundingClientRect().height || r.height;
      var yInInner = r.top - innerBox.top;                       // unaffected by the current scroll offset
      var line = Math.round((el.getBoundingClientRect().top - innerBox.top) / lineH);
      var lineOffset = Math.max(0, line - 1) * lineH;
      if (lineOffset !== offset) {
        offset = lineOffset;
        inner.style.transform = 'translateY(' + (-offset) + 'px)';
      }
      caret.style.left = (x - winBox.left) + 'px';
      caret.style.top = (yInInner - offset + (r.height - caret.offsetHeight) / 2) + 'px';
    }
    // Drops committed words more than one line above the view to keep the DOM small.
    // Measures everything first: removing a word reflows the following ones.
    function trimAbove() {
      var st = session.state(), cur = els[st.wordIndex];
      if (!cur) return;
      var lh = cur.getBoundingClientRect().height, top = inner.getBoundingClientRect().top, drop = [];
      for (var i = 0; i < st.wordIndex; i++) {
        var el = els[i];
        if (!el || !el.parentNode) continue;
        if (el.getBoundingClientRect().top - top + lh <= offset - lh) drop.push(el); else break;
      }
      drop.forEach(function (el) {
        if (el.nextSibling && el.nextSibling.nodeName === 'BR') el.parentNode.removeChild(el.nextSibling);
        el.parentNode.removeChild(el);
      });
      if (drop.length) { offset = -1; placeCaret(); }
    }

    // ---------- clock ----------
    function startClock(t) {
      firstKeyAt = t; startedAt = Date.now(); clockStart = performance.now();
      if (startKey) keys.push(startKey);
      timer = setInterval(tick, TICK_MS);
    }
    function beginIfNeeded(t) {
      if (burst && burst.phase === 'ready') {
        burst.phase = 'run'; burst.start = t; burst.startNow = performance.now();
        if (firstKeyAt == null) startClock(t);
        hint('');
        return;
      }
      if (firstKeyAt != null) return;
      startClock(t);
      hint('');
    }
    function tick() {
      if (!live || paused) return;
      if (burst) { burstTick(); return; }
      var elapsed = performance.now() - clockStart, el = document.getElementById('timer');
      if (free) { if (el) el.textContent = clock(Math.floor(elapsed / 1000) * 1000); return; }
      var left = durationMs - elapsed;
      if (el) el.textContent = clock(left);
      if (left > 0 || overtime) return;
      if (type !== 'prose' || atSentenceEnd()) { finish(); return; }
      overtime = true;   // prose: time is up, but the sentence is finished first (user decision)
      hint('Time is up: finish the sentence.');
    }
    // At the start of a word that follows the end of a sentence or paragraph.
    function atSentenceEnd() {
      var st = session.state(), prev = st.words[st.wordIndex - 1], cur = st.words[st.wordIndex];
      if (!prev || (cur && cur.typed.length)) return false;
      return FT.text.endsSentence(prev.target) || FT.session.separatorOf(prev) === FT.session.PARAGRAPH;
    }

    // ---------- speed bursts ----------
    // Rounds of BURST_ROUND_MS, each started by the first keystroke after a
    // BURST_REST_MS rest. A live pace bar compares the round's speed with the
    // adaptive target (FT.bursts).
    // Closes the current round at `end` (keystroke clock); returns true when
    // that finished the exercise. keepOpen: at a pause, the last round does
    // not end the exercise yet.
    function endRound(end, now, keepOpen) {
      now = now == null ? performance.now() : now;
      burst.rounds.push({ start: burst.start, end: end });
      var full = roundStats(burst.start, end);
      var res = FT.bursts.step(burst.target, full, burst.ref);
      burst.last = { stats: full, res: res };
      burst.target = res.after;
      if (burst.rounds.length >= burst.total) {
        if (keepOpen) { burst.phase = 'done'; return false; }
        finish(); return true;
      }
      burst.phase = 'rest'; burst.restEnd = now + burstRestMs();
      return false;
    }
    function roundStats(start, end) {
      var words = session.state().words.filter(function (w) { return w.committed && FT.bursts.finishedWithin(w, start, end); });
      return FT.bursts.roundStats(words, FT.align.analyzeWords(words, U.analysisOptions()), start, end);
    }
    function burstTick() {
      var now = performance.now(), timerEl = document.getElementById('timer');
      if (burst.phase === 'run') {
        var elapsed = now - burst.startNow, end = burst.start + burstRoundMs();
        var st = roundStats(burst.start, burst.start + Math.min(elapsed, burstRoundMs()));
        paintPace(st.wpm, burst.target);
        timerEl.textContent = 'Round ' + (burst.rounds.length + 1) + ' of ' + burst.total + ' · ' + clock(burstRoundMs() - elapsed);
        if (elapsed >= burstRoundMs()) endRound(end, now);
      } else if (burst.phase === 'rest') {
        var left = burst.restEnd - now, last = burst.last;
        timerEl.textContent = 'Rest · ' + clock(left);
        hint('Round ' + burst.rounds.length + ': ' + fix(last.stats.wpm) + ' WPM, ' + pct(last.stats.accuracy, 0) + ' accuracy (' +
          (last.res.result === 'met' ? 'target met' : esc(last.res.reason)) + '). Target now ' + Math.round(burst.target) +
          ' WPM. Relax your hands; next round in ' + Math.ceil(left / 1000) + ' s.');
        paintPace(null, burst.target);
        if (left <= 0) {
          burst.phase = 'ready';
          hint('Round ' + (burst.rounds.length + 1) + ' of ' + burst.total + ': start typing when ready.');
          timerEl.textContent = 'Round ' + (burst.rounds.length + 1) + ' of ' + burst.total;
        }
      }
    }
    function paintPace(wpm, target) {
      var max = target * PACE_SCALE, fill = document.getElementById('pacefill'), mark = document.getElementById('pacetarget');
      if (!fill) return;
      fill.style.width = Math.min(100, ((wpm || 0) / max) * 100) + '%';
      fill.classList.toggle('over', wpm != null && wpm >= target);
      mark.style.left = (100 / PACE_SCALE) + '%';
      document.getElementById('pacelabel').textContent = (wpm != null ? fix(wpm) + ' WPM · ' : '') + 'target ' + Math.round(target) + ' WPM';
    }
    function resting() { return burst && burst.phase === 'rest'; }

    // ---------- input ----------
    function closeBriefing() {
      briefing = false;
      var el = document.getElementById('briefing');
      if (el) el.remove();
      capture.removeAttribute('aria-describedby');
      hint(START_HINT);
      focusCapture();
    }
    function onText(data, t) {
      if (!live) return;
      if (briefing) return; // read the card first: Enter starts
      if (paused) { hint('Paused: <kbd>Esc</kbd> resumes, <kbd>Enter</kbd> saves, <kbd>Del</kbd> discards.'); return; } // typing never discards
      if (resting()) return;
      beginIfNeeded(t);
      if (hinted) { hint(''); hinted = false; }
      var before = session.state().wordIndex;
      session.input({ kind: 'text', data: data, t: t });
      var st = session.state();
      // the last word of a text needs no space: complete it once typed correctly
      var cur = st.words[st.wordIndex];
      if (exhausted && st.wordIndex === st.words.length - 1 && U.equivalence().sameStr(cur.typed, cur.target)) {
        session.input({ kind: 'text', data: ' ', t: t, auto: true });
        st = session.state();
      }
      for (var i = before; i <= Math.min(st.wordIndex, st.words.length - 1); i++) paintWord(i);
      if (st.words.length - st.wordIndex < WORDS_LEFT_BEFORE_MORE && !exhausted) {
        var more = nextWords(WORDS_ADDED);
        if (!more.length) exhausted = true;
        var from = st.words.length;
        session.append(more);
        renderWords(from);
      }
      if (st.wordIndex >= st.words.length) { finish(); return; } // end of a prose text
      if (overtime && st.wordIndex !== before && atSentenceEnd()) { finish(); return; }
      placeCaret();
      if (st.wordIndex !== before) trimAbove();
    }
    // The prepared words in order, then more from the exercise: a book must not skip.
    function nextWords(n) {
      var out = pending.splice(0, n);
      return out.length ? out : ex.more(n);
    }
    function onBack(t) {
      if (!live || paused || firstKeyAt == null || resting()) return;
      var before = session.state().wordIndex;
      if (session.input({ kind: 'back', t: t }) === false) { blocked(); return; }
      repaintAround(before);
    }
    function onBackWord(t) {
      if (!live || paused || firstKeyAt == null || resting()) return;
      var before = session.state().wordIndex;
      if (!session.current().typed.length) session.input({ kind: 'back', t: t }); // step into a wrong previous word
      var w = session.current();
      while (w.typed.length) session.input({ kind: 'back', t: t });
      repaintAround(before);
    }
    function repaintAround(before) {
      var now = session.state().wordIndex;
      paintWord(now);
      if (now !== before) paintWord(before);
      placeCaret();
    }
    // Backspace at the start of a word after a correctly typed word does nothing;
    // say why, briefly, and nudge the caret.
    function blocked() {
      hint('Nothing to fix nearby: backspace only goes back to a recent mistake.');
      hinted = true;
      caret.classList.remove('nudge');
      void caret.offsetWidth;
      caret.classList.add('nudge');
    }

    // ---------- pause, leave, restart ----------
    // Esc never loses work: before typing it leaves, then it pauses and resumes.
    // Discarding is its own key (Delete).
    function onEscape() {
      if (!live) return;
      if (firstKeyAt == null) { U.show('home'); return; }
      if (paused) { resume(); return; }
      pause();
    }
    function pause() {
      paused = true;
      pausedAt = performance.now();
      // a burst round in progress ends at the pause (its window never holds a pause)
      if (burst && burst.phase === 'run') endRound(pausedAt, null, true);
      var bar = document.getElementById('stopbar');
      bar.hidden = false;
      U.fill(bar, '<span>Paused.</span><button class="btn primary" type="button" id="fin"' + U.action(finish) + '>Finish and save <kbd>Enter</kbd></button>' +
        '<button class="btn" type="button" id="res"' + U.action(resume) + '>Resume <kbd>Esc</kbd></button>' +
        '<button class="btn danger" type="button" id="dis"' + U.action(discard) + '>Discard <kbd>Del</kbd></button>');
      U.announce('Paused. Enter saves, Escape resumes, Delete discards.');
      focusCapture();
    }
    function resume() {
      if (!live || !paused) return;
      if (burst && burst.phase === 'done') { finish(); return; }
      var gap = performance.now() - pausedAt;
      pauses.push([pausedAt, pausedAt + gap]);
      clockStart += gap;
      if (burst) { if (burst.startNow != null) burst.startNow += gap; if (burst.restEnd != null) burst.restEnd += gap; }
      paused = false;
      document.getElementById('stopbar').hidden = true;
      hint('');
      focusCapture();
    }
    function discard() { stop(); U.show('home'); }
    // A key pressed while focus is elsewhere on the typing screen (after a click
    // on a link, say): focus returns to the typing field, and the pause-bar keys
    // still work.
    function keyElsewhere(e) {
      if (!live) return;
      focusCapture();
      var act = { Escape: onEscape, Delete: paused ? discard : null, Enter: briefing ? closeBriefing : paused ? finish : null }[e.key];
      if (act) { e.preventDefault(); act(); }
    }
    // Leaving while typing (nav, links, Back) pauses instead (user decision).
    function holdForLeave() {
      if (!live || firstKeyAt == null) return false;
      if (!paused) pause();
      focusCapture(); // the click that tried to leave took the focus
      return true;
    }
    // Tab restarts at once before typing; after that it asks once.
    function onTab() {
      if (!live) return;
      if (firstKeyAt == null || (tabArmedAt && Date.now() - tabArmedAt < TAB_AGAIN_MS)) { startExercise(type, opts); return; }
      tabArmedAt = Date.now();
      hint('Press <kbd>Tab</kbd> again to restart; what you typed so far is dropped.');
    }

    function finish() {
      if (!live) return;
      var st = session.state();
      var typed = { type: type, startedAt: startedAt, endedAt: Date.now(), words: st.words.filter(function (w) { return w.committed; }), keys: keys,
        firstKeyAt: firstKeyAt, pauses: pauses, opts: opts, text: ex.text || null, rounds: burst ? burst.rounds : null,
        textFinished: exhausted && st.wordIndex >= st.words.length };
      app.typingEndedAt = Date.now(); // keys still in flight must not trigger page shortcuts
      // ended by the timer or the text (not by an explicit save): keys still in
      // flight must not answer the effort question either
      app.effortGuardUntil = paused ? 0 : Date.now() + EFFORT_GUARD_MS;
      stop();
      var info = U.recordExercise(typed);
      if (!info) { tooShort(); return; }
      if (info.opts.bench) U.viewBenchStep(U.saveExercise(info));
      else U.viewEffort(info);
    }
    function tooShort() {
      if (opts.programme && app.run) U.viewBetween();
      else U.go('home');
      U.flash('That exercise was too short to analyse (fewer than ' + U.MIN_WORDS + ' words), so nothing was saved.');
    }

    return { render: render, stop: stop, keyElsewhere: keyElsewhere, holdForLeave: holdForLeave };
  }

  U.startExercise = startExercise;
})(globalThis.FT);
