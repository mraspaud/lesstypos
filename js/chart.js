// Chart geometry and the exercise timeline chart (inline SVG, no library).
(function (FT) {
  'use strict';
  var esc = FT.fmt.esc, fix = FT.fmt.fix;

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
  // Exercise timeline: one WPM axis; error marks are annotations, not a scale.
  function timeline(el, tl) {
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

  FT.chart = { niceStep: niceStep, monotonePath: monotonePath, timeline: timeline };
})(globalThis.FT);
