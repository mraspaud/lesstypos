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

  FT.fmt = { storageLine: storageLine, esc: esc, seq: seq, pct: pct, fix: fix, pill: pill, lateNote: lateNote };
})(globalThis.FT);
