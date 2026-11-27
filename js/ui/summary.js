// After an exercise: the effort rating, then its summary (also of a past
// exercise reopened from the Progress log), and the conditions of the sitting.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EFFORT = U.EFFORT, exerciseName = FT.exercises.name;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix, H = FT.html;

  // ---------- conditions ----------
  // The conditions of a sitting, typed as free tags and offered from the last ones.
  function tagText(tags) { return tags.map(function (t) { return '#' + t; }).join(' '); }
  function focusTags() { document.getElementById('tags').focus(); }
  // A chip adds its tag to the box, or takes it out.
  function toggleTag(chip) {
    var box = document.getElementById('tags'), tags = FT.conditions.parseTags(box.value), t = chip.dataset.tag, i = tags.indexOf(t);
    if (i >= 0) tags.splice(i, 1); else tags.push(t);
    box.value = tagText(tags);
    box.focus();
  }
  function submitTags() { document.getElementById('tagform').requestSubmit(); }
  // opts.done: the box ends the sitting, saved by Done (Enter; see bindDoneTagBox)
  // in place of Save tags; opts.beside: markup beside Done.
  function tagBox(tags, opts) {
    var past = [], seen = {}, done = opts && opts.done;
    app.trainer.history().slice().reverse().forEach(function (h) { (h.tags || []).forEach(function (t) { if (!seen[t]) { seen[t] = true; past.push(t); } }); });
    return '<form class="stack tagform" id="tagform"><label for="tags">Conditions of this sitting ' + U.shortcut({ key: '#', label: 'Conditions of this sitting', act: focusTags }) +
      ' <span class="muted">(where, keyboard, hands, how you feel)</span></label>' +
      '<div class="row"><input type="text" id="tags" autocomplete="off" spellcheck="false" value="' + esc(tagText(tags)) + '" placeholder="#home #wrist-rest #tired">' +
      (done ? '' : '<button class="btn" type="submit">Save tags <kbd>Enter</kbd></button>') + '</div>' +
      (past.length ? '<div class="row chips">' + past.slice(0, 12).map(function (t) { return '<button type="button" class="chip" data-tag="' + esc(t) + '"' + U.action(toggleTag) + '>#' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '<p class="muted" id="tagmsg" role="status"></p>' +
      (done ? '<div class="row"><button class="btn primary" type="submit" id="home">Done ' + U.shortcut({ key: 'Enter', label: 'Done', act: submitTags }) + '</button>' + (opts.beside || '') + '</div>' : '') +
      '</form>';
  }
  // Saves the tags in the box to the exercises ids; resolves with them once stored.
  function saveTags(ids) {
    var box = document.getElementById('tags'), tags = FT.conditions.parseTags(box.value);
    box.value = tagText(tags);
    app.trainer.tag(ids, tags);
    return Promise.all([app.store.tagSessions(ids, tags), U.saveProfile()]).then(function () { return tags; });
  }
  // ids: the exercises the tags belong to; next: where the focus goes once saved.
  function bindTagBox(ids, next, focus) {
    var form = document.getElementById('tagform'), box = document.getElementById('tags');
    if (!form) return;
    U.onSubmit(form, function () {
      var saved = saveTags(ids);
      if (next) next.focus();
      return saved.then(U.onThisScreen(function (tags) {   // "saved" once it is
        document.getElementById('tagmsg').textContent = tags.length ? 'Saved: ' + tagText(tags) + '.' : 'Saved without tags.';
      })).catch(U.storageError);
    });
    if (focus) box.focus();
  }
  // The training summary's box (tagBox with opts.done): Done, a click or Enter,
  // saves it as it stands, even untouched, then runs done; Esc in the box puts
  // it back as it was drawn and leaves it unsaved, until it is typed in again.
  function bindDoneTagBox(ids, done) {
    var form = document.getElementById('tagform'), box = document.getElementById('tags'), drawn = box.value, escaped = false;
    var finish = function () { if (!escaped) saveTags(ids).catch(U.storageError); done(); };
    U.onSubmit(form, finish);
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { box.value = drawn; escaped = true; } });
    box.addEventListener('input', function () { escaped = false; });
    box.focus();
  }

  // ---------- effort ----------
  function viewEffort(info) {
    app.store.saveDraft(U.draftOf(info)).catch(U.storageError); // kept until rated, so a reload cannot lose it
    var rated = false;
    function pick(v, showSummary) {
      if (rated) return;
      rated = true;
      app.typingEndedAt = 0; // answering is deliberate: keys from the exercise are no longer in flight
      info.effort = v;
      var summary = U.saveExercise(info);
      if (showSummary) viewSummary(summary, info);
    }
    function onKey(e) {
      if (Date.now() < (app.effortGuardUntil || 0)) { e.preventDefault(); return; } // still in flight from typing
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); pick(+e.key, true); }
      else if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('[data-effort]')) {
        e.preventDefault();
        var v = e.target.closest('[data-effort]').dataset.effort;
        pick(v ? +v : null, true);
      } else if (e.key === 'Enter' || e.key === '0' || e.key === 'Escape') { e.preventDefault(); pick(null, true); }
    }
    U.screen('effort', {
      onKey: onKey,
      onLeave: function () { pick(null, false); },   // leaving saves the exercise without a rating
      render: function () {
        U.paint('<section class="effort"><h1>How much effort did that take?</h1>' +
          '<div class="scale">' + EFFORT.map(function (e) {
            return '<button type="button" data-effort="' + e[0] + '"' + U.action(function () { pick(e[0], true); }) + '><b>' + e[0] + '</b><span>' + esc(e[1]) + '</span><span class="muted">' + esc(e[2]) + '</span></button>';
          }).join('') + '</div>' +
          '<p class="muted" id="effortkeys"><kbd>1</kbd>–<kbd>5</kbd> rate · ' + U.legendKey({ label: 'skip', key: 'Enter', help: 'Skip the rating', onClick: function () { pick(null, true); } }) + '</p>' +
          '<p class="muted small" id="effortwhy">Your rating lets LessTypos compare speed at the same effort, and it holds vocabulary growth when typing feels demanding. 0 and Esc also skip.</p></section>');
      },
    });
  }

  // ---------- summary ----------
  // The decision first (what next), then speed, accuracy and one sentence each
  // on vocabulary and the focus list; everything else is under Details (d).
  // info.past: an earlier exercise reopened from the Progress log, which
  // info.back shows again.
  function viewSummary(s, info) {
    U.screen('summary', { render: function () { renderSummary(s, info); } });
  }
  function renderSummary(s, info) {
    var m = s.metrics, h = app.trainer.history(), past = !!info.past;
    var at = past ? h.findIndex(function (x) { return x.id === s.id; }) : h.length - 1;
    var cmp = at >= 0 ? FT.progress.compare(h.slice(0, at), h[at]) : null;
    var inProg = !past && info.opts && info.opts.programme && app.run;
    var again = function () { U.startExercise(info.type, info.opts); };
    var focusList = function () { U.go('insights/focus'); };
    var html = (inProg ? U.programmeBar() : '') +
      '<section class="stack"><h1>' + esc(exerciseName(s.type)) + (past ? ' · ' + esc(FT.fmt.dateTime(s.startedAt)) : ' finished') + '</h1>' +
      (past ? '<div class="row">' + U.keyButton({ label: 'Back to the log', key: 'Escape', id: 'backlog', onClick: info.back }) + '</div>'
        : inProg ? '' : '<div class="row">' + U.keyButton({ label: 'Practise again', key: 'Enter', id: 'again', kind: 'primary', onClick: again }) +
        U.keyButton({ label: 'See the focus list', key: 'q', id: 'seqs', onClick: focusList }) + '</div>') +
      H.tiles([[fix(m.wpm), 'WPM'], [pct(m.firstAttemptAccuracy), 'accuracy (first try)']], { plain: inProg }) +
      (s.textProgress ? '<p>' + esc(s.textProgress.title) + ': ' + FT.fmt.textProgress(s.textProgress, s.textProgress.pos) + '. Your place is saved.</p>' : '') +
      (s.difficulty ? '<p>' + esc(FT.fmt.vocabSentence(s.difficulty, s.frontier)) + '</p>' : '') +
      (past ? '' : '<p>' + focusSentence(s, app.trainer.targets()) + '</p>') +
      '</section>';
    var conditions = inProg || at < 0 ? null : conditionsSection(s, h, at, past);
    if (conditions) html += '<section class="stack" id="conditions">' + conditions.html + '</section>';
    if (s.rounds) {
      html += '<section class="stack"><h3>Rounds</h3>' + H.table(['Round', 'WPM', 'Accuracy', 'Target', 'Result'], s.rounds.map(function (r) {
        return H.row([H.cell(r.round, 'num'), H.cell(fix(r.wpm), 'num'), H.cell(pct(r.accuracy), 'num'), H.cell(Math.round(r.before) + ' → ' + Math.round(r.after), 'num'), H.cell(esc(r.reason))]);
      })) + '<p class="muted">The target rises a little after each round that meets it with at least ' + pct(FT.bursts.MIN_ACC, 0) + ' accuracy and eases otherwise, so it settles where you reach it about half the time. Bursts never change your vocabulary level or the sequence statistics.</p></section>';
    }
    html += '<details id="details" class="stack"><summary>Details ' + U.shortcut({ key: 'd', label: 'Details', act: toggleDetails }) + '</summary>' + details(s, m, cmp) + '</details>';
    U.paint(html);
    var drawn = false, det = document.getElementById('details');
    function draw() {
      if (drawn || !det.open) return;
      drawn = true;
      if (s.timeline && s.timeline.length > 1) FT.chart.timeline(document.getElementById('chart'), s.timeline);
      if (app.layout && s.keyStats) FT.chart.heatmap(document.getElementById('hmex'), FT.layout.grid(app.layout), s.keyStats);
    }
    function toggleDetails() { det.open = !det.open; draw(); }
    det.addEventListener('toggle', draw);
    if (conditions && conditions.bind) conditions.bind();
  }
  // The conditions on a summary: asked at the start of a sitting, otherwise
  // shown with a way to change them. A past exercise's change is its own; a
  // new one's retags its whole sitting.
  function conditionsSection(s, h, at, past) {
    var next = function () { return document.getElementById(past ? 'backlog' : 'again'); };
    var shown = function (tags, note, ids) {
      var edit = function () {
        U.fill(document.getElementById('conditions'), tagBox(tags));
        bindTagBox(ids, next(), true);
      };
      return { html: '<p>Conditions: ' + (tags.length ? esc(tagText(tags)) : '<span class="muted">none</span>') + note + ' ' +
        U.keyButton({ label: 'Change', key: '#', id: 'edittags', onClick: edit }) + '</p>' };
    };
    if (past) return shown(h[at].tags || [], '', [s.id]);
    var sitting = FT.conditions.sittingTags(h.slice(0, at), s.startedAt);
    if (sitting.ask || !sitting.tags.length) return { html: tagBox(sitting.tags), bind: function () { bindTagBox([s.id], next(), false); } };
    return shown(sitting.tags, ' <span class="muted">(same sitting)</span>', FT.conditions.sittingOf(h, s.id));
  }
  function focusSentence(s, targets) {
    var changes = s.stageChanges || [];
    var lead = targets.length ? 'Focus list: ' + targets.length + ' sequence' + (targets.length === 1 ? '' : 's') + ', led by ' + targets.slice(0, 3).map(function (x) { return seq(x.key); }).join(', ') + '.'
      : 'Nothing in the focus list yet.';
    if (!changes.length) return lead;
    return lead + ' ' + changes.slice(0, 3).map(function (c) { return seq(c.key) + ' ' + esc(c.from ? FT.fmt.stageLabel(c.from) + ' → ' : 'now ') + esc(FT.fmt.stageLabel(c.to)); }).join(', ') +
      (changes.length > 3 ? ' and ' + (changes.length - 3) + ' more' : '') + '.';
  }
  function details(s, m, cmp) {
    var html = H.tiles([[pct(s.random.firstAttemptAccuracy), 'on the ' + s.random.words + ' random words'],
      [pct(s.hesitationRate), 'keystrokes over twice their usual time'],
      [fix(s.rhythmCv, 2), 'rhythm variation (lower is more even)'],
      [pct(s.rollover, 0), 'keys pressed before the last was released']]) +
      '<p class="muted">' + fix(s.durationMs / 60000, 1) + ' minutes, ' + m.words + ' words' +
      (s.effort ? ', effort ' + s.effort + ' (' + esc(EFFORT[s.effort - 1][1].toLowerCase()) + ')' : '') + '. ' +
      (m.IF ? m.IF + ' corrected keystrokes, ' : '') + m.F + ' backspaces, ' + fix(m.INF) + ' uncorrected errors.</p>';
    if (cmp) html += '<p class="notice info">' + esc(FT.fmt.comparison(cmp)) + '</p>';
    if (s.timeline && s.timeline.length > 1) {
      html += '<section class="stack"><h3>Speed through the exercise</h3>' +
        '<div class="legend"><span><i class="k1"></i>Running average</span><span><i class="k2"></i>Each word</span>' +
        '<span><i class="kx">×</i>Word with an error on the first try</span></div>' +
        '<div class="chart" id="chart"></div>' +
        H.tableView(H.table(['#', 'Word', 'WPM (word)', 'WPM (running)', 'Error'], s.timeline.map(function (p) {
          return H.row([H.cell(p.i, 'num'), H.cell(esc(p.word)), H.cell(fix(p.burst), 'num'), H.cell(fix(p.running), 'num'), H.cell(p.error ? '×' : '')]);
        }))) + '</section>';
    }
    if (app.layout && s.keyStats) html += '<section class="stack"><h3>Errors by key</h3><div class="heatmap" id="hmex"></div></section>';
    return html;
  }

  Object.assign(U, { tagBox: tagBox, bindTagBox: bindTagBox, bindDoneTagBox: bindDoneTagBox, viewEffort: viewEffort, viewSummary: viewSummary });
})(globalThis.FT);
