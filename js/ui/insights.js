// Insight pages: sequences (with the "why" panel), substitutions, history.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EXERCISES = U.EXERCISES, EFFORT = U.EFFORT;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix, pill = FT.fmt.pill;
  // defined in other ui files
  function setView() { return U.setView.apply(null, arguments); }
  function startExercise() { return U.startExercise.apply(null, arguments); }

  // ---------- sequences ----------
  var seqTab = 'focus', seqSel = null, allOpen = false, moveOpen = false;
  var FOCUS_TOP = 8;
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
    var top = t.targets().slice(0, FOCUS_TOP);
    var html = '<section class="stack">' + U.sectionHead('insights') +
      (top.length
        ? '<p class="muted">What LessTypos is training now, most useful first. These sequences appear inside ordinary words in your exercises.</p>' +
          '<ol class="focuslist">' + top.map(function (x) {
            var c = all[x.key] || {};
            return '<li data-key="' + esc(x.key) + '"' + (seqSel === x.key ? ' class="selected"' : '') + '><button type="button" class="rowbtn" data-row>' + seq(x.key) + '</button> ' +
              FT.fmt.stagePill(x.stage) + ' <span class="muted">' + FT.fmt.focusReason(c, x.stage) + '</span></li>';
          }).join('') + '</ol>' +
          '<details><summary>What the statuses mean</summary><p class="muted">' + FT.fmt.statusLegend() + '</p></details>'
        : '<p class="panel">Nothing needs extra practice yet. Sequences appear here once the evidence shows they cost errors or time in at least 2 sessions.</p>') +
      (ev.late.length ? '<p class="muted" id="latenote">' + FT.fmt.lateNote(ev.late) + '</p>' : '') +
      '</section><section id="why"></section>' +
      '<details id="allseq" class="stack"' + (allOpen ? ' open' : '') + '><summary>All sequences</summary>' +
      '<p class="muted">Each sequence is the last one to four characters you typed, spaces included. It is flagged only when it is credibly worse than its shorter version in other words (for example ' + seq('str') + ' against ' + seq('tr') + '), so a single slip never flags anything.</p>' +
      '<div class="tabs" role="group">' +
      [['focus', 'Focus list'], ['kept', 'Consolidating and mastered'], ['all', 'All with enough evidence']].map(function (x) {
        return '<button type="button" data-tab="' + x[0] + '" aria-pressed="' + (seqTab === x[0]) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>' +
      '<p class="muted num">' + keys.length + ' sequences observed; ' + counts.insufficient + ' do not have enough observations yet.</p>';
    if (!shown.length) {
      html += '<p class="panel">' + (seqTab === 'focus' ? 'Nothing needs extra practice yet. Sequences appear here once the evidence shows they cost errors or time.' : 'No sequences in this group yet.') + '</p>';
    } else {
      html += '<div class="tablewrap"><table><thead><tr><th>Sequence</th><th>Status</th><th>Seen</th><th>Errors</th><th>Time vs shorter</th>' +
        (app.layout ? '<th>Movement</th>' : '') + '<th>Examples</th></tr></thead><tbody>' +
        shown.map(function (k) {
          var c = all[k], st = ctxs[k].stage;
          return '<tr class="clickable' + (seqSel === k ? ' selected' : '') + '" data-key="' + esc(k) + '"><td><button type="button" class="rowbtn" data-row>' + seq(k) + '</button></td>' +
            '<td>' + (st ? FT.fmt.stagePill(st.name) : FT.fmt.statePill(c.state)) + (st && st.regressed ? ' <span class="muted">returned</span>' : '') + '</td>' +
            '<td class="num">' + fix(c.n) + '</td>' +
            '<td class="num">' + pct(c.errorRate) + ' <span class="muted">vs ' + pct(c.parentErrorRate) + '</span></td>' +
            '<td class="num">×' + fix(c.latRel, 2) + '</td>' +
            (app.layout ? '<td>' + esc(movement(k)) + '</td>' : '') +
            '<td class="ex">' + esc(ctxs[k].ex.slice(-3).reverse().join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '</details>';
    var mv = movementTable(ev);
    if (mv) html += '<details id="moves" class="stack"' + (moveOpen ? ' open' : '') + '><summary>By movement type</summary>' + mv + '</details>';
    setView(html);
    document.getElementById('allseq').addEventListener('toggle', function (e) { allOpen = e.target.open; });
    var mvd = document.getElementById('moves');
    if (mvd) mvd.addEventListener('toggle', function (e) { moveOpen = e.target.open; });
    app.$view.querySelectorAll('.focuslist [data-key]').forEach(function (li) { li.onclick = function () { seqSel = li.dataset.key; showWhy(seqSel); markSel(); }; });
    app.$view.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { seqTab = b.dataset.tab; viewSequences(); }; });
    app.$view.querySelectorAll('tr[data-key]').forEach(function (r) { r.onclick = function () { seqSel = r.dataset.key; showWhy(seqSel); markSel(); }; });
    app.$view.querySelectorAll('#movement [data-key]').forEach(function (b) { b.onclick = function () { seqSel = b.dataset.key; showWhy(seqSel); markSel(); }; });
    if (seqSel && all[seqSel]) showWhy(seqSel);
  }
  // Letter pairs grouped by movement type on the declared layout (descriptive).
  var MOVEMENT = { alternate: 'alternation (other hand)', 'roll-in': 'inward roll', 'roll-out': 'outward roll',
    sfb: 'same finger', repeat: 'same key twice', 'full-scissor': 'full scissor', 'half-scissor': 'half scissor', lsb: 'lateral stretch' };
  function movementTable(ev) {
    if (!app.layout) return '';
    var rows = FT.layout.breakdown(ev, app.layout);
    if (!rows.length) return '';
    return '<section class="stack" id="movement"><p class="muted">Every letter pair you have typed, grouped by how your fingers move on your layout. ' +
      'Typing research finds alternating hands usually fastest (Salthouse 1986), so it is the reference. Descriptive only: training does not use it.</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Movement</th><th>Share of your pairs</th><th>Pairs</th><th>Seen</th><th>Time vs alternation</th><th>Errors (first try)</th><th>Slowest pairs</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(MOVEMENT[r.type] || r.type) + (r.overlapping ? ' <span class="muted">(also in a row above)</span>' : '') + '</td><td class="num">' + pct(r.share) + '</td><td class="num">' + r.pairs + '</td><td class="num">' + fix(r.n) + '</td>' +
          '<td class="num">' + (r.time == null ? '–' : '×' + fix(r.time, 2)) + '</td><td class="num">' + pct(r.errorRate) + '</td><td>' +
          r.worst.map(function (k) { return '<button type="button" class="linkish" data-key="' + esc(k) + '">' + seq(k) + '</button>'; }).join(' ') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  function markSel() { app.$view.querySelectorAll('tr[data-key], .focuslist [data-key]').forEach(function (r) { r.classList.toggle('selected', r.dataset.key === seqSel); }); }
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
    lines.push(['Timing', x.lateKey
      ? 'Not judged: your keyboard sends ' + seq(k) + ' late (a tap-hold key), so its time against all your typing is shifted by the keyboard, not by you.'
      : 'Typed in ×' + fix(x.latency.relative, 2) + ' the time of ' + parent + ' elsewhere (' + fix(x.latency.n) + ' timed keystrokes). ' +
        'Probability that it is genuinely slower: ' + pct(x.latency.pSlower, 0) + '.']);
    lines.push(['Evidence', fix(x.n) + ' recency-weighted observations across ' + x.sessions + ' exercise' + (x.sessions === 1 ? '' : 's') + '.']);
    if (x.state === 'emerging') {
      lines.push(['Confirmation', 'Seen in ' + x.sessionsWithDeficit + ' session so far; it needs ' + x.minSessions +
        ' separate sessions before it is trained, so one unusual session cannot fill the training list.']);
    } else if (x.state === 'weak' || x.state === 'hesitant') {
      lines.push(['Confirmation', 'Worse than ' + parent + ' in ' + x.sessionsWithDeficit + ' separate sessions.']);
    }
    lines.push(['Judgement', FT.fmt.statePill(x.state) + (x.redundant ? ': every occurrence also belongs to ' + parent + ', so it is judged there.' : '') +
      (x.explainedBy ? ': the difficulty is explained by ' + x.explainedBy.map(seq).join(', ') + '.' : '')]);
    if (x.stage) lines.push(['Training', FT.fmt.stagePill(x.stage.name) + (x.stage.due ? ' next check from session ' + x.stage.due : '') + (x.stage.regressed ? ', returned after a failed check' : '')]);
    if (app.layout) { var mv = movement(k); if (mv) lines.push(['Movement', esc(mv)]); }
    lines.push(['Seen in', esc(x.examples.join(', '))]);
    el.className = 'panel stack';
    el.innerHTML = '<h2>' + seq(k) + ': ' + esc(FT.fmt.stateLabel(x.state)) + (x.stage ? ', ' + esc(FT.fmt.stageLabel(x.stage.name)) : '') + '</h2><dl class="why">' +
      lines.map(function (l) { return '<dt>' + l[0] + '</dt><dd>' + l[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="row"><button class="btn primary" type="button" id="practise">Practise ' + seq(k) + ' for 3 minutes <kbd>p</kbd></button></div>';
    var practise = function () { startExercise('targeted', { pinned: [k], minutes: 3 }); };
    document.getElementById('practise').onclick = practise;
    app.keys.p = practise;
    var h = el.querySelector('h2');
    h.setAttribute('tabindex', '-1');
    h.focus();
  }

  // ---------- errors ----------
  function viewErrors() {
    var rows = app.trainer.substitutions({ minOpp: 30 }).filter(function (r) { return r.count >= 2; }).slice(0, 40);
    var html = '<section class="stack">' + U.sectionHead('insights') + '<h2>Recurring substitutions</h2>' +
      '<p class="muted">Which key comes out when another was intended. Rates are per opportunity to type the intended character and include errors you corrected. Rare pairs are shrunk toward the overall substitution rate, so a one-off does not top the list.</p></section>';
    var L = app.layout;
    if (L) html += '<section class="stack"><h3>Errors by key</h3><p class="muted">All your exercises, on your layout.</p><div class="heatmap" id="hmall"></div></section>';
    if (L) {
      // Kinds of slips across all substitutions on the declared layout.
      var kinds = {}, total = 0;
      app.trainer.substitutions({ minOpp: 1 }).forEach(function (r) {
        var rel = FT.layout.relation(L, r.expected, r.actual);
        if (!rel) return;
        var k = kinds[rel.kind] || (kinds[rel.kind] = { n: 0 });
        k.n += r.count; total += r.count;
      });
      var KIND = FT.layout.KINDS;
      var list = Object.keys(kinds).sort(function (a, b) { return kinds[b].n - kinds[a].n; });
      if (total >= 3) {
        html += '<section class="stack"><h3>Kinds of slips</h3><p class="muted">How the typed key relates to the intended one on your layout, across ' + fix(total) + ' substitutions. ' +
          'In studies of skilled typists, neighbouring keys and mirror keys are the most common slips (Grudin 1983).</p><ul class="list">' +
          list.map(function (k) { return '<li><b class="num">' + pct(kinds[k].n / total, 0) + '</b> ' + esc(KIND[k]) + '</li>'; }).join('') + '</ul></section>';
      }
    }
    if (!rows.length) html += '<p class="panel">No recurring substitutions yet.</p>';
    else {
      html += '<div class="tablewrap"><table><thead><tr><th>Intended</th><th>Typed</th>' + (L ? '<th>Kind</th>' : '') + '<th>Rate</th><th>Times</th><th>Opportunities</th><th>Recent examples</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var rel = L && FT.layout.relation(L, r.expected, r.actual);
          return '<tr class="clickable" data-i="' + i + '"><td><button type="button" class="rowbtn" data-row>' + seq(r.expected) + '</button></td><td>' + seq(r.actual) + '</td>' +
            (L ? '<td>' + esc(rel ? rel.label : '') + '</td>' : '') +
            '<td class="num">' + pct(r.rate, 2) + '</td><td class="num">' + fix(r.count) + '</td><td class="num">' + r.opportunities + '</td>' +
            '<td class="ex">' + esc(r.examples.slice(0, 3).map(function (e) { return e.context; }).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div><section id="subex"></section>';
    }
    var swaps = app.trainer.swaps({ minOpp: 10 }).filter(function (r) { return r.count >= 2; }).slice(0, 20);
    if (swaps.length) {
      html += '<section class="stack" id="swaps"><h3>Swapped letters</h3><p class="muted">Two neighbouring letters typed in the wrong order (a transposition, one of the error classes of Salthouse 1986). Each swap counts as one error. Rates are per occurrence of the intended pair.</p>' +
        '<div class="tablewrap"><table><thead><tr><th>Intended</th><th>Typed</th><th>Rate</th><th>Times</th><th>Opportunities</th><th>Recent examples</th></tr></thead><tbody>' +
        swaps.map(function (r) {
          return '<tr><td>' + seq(r.expected) + '</td><td>' + seq(r.actual) + '</td><td class="num">' + pct(r.observedRate, 2) + '</td><td class="num">' + fix(r.count) +
            '</td><td class="num">' + r.opportunities + '</td><td class="ex">' + esc(r.examples.slice(0, 3).map(function (e) { return e.context; }).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    setView(html);
    if (L) FT.chart.heatmap(document.getElementById('hmall'), FT.layout.grid(L), FT.progress.sumKeys(app.trainer.history()));
    app.$view.querySelectorAll('tr[data-i]').forEach(function (tr) {
      tr.onclick = function () {
        var r = rows[+tr.dataset.i], el = document.getElementById('subex');
        el.className = 'panel stack';
        el.innerHTML = '<h2>' + seq(r.expected) + ' typed as ' + seq(r.actual) + '</h2><div class="tablewrap"><table><thead><tr><th>Word</th><th>Where</th><th>Corrected</th><th>Later letter</th><th>Exercise</th></tr></thead><tbody>' +
          r.examples.map(function (e) {
            return '<tr><td>' + esc(e.word) + '</td><td>' + seq(e.context) + '</td><td>' + (e.corrected ? 'yes' : 'no') + '</td><td>' + (e.premature ? 'yes' : '') + '</td><td>' + esc(e.exercise || '') + '</td></tr>';
          }).join('') + '</tbody></table></div><p class="muted">“Later letter” marks a typed letter that occurs later in the same word.</p>';
        var h = el.querySelector('h2');
        h.setAttribute('tabindex', '-1');
        h.focus();
      };
    });
  }

  // ---------- history ----------
  // Progress over time: one small chart per measure, each on its own axis,
  // comparing only comparable sessions (FT.progress.series).
  function progressCharts(h) {
    var s = FT.progress.series(h), date = function (t) { return new Date(t).toLocaleDateString(); };
    var charts = [
      { title: 'Relaxed speed', note: 'Median WPM per day of relaxed practice. Fill shows rated effort: hollow = not rated, light = little effort, solid = maximum.',
        label: 'Relaxed WPM', color: '--series-1', min: 1, rows: s.relaxed,
        point: function (p) { return { t: p.t, y: p.wpm, fill: p.effort == null ? null : (p.effort - 1) / 4,
          tip: '<b>' + fix(p.wpm) + ' WPM</b> · ' + esc(date(p.t)) + '<br>' + p.n + ' session' + (p.n > 1 ? 's' : '') + ', effort ' + (p.effort == null ? 'not rated' : fix(p.effort, 1) + ' (' + EFFORT[Math.round(p.effort) - 1][1].toLowerCase() + ')') }; },
        cols: ['Day', 'WPM', 'Accuracy', 'Effort'], cells: function (p) { return [esc(date(p.t)), fix(p.wpm), pct(p.faa), p.effort == null ? '–' : fix(p.effort, 1)]; } },
      { title: 'Benchmark', note: 'Median of each complete set of 3 one-minute trials; the line shows the range of the trials.',
        label: 'Benchmark WPM', color: '--series-2', min: 1, rows: s.benchmark,
        point: function (p) { return { t: p.t, y: p.wpm, lo: p.min, hi: p.max, tip: '<b>' + fix(p.wpm) + ' WPM</b> · ' + esc(date(p.t)) + '<br>trials ' + fix(p.min) + '–' + fix(p.max) + ', accuracy ' + pct(p.faa) }; },
        cols: ['Day', 'Median WPM', 'Range', 'Accuracy'], cells: function (p) { return [esc(date(p.t)), fix(p.wpm), fix(p.min) + '–' + fix(p.max), pct(p.faa)]; } },
      { title: 'Common-pair timing', note: 'Median time between the letters of the 30 most common pairs inside words, in relaxed practice, weighted by how many such pairs each exercise had. Lower is faster. Pairs typed with a multi-letter key (such as th) are not timed. Log scale.',
        label: 'Common-pair timing in ms', color: '--series-1', min: 1, rows: s.pairMs, log: true, fmt: function (v) { return Math.round(v) + ''; },
        point: function (p) { return { t: p.t, y: p.ms, tip: '<b>' + fix(p.ms) + ' ms</b> · ' + esc(date(p.t)) }; },
        cols: ['Day', 'ms'], cells: function (p) { return [esc(date(p.t)), fix(p.ms)]; } },
      { title: 'Accuracy', note: 'Accuracy (first try) per day of relaxed practice: corrected errors count too.',
        label: 'Relaxed accuracy (first try)', color: '--series-1', min: 1, yMax: 1, rows: s.relaxed, fmt: function (v) { return pct(v, 1); },
        point: function (p) { return { t: p.t, y: p.faa, tip: '<b>' + pct(p.faa) + '</b> · ' + esc(date(p.t)) }; },
        cols: ['Day', 'Accuracy'], cells: function (p) { return [esc(date(p.t)), pct(p.faa)]; } },
      { title: 'Effort signals (experimental)', note: 'Measured signals that tend to fall as typing becomes automatic: the extra time before the first letter of each word (charted, research: Crump et al. 2019) and how uneven your keystroke timing is (rhythm, in the table and tooltip; Kalfaoglu & Stafford 2014). They are proxies, not a validated measure of effort: compare them with your own ratings.',
        label: 'Extra time at word starts in ms', color: '--series-2', min: 1, rows: s.relaxed.filter(function (p) { return p.startMs != null; }), fmt: function (v) { return Math.round(v) + ''; },
        point: function (p) { return { t: p.t, y: p.startMs, tip: '<b>+' + fix(p.startMs) + ' ms</b> at word starts · ' + esc(date(p.t)) + '<br>rhythm variation ' + fix(p.cv, 2) + ', rated effort ' + (p.effort == null ? 'not rated' : fix(p.effort, 1)) }; },
        cols: ['Day', 'Word starts (ms)', 'Rhythm', 'Rated effort'], cells: function (p) { return [esc(date(p.t)), fix(p.startMs), fix(p.cv, 2), p.effort == null ? '–' : fix(p.effort, 1)]; } },
    ];
    var html = '<section class="stack"><h2>Progress</h2><div class="progress-grid">' + charts.map(function (c, i) {
      var enough = c.rows.length >= c.min;
      return '<section class="progress-chart stack"><h3>' + esc(c.title) + '</h3><p class="muted">' + esc(c.note) + '</p>' +
        (enough ? '<div class="chart" id="pc' + i + '"></div>' : '<p class="panel muted">Not enough data yet.</p>') +
        '<details class="tableview"><summary>Show as table</summary><div class="tablewrap"><table><thead><tr>' +
        c.cols.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
        c.rows.slice().reverse().map(function (p) { return '<tr>' + c.cells(p).map(function (v) { return '<td class="num">' + v + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div></details></section>';
    }).join('') + '</div></section>';
    return { html: html, draw: function () {
      charts.forEach(function (c, i) {
        var el = document.getElementById('pc' + i);
        if (el) FT.chart.progress(el, { points: c.rows.map(c.point), log: c.log, yMax: c.yMax, color: c.color, fmt: c.fmt, label: c.label });
      });
    } };
  }

  function viewHistory() {
    var h = app.trainer.history().slice().reverse();
    var pc = progressCharts(app.trainer.history());
    var html = '<section class="stack">' + U.sectionHead('insights') + '</section>' + pc.html +
      '<section class="stack"><h2>All exercises</h2><p class="muted">Newest first. “Random words” is the unbiased sample that targeted practice never influences.</p></section>';
    if (!h.length) html += '<p class="panel">No exercises yet.</p>';
    else html += '<div class="tablewrap"><table id="alltable"><thead><tr><th>When</th><th>Exercise</th><th>Min</th><th>WPM</th><th>Accuracy</th><th>Random words</th><th>Effort</th><th>Hesitation</th><th>Rhythm</th><th>Vocabulary</th></tr></thead><tbody>' +
      h.map(function (x) {
        var d = new Date(x.t);
        return '<tr><td class="num">' + esc(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</td>' +
          '<td>' + esc((EXERCISES[x.type] || { name: x.type }).name) + '</td><td class="num">' + fix(x.ms / 60000, 1) + '</td>' +
          '<td class="num">' + fix(x.wpm) + '</td><td class="num">' + pct(x.faa) + '</td><td class="num">' + pct(x.randomFaa) + '</td>' +
          '<td class="num">' + (x.effort || '–') + '</td><td class="num">' + pct(x.hes) + '</td><td class="num">' + fix(x.cv, 2) + '</td>' +
          '<td class="num">' + Math.round(x.frontier) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    setView(html);
    pc.draw();
  }

  Object.assign(U, { viewSequences: viewSequences, markSel: markSel, movement: movement, showWhy: showWhy, viewErrors: viewErrors, viewHistory: viewHistory });
})(globalThis.FT);
