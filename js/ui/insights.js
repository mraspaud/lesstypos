// Insight pages: sequences (with the "why" panel), substitutions, history.
(function (FT) {
  'use strict';
  if (typeof document === 'undefined') return;
  var U = FT.ui, app = U.app, EFFORT = U.EFFORT;
  var esc = FT.fmt.esc, seq = FT.fmt.seq, pct = FT.fmt.pct, fix = FT.fmt.fix, H = FT.html;

  // ---------- sequences ----------
  var seqTab = 'focus', seqSel = null, allOpen = false, moveOpen = false;
  var FOCUS_TOP = 8;
  function viewSequences() { U.screen('insights/focus', { render: renderSequences }); }
  function renderSequences() {
    var t = app.trainer, evaluation = t.evaluate(), all = evaluation.all, ctxs = t.model.state().contexts;
    var priority = {};
    t.targets().forEach(function (target) { priority[target.key] = target.priority; });
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
      if (seqTab === 'focus') return (priority[b] || 0) - (priority[a] || 0) || all[b].latRel - all[a].latRel;
      return all[b].n - all[a].n;
    });
    var shown = rows.slice(0, 200);
    var top = t.targets().slice(0, FOCUS_TOP);
    var html = '<section class="stack">' + U.sectionHead('insights') +
      (top.length
        ? '<p class="muted">What LessTypos is training now, most useful first. These sequences appear inside ordinary words in your exercises.</p>' +
          '<ol class="focuslist">' + top.map(function (target) {
            var c = all[target.key] || {};
            return '<li data-key="' + esc(target.key) + '"' + (seqSel === target.key ? ' class="selected"' : '') + U.action(selectSequence) + '><button type="button" class="rowbtn" data-row>' + seq(target.key) + '</button> ' +
              FT.fmt.stagePill(target.stage) + ' <span class="muted">' + FT.fmt.focusReason(c, target.stage) + '</span></li>';
          }).join('') + '</ol>' +
          '<details><summary>What the statuses mean</summary><p class="muted">' + FT.fmt.statusLegend() + '</p></details>'
        : '<p class="panel">Nothing needs extra practice yet. Sequences appear here once the evidence shows they cost errors or time in at least ' + FT.model.DEFAULTS.minSessions + ' sessions.</p>') +
      (evaluation.late.length ? '<p class="muted" id="latenote">' + FT.fmt.lateNote(evaluation.late) + '</p>' : '') +
      '</section><section id="why"></section>' +
      '<details id="allseq" class="stack"' + (allOpen ? ' open' : '') + '><summary>All sequences</summary>' +
      '<p class="muted">Each sequence is the last one to four characters you typed, spaces included. It is flagged only when it is credibly worse than its shorter version in other words (for example ' + seq('str') + ' against ' + seq('tr') + '), so a single slip never flags anything.</p>' +
      '<div class="tabs" role="group">' +
      [['focus', 'Focus list'], ['kept', 'Consolidating and mastered'], ['all', 'All with enough evidence']].map(function (tab) {
        return '<button type="button" id="seqtab-' + tab[0] + '" data-tab="' + tab[0] + '" aria-pressed="' + (seqTab === tab[0]) + '"' + U.action(chooseTab) + '>' + esc(tab[1]) + '</button>';
      }).join('') + '</div>' +
      '<p class="muted num">' + keys.length + ' sequences observed; ' + counts.insufficient + ' do not have enough observations yet.</p>';
    if (!shown.length) {
      html += '<p class="panel">' + (seqTab === 'focus' ? 'Nothing needs extra practice yet. Sequences appear here once the evidence shows they cost errors or time.' : 'No sequences in this group yet.') + '</p>';
    } else {
      var head = ['Sequence', 'Status', 'Seen', 'Errors', 'Time vs shorter'].concat(app.layout ? ['Movement'] : [], ['Examples']);
      html += H.table(head, shown.map(function (k) {
        var c = all[k], st = ctxs[k].stage;
        return H.row([H.cell('<button type="button" class="rowbtn" data-row>' + seq(k) + '</button>'),
          H.cell((st ? FT.fmt.stagePill(st.name) : FT.fmt.statePill(c.state)) + (st && st.regressed ? ' <span class="muted">returned</span>' : '')),
          H.cell(fix(c.n), 'num'),
          H.cell(pct(c.errorRate) + ' <span class="muted">vs ' + pct(c.parentErrorRate) + '</span>', 'num'),
          H.cell('×' + fix(c.latRel, 2), 'num')].concat(app.layout ? [H.cell(esc(movement(k)))] : [],
          [H.cell(esc(ctxs[k].examples.slice(-3).reverse().join(', ')), 'ex')]),
          ' class="clickable' + (seqSel === k ? ' selected' : '') + '" data-key="' + esc(k) + '"' + U.action(selectSequence));
      }));
    }
    html += '</details>';
    var movements = movementTable(evaluation);
    if (movements) html += '<details id="moves" class="stack"' + (moveOpen ? ' open' : '') + '><summary>By movement type</summary>' + movements + '</details>';
    U.paint(html);
    document.getElementById('allseq').addEventListener('toggle', function (e) { allOpen = e.target.open; });
    var movesBox = document.getElementById('moves');
    if (movesBox) movesBox.addEventListener('toggle', function (e) { moveOpen = e.target.open; });
    if (seqSel && all[seqSel]) showWhy(seqSel);
  }
  // A click on a sequence (in the focus list, the table or the movements) explains it.
  function selectSequence(el) { seqSel = el.dataset.key; showWhy(seqSel, true); markSel(); }
  function chooseTab(button) { seqTab = button.dataset.tab; U.redraw(); }
  // Letter pairs grouped by movement type on the declared layout (descriptive).
  var MOVEMENT = { alternate: 'alternation (other hand)', 'roll-in': 'inward roll', 'roll-out': 'outward roll',
    sfb: 'same finger', repeat: 'same key twice', 'full-scissor': 'full scissor', 'half-scissor': 'half scissor', lsb: 'lateral stretch' };
  function movementTable(evaluation) {
    if (!app.layout) return '';
    var rows = FT.layout.breakdown(evaluation, app.layout);
    if (!rows.length) return '';
    return '<section class="stack" id="movement"><p class="muted">Every letter pair you have typed, grouped by how your fingers move on your layout. ' +
      'Typing research finds alternating hands usually fastest (Salthouse 1986), so it is the reference. Descriptive only: training does not use it.</p>' +
      H.table(['Movement', 'Share of your pairs', 'Pairs', 'Seen', 'Time vs alternation', 'Errors (first try)', 'Slowest pairs'], rows.map(function (r) {
        return H.row([H.cell(esc(MOVEMENT[r.type] || r.type) + (r.overlapping ? ' <span class="muted">(also in a row above)</span>' : '')), H.cell(pct(r.share), 'num'),
          H.cell(r.pairs, 'num'), H.cell(fix(r.n), 'num'), H.cell(r.time == null ? '–' : '×' + fix(r.time, 2), 'num'), H.cell(pct(r.errorRate), 'num'),
          H.cell(r.worst.map(function (k) { return '<button type="button" class="linkish" data-key="' + esc(k) + '"' + U.action(selectSequence) + '>' + seq(k) + '</button>'; }).join(' '))]);
      })) + '</section>';
  }
  function markSel() { app.$view.querySelectorAll('tr[data-key], .focuslist [data-key]').forEach(function (r) { r.classList.toggle('selected', r.dataset.key === seqSel); }); }
  // Movement type of the last two or three key presses of a sequence, on the
  // declared layout. Across spaces only when the layout declares a space key.
  function movement(k) {
    var layout = app.layout;
    if (!layout) return '';
    var typed = layout.keys[' '] ? k : k.replace(/^.*\s/, '');
    var presses = FT.layout.presses(layout, typed);
    if (!presses || presses.length < 2 && !(presses.length === 1 && Array.from(presses[0]).length > 1)) return '';
    var found = FT.layout.classify(layout, presses.slice(-3).join('')) || FT.layout.classify(layout, presses.slice(-2).join(''));
    return found ? found.type + (found.tags.length ? ' (' + found.tags.join(', ') + ')' : '') : '';
  }
  // focus: move focus to the panel (when the user opened it, not on re-render)
  function showWhy(k, focus) {
    var why = app.trainer.explain(k), el = document.getElementById('why');
    if (!why || !el) return;
    var lines = [];
    var parent = why.parent ? seq(why.parent) : 'all your typing';
    lines.push(['Errors', pct(why.errorRate) + ' of first attempts, against ' + pct(why.parentErrorRate) + ' for ' + parent + ' elsewhere. ' +
      'Probability that it is genuinely worse: ' + pct(why.pWorse, 0) + '.']);
    lines.push(['Timing', why.lateKey
      ? 'Not judged: your keyboard sends ' + seq(k) + ' late (a tap-hold key), so its time against all your typing is shifted by the keyboard, not by you.'
      : 'Typed in ×' + fix(why.latency.relative, 2) + ' the time of ' + parent + ' elsewhere (' + fix(why.latency.n) + ' timed keystrokes). ' +
        'Probability that it is genuinely slower: ' + pct(why.latency.pSlower, 0) + '.']);
    lines.push(['Evidence', fix(why.n) + ' recency-weighted observations across ' + why.sessions + ' session' + (why.sessions === 1 ? '' : 's') + '.']);
    if (why.state === 'emerging') {
      lines.push(['Confirmation', 'Seen in ' + why.sessionsWithDeficit + ' session' + (why.sessionsWithDeficit === 1 ? '' : 's') + ' so far; it needs ' + why.minSessions +
        ' separate sessions before it is trained, so one unusual session cannot fill the training list.']);
    } else if (why.state === 'weak' || why.state === 'hesitant') {
      lines.push(['Confirmation', 'Worse than ' + parent + ' in ' + why.sessionsWithDeficit + ' separate sessions.']);
    }
    lines.push(['Judgement', FT.fmt.statePill(why.state) + (why.redundant ? ': every occurrence also belongs to ' + parent + ', so it is judged there.' : '') +
      (why.explainedBy ? ': the difficulty is explained by ' + why.explainedBy.map(seq).join(', ') + '.' : '')]);
    if (why.stage) lines.push(['Training', FT.fmt.stagePill(why.stage.name) + (why.stage.due ? ' next check from session ' + why.stage.due : '') + (why.stage.regressed ? ', returned after a failed check' : '')]);
    if (app.layout) { var movementType = movement(k); if (movementType) lines.push(['Movement', esc(movementType)]); }
    lines.push(['Seen in', esc(why.examples.join(', '))]);
    var practise = function () { U.startExercise('targeted', { pinned: [k], minutes: 3 }); };
    el.className = 'panel stack';
    U.fill(el, '<h2>' + seq(k) + ': ' + esc(FT.fmt.stateLabel(why.state)) + (why.stage ? ', ' + esc(FT.fmt.stageLabel(why.stage.name)) : '') + '</h2><dl class="why">' +
      lines.map(function (l) { return '<dt>' + l[0] + '</dt><dd>' + l[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="row">' + U.keyButton({ label: 'Practise ' + seq(k) + ' for 3 minutes', key: 'p', id: 'practise', kind: 'primary', onClick: practise }) + '</div>');
    var heading = el.querySelector('h2');
    heading.setAttribute('tabindex', '-1');
    if (focus) heading.focus();
  }

  // ---------- errors ----------
  function viewErrors() { U.screen('insights/errors', { render: renderErrors }); }
  function renderErrors() {
    var rows = app.trainer.substitutions({ minOpp: 30 }).filter(function (r) { return r.count >= 2; }).slice(0, 40);
    var html = '<section class="stack">' + U.sectionHead('insights') + '<h2>Recurring substitutions</h2>' +
      '<p class="muted">Which key comes out when another was intended. Rates are per press of the intended key (a multi-letter key is a key of its own) and include errors you corrected. ' +
      'The list is ordered by a rate shrunk toward your overall rate, so a one-off does not top it. Confirmed: credibly above your overall rate, in 2 sessions or more.</p></section>';
    var layout = app.layout;
    if (layout) html += '<section class="stack"><h3>Errors by key</h3><p class="muted">All your exercises, on your layout.</p><div class="heatmap" id="hmall"></div></section>';
    if (layout) {
      // Kinds of slips across all substitutions on the declared layout.
      var kinds = {}, total = 0;
      app.trainer.substitutions({ minOpp: 1 }).forEach(function (r) {
        var rel = FT.layout.relation(layout, r.expected, r.actual);
        if (!rel) return;
        var k = kinds[rel.kind] || (kinds[rel.kind] = { n: 0 });
        k.n += r.count; total += r.count;
      });
      var KIND = FT.layout.KINDS;
      var list = Object.keys(kinds).sort(function (a, b) { return kinds[b].n - kinds[a].n; });
      if (total >= 3) {
        html += '<section class="stack"><h3>Kinds of slips</h3><p class="muted">How the typed key relates to the intended one on your layout, across ' + fix(total) + ' substitutions (letters typed early left out). ' +
          'In studies of skilled typists, neighbouring keys and mirror keys are the most common slips (Grudin 1983).</p><ul class="list">' +
          list.map(function (k) { return '<li><b class="num">' + pct(kinds[k].n / total, 0) + '</b> ' + esc(KIND[k]) + '</li>'; }).join('') + '</ul></section>';
      }
    }
    if (!rows.length) html += '<p class="panel">No recurring substitutions yet.</p>';
    else {
      html += H.table(['Intended', 'Typed'].concat(layout ? ['Kind'] : [], ['Rate per press', 'Times', 'Recent examples']), rows.map(function (r, i) {
        var rel = layout && FT.layout.relation(layout, r.expected, r.actual);
        return H.row([H.cell('<button type="button" class="rowbtn" data-row>' + seq(r.expected) + '</button>'),
          H.cell(seq(r.actual) + (r.confirmed ? ' <span class="pill confirmed" title="Credibly above your overall rate, in ' + r.sessions + ' sessions">confirmed</span>' : ''))].concat(
          layout ? [H.cell(esc(rel ? rel.label : ''))] : [], slipRate(r), [H.cell(esc(recentContexts(r)), 'ex')]), ' class="clickable" data-i="' + i + '"' + U.action(function () { showExamples(r); }));
      }), { id: 'slips' }) + '<section id="subex"></section>';
    }
    var early = app.trainer.prematureSlips({ minOpp: 30 }).filter(function (r) { return r.count >= 2; }).slice(0, 20);
    if (early.length) {
      html += H.disclosure('Letters typed early <span class="muted">· ' + early.length + ' pairs</span>', '<p class="muted">A letter that comes later in the word, typed too soon: a slip in the order of the letters rather than of the fingers, so it is kept out of the list above.</p>' +
        H.table(['Intended', 'Typed', 'Rate per press', 'Times', 'Recent examples'], early.map(function (r) {
          return H.row([H.cell(seq(r.expected)), H.cell(seq(r.actual))].concat(slipRate(r), [H.cell(esc(recentContexts(r)), 'ex')]));
        })), { id: 'premature', className: 'stack' });
    }
    var swaps = app.trainer.swaps({ minOpp: 10 }).filter(function (r) { return r.count >= 2; }).slice(0, 20);
    if (swaps.length) {
      html += '<section class="stack" id="swaps"><h3>Swapped letters</h3><p class="muted">Two neighbouring letters typed in the wrong order (a transposition, one of the error classes of Salthouse 1986). Each swap counts as one error. Rates are per occurrence of the intended pair.</p>' +
        H.table(['Intended', 'Typed', 'Rate', 'Times', 'Opportunities', 'Recent examples'], swaps.map(function (r) {
          return H.row([H.cell(seq(r.expected)), H.cell(seq(r.actual)), H.cell(pct(r.observedRate, 2), 'num'), H.cell(fix(r.count), 'num'),
            H.cell(r.opportunities, 'num'), H.cell(esc(recentContexts(r)), 'ex')]);
        })) + '</section>';
    }
    U.paint(html);
    if (layout) FT.chart.heatmap(document.getElementById('hmall'), FT.layout.grid(layout), FT.progress.sumKeys(app.trainer.history()));
  }
  // A slip pair's rate per press, the raw counts in its tooltip and beside it.
  function slipRate(r) {
    var times = slipCount(r.count) + ' of ' + r.opportunities;
    return ['<td class="num" title="' + esc(times + ' presses of ' + r.expected) + '">' + pct(r.observedRate, 2) + '</td>', H.cell(times, 'num muted')];
  }
  function slipCount(n) { return fix(n, n % 1 ? 1 : 0); }
  // The examples of one substitution, under the table.
  function showExamples(r) {
    var el = document.getElementById('subex');
    el.className = 'panel stack';
    U.fill(el, '<h2>' + seq(r.expected) + ' typed as ' + seq(r.actual) + '</h2>' +
      H.table(['Word', 'Where', 'Corrected', 'Exercise'], r.examples.map(function (e) {
        return H.row([H.cell(esc(e.word)), H.cell(seq(e.context)), H.cell(e.corrected ? 'yes' : 'no'), H.cell(esc(e.exercise || ''))]);
      })));
    var heading = el.querySelector('h2');
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }

  function recentContexts(r) { return r.examples.slice(0, 3).map(function (e) { return e.context; }).join(', '); }

  // ---------- history ----------
  // Progress over time: one small chart per measure, each on its own axis,
  // comparing only comparable sessions (FT.progress.series).
  var EFFORTLESS = FT.fluency.EFFORTLESS_MAX > 1 ? '1–' + FT.fluency.EFFORTLESS_MAX : '1';
  var PAUSES = 'pauses over ' + FT.timing.PAUSE_MS / 1000 + ' s';
  var EFFORTLESS_NEEDS = FT.fluency.MIN_SCALE_EXERCISES + ' relaxed exercises of ' + FT.history.MIN_WORDS + '+ words rated ' + EFFORTLESS;
  // One chart: its title and one sentence, the chart, then its data and its
  // method (about, and any further section) one step away.
  function chartCard(c, i) {
    var about = (c.about ? '<p class="muted">' + esc(c.about) + '</p>' : '') + (c.after || '');
    return '<section class="progress-chart stack"><h3>' + esc(c.title) + '</h3><p class="muted small lead">' + esc(c.lead) + '</p>' +
      '<div class="chart" id="pc' + i + '"></div><div class="row under">' +
      H.tableView(H.table(c.cols, c.rows.slice().reverse().map(function (p) { return H.row(c.cells(p).map(function (v) { return H.cell(v, 'num'); })); }))) +
      (about ? H.disclosure('About this measure', about, { className: 'about' }) : '') + '</div></section>';
  }
  function progressCharts(history) {
    var series = FT.progress.series(history), date = function (t) { return new Date(t).toLocaleDateString(); };
    // The headline measures first; the others fold under More measures.
    // lead: one sentence under the title; about: the method, one step away.
    var charts = [
      { title: 'Relaxed speed', headline: true, lead: 'Median WPM per day of relaxed practice.',
        about: 'Fill shows rated effort: hollow = not rated, light = little effort, solid = maximum.',
        label: 'Relaxed WPM', color: '--series-1', min: 1, rows: series.relaxed,
        point: function (p) { return { t: p.startedAt, y: p.wpm, fill: p.effort == null ? null : (p.effort - 1) / 4,
          tip: '<b>' + fix(p.wpm) + ' WPM</b> · ' + esc(date(p.startedAt)) + '<br>' + p.exercises + ' session' + (p.exercises > 1 ? 's' : '') + ', effort ' + (p.effort == null ? 'not rated' : fix(p.effort, 1) + ' (' + EFFORT[Math.round(p.effort) - 1][1].toLowerCase() + ')') }; },
        cols: ['Day', 'WPM', 'Accuracy', 'Effort'], cells: function (p) { return [esc(date(p.startedAt)), fix(p.wpm), pct(p.firstAttemptAccuracy), p.effort == null ? '–' : fix(p.effort, 1)]; } },
      { title: 'Accuracy', headline: true, lead: 'Accuracy (first try) per day of relaxed practice: corrected errors count too.',
        label: 'Relaxed accuracy (first try)', color: '--series-1', min: 1, yMax: 1, rows: series.relaxed, fmt: function (v) { return pct(v, 1); },
        point: function (p) { return { t: p.startedAt, y: p.firstAttemptAccuracy, tip: '<b>' + pct(p.firstAttemptAccuracy) + '</b> · ' + esc(date(p.startedAt)) }; },
        cols: ['Day', 'Accuracy'], cells: function (p) { return [esc(date(p.startedAt)), pct(p.firstAttemptAccuracy)]; } },
      { title: 'Benchmark', headline: true, lead: 'Median of each complete set of 3 one-minute trials; the line shows the range of the trials.',
        label: 'Benchmark WPM', color: '--series-2', min: 1, rows: series.benchmark,
        point: function (p) { return { t: p.startedAt, y: p.wpm, lo: p.min, hi: p.max, tip: '<b>' + fix(p.wpm) + ' WPM</b> · ' + esc(date(p.startedAt)) + '<br>trials ' + fix(p.min) + '–' + fix(p.max) + ', accuracy ' + pct(p.firstAttemptAccuracy) }; },
        cols: ['Day', 'Median WPM', 'Range', 'Accuracy'], cells: function (p) { return [esc(date(p.startedAt)), fix(p.wpm), fix(p.min) + '–' + fix(p.max), pct(p.firstAttemptAccuracy)]; } },
      { title: 'Fluency (experimental)', brief: 'fluency',
        lead: 'An experimental prediction, not a measurement: the relaxed speed your current sequence statistics predict on a fixed text of ' + FT.fluency.REFERENCE_WORDS.toLocaleString('en') + ' common words.',
        about: 'Our own method (design choice), not a validated one: each keystroke takes the time your statistics give it after the letters before it, as in keystroke-level models (Card, Moran & Newell 1980) with context-dependent timing (Gentner 1983; Salthouse 1986), and each error costs what your corrections cost in your recent relaxed practice (measured below). ' +
          'Errors cost time around the mistake, not just a keystroke (Salthouse 1986; post-error slowing, Kalfaoğlu & Stafford 2014), and faster typists mainly make fewer errors (Dhakal et al. 2018). ' +
          'Solid: predicted speed, at the pace of your recent relaxed practice. Dashed: effortless speed, where the error rates still come from all your practice; only its speed scale and correction cost come from the exercises you rated effort ' + EFFORTLESS + '. ' +
          'Both add your share of ' + PAUSES + ', since measured speed includes them. ' +
          'Shown once ' + pct(FT.progress.FLUENCY_MIN_COVERAGE, 0) + ' of the text is timed from sequences of two letters or more (coverage). Trust it only as far as the benchmark check below shows.',
        label: 'Predicted WPM', color: '--series-1', min: 1, rows: series.fluency,
        point: function (p) { return { t: p.startedAt, y: p.wpm, tip: '<b>' + fix(p.wpm) + ' WPM predicted</b> · ' + esc(date(p.startedAt)) + '<br>effortless ' + (p.effortlessWpm == null ? 'not yet (needs ' + EFFORTLESS_NEEDS + ')' : fix(p.effortlessWpm) + ' WPM') + ', coverage ' + pct(p.coverage, 0) +
          (p.keysChanged ? '<br>multi-letter keys changed' : '') }; },
        second: { color: '--series-2', points: series.fluency.filter(function (p) { return p.effortlessWpm != null; }).map(function (p) { return { t: p.startedAt, y: p.effortlessWpm }; }) },
        cols: ['Day', 'Predicted WPM', 'Effortless WPM', 'Coverage'], cells: function (p) { return [esc(date(p.startedAt)), fix(p.wpm), fix(p.effortlessWpm), pct(p.coverage, 0)]; },
        after: timeBreakdownLine(FT.fluency.breakdown(history)) + fluencyCheckSection(FT.progress.fluencyCheck(history), date) },
      { title: 'Common-pair timing', brief: 'common-pair timing',
        lead: 'Median time between the letters of the ' + FT.timing.COMMON_PAIRS.length + ' most common pairs inside words, in relaxed practice, weighted by how many such pairs each exercise had.',
        about: 'Lower is faster. Pairs typed with a multi-letter key (such as th) are not timed. Log scale.',
        label: 'Common-pair timing in ms', color: '--series-1', min: 1, rows: series.commonPairMs, log: true, fmt: function (v) { return Math.round(v) + ''; },
        point: function (p) { return { t: p.startedAt, y: p.commonPairMs, tip: '<b>' + fix(p.commonPairMs) + ' ms</b> · ' + esc(date(p.startedAt)) }; },
        cols: ['Day', 'ms'], cells: function (p) { return [esc(date(p.startedAt)), fix(p.commonPairMs)]; } },
      { title: 'Effort signals (experimental)', brief: 'effort signals',
        lead: 'Measured signals that tend to fall as typing becomes automatic: the extra time before the first letter of each word (charted, research: Crump et al. 2019) and how uneven your keystroke timing is (rhythm, in the table and tooltip; Kalfaoglu & Stafford 2014).',
        about: 'They are proxies, not a validated measure of effort: compare them with your own ratings.',
        label: 'Extra time at word starts in ms', color: '--series-2', min: 1, rows: series.relaxed.filter(function (p) { return p.wordStartMs != null; }), fmt: function (v) { return Math.round(v) + ''; },
        point: function (p) { return { t: p.startedAt, y: p.wordStartMs, tip: '<b>+' + fix(p.wordStartMs) + ' ms</b> at word starts · ' + esc(date(p.startedAt)) + '<br>rhythm variation ' + fix(p.rhythmCv, 2) + ', rated effort ' + (p.effort == null ? 'not rated' : fix(p.effort, 1)) }; },
        cols: ['Day', 'Word starts (ms)', 'Rhythm', 'Rated effort'], cells: function (p) { return [esc(date(p.startedAt)), fix(p.wordStartMs), fix(p.rhythmCv, 2), p.effort == null ? '–' : fix(p.effort, 1)]; } },
    ];
    // charts without enough data are named once instead of shown empty
    var waiting = charts.filter(function (c) { return c.rows.length < c.min; }).map(function (c) { return c.title; });
    var shown = charts.map(function (c, i) { return c.rows.length < c.min ? null : { chart: c, html: chartCard(c, i) }; }).filter(Boolean);
    var headline = shown.filter(function (s) { return s.chart.headline; }), others = shown.filter(function (s) { return !s.chart.headline; });
    var cards = function (list) { return list.map(function (s) { return s.html; }).join(''); };
    var html = '<section class="stack">' +
      (waiting.length ? '<p class="muted">Not enough data yet for: ' + esc(waiting.join(', ')) + '.</p>' : '') +
      '<div class="progress-grid headline">' + cards(headline) + '</div>' +
      (others.length ? H.disclosure('More measures <span class="muted">· ' + esc(others.map(function (s) { return s.chart.brief; }).join(', ')) + '</span>',
        '<div class="progress-grid">' + cards(others) + '</div>', { id: 'moremeasures', className: 'stack' }) : '') + '</section>';
    return { html: html, draw: function () {
      charts.forEach(function (c, i) {
        var el = document.getElementById('pc' + i);
        if (el) FT.chart.progress(el, { points: c.rows.map(c.point), second: c.second, log: c.log, yMax: c.yMax, color: c.color, fmt: c.fmt, label: c.label });
      });
    } };
  }

  // Where recent relaxed typing time goes, measured (FT.fluency.breakdown).
  function timeBreakdownLine(b) {
    if (!b) return '';
    return '<p id="timebreakdown">Flow speed ' + fix(b.flowWpm) + ' WPM: your speed if corrections took no extra time, without ' + PAUSES + ' · ' +
      PAUSES + ' and corrections take ' + pct(b.pauseShare + b.correctionShare, 0) + ' of your typing time' +
      (b.errorCostMs == null ? '' : ' (about ' + fix(b.errorCostMs / 1000, 1) + ' s per error)') +
      '<span class="muted"> · measured over your last ' + b.exercises + ' relaxed exercise' + (b.exercises > 1 ? 's' : '') + ', not predicted.</span></p>';
  }

  // The fluency index against each benchmark set (FT.progress.fluencyCheck):
  // the prediction made before the set, the measured median, and the typical error.
  function fluencyCheckSection(check, date) {
    var signed = function (x) { return (x >= 0 ? '+' : '−') + fix(Math.abs(x), 1); };
    var typical = function (name, e) {
      return e ? name + ' was off by ' + fix(e.meanAbsoluteError, 1) + ' WPM on average over ' + e.sets + ' benchmark' + (e.sets > 1 ? 's' : '') +
        ', ' + (e.meanError >= 0 ? 'over' : 'under') + '-predicting by ' + fix(Math.abs(e.meanError), 1) + ' WPM on the whole.' : '';
    };
    if (!check.rows.length) {
      return '<p class="muted" id="fluencycheck">Benchmark check: none yet. After your next benchmark, the prediction made before it is compared with what you measured.</p>';
    }
    return '<section class="stack" id="fluencycheck"><h4>Benchmark check: predicted vs measured</h4>' +
      '<p class="muted">' + esc([typical('Predicted speed', check.fluency), typical('Effortless speed', check.effortless)].filter(Boolean).join(' ')) + '</p>' +
      H.table(['Benchmark', 'Measured', 'Predicted', 'Error', 'Effortless', 'Error'], check.rows.slice().reverse().map(function (r) {
        return H.row([H.cell(esc(date(r.startedAt)), 'num'), H.cell(fix(r.measured), 'num'), H.cell(fix(r.fluencyWpm), 'num'), H.cell(signed(r.fluencyWpm - r.measured), 'num'),
          H.cell(fix(r.effortlessWpm), 'num'), H.cell(r.effortlessWpm == null ? '–' : signed(r.effortlessWpm - r.measured), 'num')]);
      }), { className: 'compact' }) + '</section>';
  }

  // The exercise log: the latest LOG_RECENT in the main columns, or every
  // exercise in every column (a). Design choice: 8, about a week of practice.
  var LOG_RECENT = 8;
  var LOG_COLUMNS = [
    ['When', function (e) { return H.cell('<button type="button" class="rowbtn" data-row data-past="' + esc(e.id) + '">' + esc(FT.fmt.dateTime(e.startedAt)) + '</button>', 'num nowrap'); }],
    ['Exercise', function (e) { return H.cell(esc(FT.exercises.name(e.type))); }],
    ['Min', function (e) { return H.cell(fix(e.durationMs / 60000, 1), 'num'); }],
    ['WPM', function (e) { return H.cell(fix(e.wpm), 'num'); }],
    ['Accuracy', function (e) { return H.cell(pct(e.firstAttemptAccuracy), 'num'); }],
    ['Effort', function (e) { return H.cell(e.effort || '–', 'num'); }],
    ['Random words', function (e) { return H.cell(pct(e.randomFirstAttemptAccuracy), 'num'); }, 'all'],
    ['Hesitation', function (e) { return H.cell(pct(e.hesitationRate), 'num'); }, 'all'],
    ['Rhythm', function (e) { return H.cell(fix(e.rhythmCv, 2), 'num'); }, 'all'],
    ['Vocabulary', function (e) { return H.cell(Math.round(e.frontier), 'num'); }, 'all'],
  ];
  var logAll = false;
  function viewHistory() {
    logAll = false;
    showProgress();
  }
  // Progress with the log as it was left: the way back from a past exercise.
  function showProgress() { U.screen('insights/progress', { render: renderHistory }); }
  function toggleLog() {
    logAll = !logAll;
    U.redraw();
    document.getElementById('logall').focus();
  }
  function logSection(newestFirst) {
    var columns = LOG_COLUMNS.filter(function (c) { return logAll || !c[2]; });
    var entries = logAll ? newestFirst : newestFirst.slice(0, LOG_RECENT);
    var html = '<section class="stack"><h2>' + (logAll ? 'All exercises' : 'Recent exercises') + '</h2><p class="muted">Newest first; open a row for its summary.' +
      (logAll ? ' “Random words” is the unbiased sample that targeted practice never influences.' : '') + ' ' +
      U.legendKey({ id: 'logall', key: 'a', onClick: toggleLog, label: logAll ? 'Recent only' : 'All ' + newestFirst.length + ' exercises, all columns',
        help: logAll ? 'Recent exercises only' : 'All exercises and columns' }) + '</p></section>';
    if (!newestFirst.length) return html + '<p class="panel">No exercises yet.</p>';
    return html + H.table(columns.map(function (c) { return c[0]; }), entries.map(function (entry) {
      return H.row(columns.map(function (c) { return c[1](entry); }), ' class="clickable"' + U.action(function () { return openPast(entry.id); }));   // the date button inside handles the keyboard
    }), { id: 'alltable' });
  }
  function renderHistory() {
    var pc = progressCharts(app.trainer.history());
    U.paint('<section class="stack">' + U.sectionHead('insights') + '</section>' + pc.html +
      conditionsSection(app.trainer.conditions()) + logSection(app.trainer.history().slice().reverse()));
    pc.draw();
  }
  // How relaxed practice differs with and without each condition (measurement only).
  function conditionsSection(rows) {
    var signed = function (x, digits, unit) { return (x >= 0 ? '+' : '−') + fix(Math.abs(x), digits) + unit; };
    var interval = function (d, scale, digits, unit) { return signed(d.difference * scale, digits, unit) + ' <span class="muted">(' + signed(d.low * scale, digits, '') + ' to ' + signed(d.high * scale, digits, unit) + ')</span>'; };
    return '<section class="stack"><h2>Conditions</h2><p class="muted small">Relaxed practice with each tag of yours, or at each time of day, against the rest.</p>' +
      (rows.length ? H.table(['Condition', 'Exercises with / without', 'WPM', 'Accuracy (first try)'], rows.map(function (r) {
        return H.row([H.cell(r.automatic ? esc(r.tag) + ' <span class="muted">(time of day)</span>' : '#' + esc(r.tag)), H.cell(r.with.n + ' / ' + r.without.n, 'num'),
          H.cell(interval(r.wpm, 1, 1, ''), 'num'), H.cell(interval(r.accuracy, 100, 1, ' pts'), 'num')]);
      }))
        : '<p class="panel">Not enough data yet: a condition is compared once ' + FT.conditions.MIN_EACH + ' relaxed exercises have it and ' + FT.conditions.MIN_EACH + ' do not. Add tags at the end of a sitting.</p>') +
      H.disclosure('About this comparison', '<p class="muted">The difference, and the range it lies in with ' + pct(FT.conditions.CONFIDENCE, 0) + ' confidence (bootstrap; Efron &amp; Tibshirani 1993). ' +
        'Tags that always come together, or that changed along with your progress, cannot be told apart.</p>', { id: 'conditionsabout', className: 'about' }) + '</section>';
  }
  // A past exercise's summary, rebuilt from its stored record (nothing is learned).
  function openPast(id) {
    return app.store.getSession(id).then(U.onThisScreen(function (raw) {
      if (!raw) { U.flash('The record of this exercise is no longer stored.'); return; }
      U.viewSummary(app.trainer.summarize(raw), { past: true, back: showProgress, opts: {} });
    })).catch(U.storageError);
  }

  U.route('insights/focus', viewSequences);
  U.route('insights/errors', viewErrors);
  U.route('insights/progress', viewHistory);
})(globalThis.FT);
