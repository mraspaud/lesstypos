// Small HTML/number formatting helpers shared by the views.
(function (FT) {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function seq(k) { return '<span class="seq">' + esc(String(k).replace(/ /g, '␣')) + '</span>'; }
  function pct(x, d) { return x == null ? '–' : (100 * x).toFixed(d == null ? 1 : d) + '%'; }
  function fix(x, d) { return x == null || !isFinite(x) ? '–' : x.toFixed(d == null ? 0 : d); }
  function pill(name) { return name ? '<span class="pill ' + esc(name) + '">' + esc(name) + '</span>' : ''; }

  function list(items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  // Keys the keyboard sends late (FT.timing.lateKeys), as shown on the Sequences page.
  function lateNote(chars) {
    if (!chars || !chars.length) return '';
    return 'Your keyboard sends ' + list(chars.map(seq)) + ' late: tap-hold keys arrive only once the keyboard has decided between tap and hold. ' +
      'Their single-key speed is not judged; their errors are, and so is the timing of longer sequences ending on them, which share the same delay.';
  }

  function size(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
  }
  function storageLine(z) {
    return z.sessions + (z.sessions === 1 ? ' exercise takes ' : ' exercises take ') + size(z.sessionBytes) +
      '; statistics derived from them take ' + size(z.profileBytes) + '.';
  }

  // One name per thing: a sequence's training stage, and the model's judgement.
  var STAGES = { weak: 'in training', improving: 'improving', consolidating: 'consolidating', mastered: 'mastered' };
  var STATES = { weak: 'more errors', hesitant: 'slower', emerging: 'seen in 1 session', ok: 'fine',
    insufficient: 'too few yet', redundant: 'same as shorter' };
  function stageLabel(name) { return STAGES[name] || name; }
  function stateLabel(name) { return STATES[name] || name; }
  function labelled(name, text) { return name ? '<span class="pill ' + esc(name) + '">' + esc(text) + '</span>' : ''; }
  function stagePill(name) { return labelled(name, stageLabel(name)); }
  function statePill(name) { return labelled(name, stateLabel(name)); }
  function statusLegend() {
    return '<b>In training</b>: practised often. <b>Improving</b>: no longer worse, still practised. ' +
      '<b>Consolidating</b>: checked at growing intervals. <b>Mastered</b>: checked rarely. ' +
      '<b>Slower</b> or <b>more errors</b>: credibly worse than the shorter sequence in other words, in at least 2 sessions. ' +
      '<b>Seen in 1 session</b>: worse so far, waiting for a second session.';
  }

  FT.fmt = { stageLabel: stageLabel, stateLabel: stateLabel, stagePill: stagePill, statePill: statePill, statusLegend: statusLegend, storageLine: storageLine, esc: esc, seq: seq, pct: pct, fix: fix, pill: pill, lateNote: lateNote };
})(globalThis.FT);
