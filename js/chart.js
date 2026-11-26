// Chart geometry and the exercise timeline chart (inline SVG, no library).
(function (FT) {
  'use strict';
  var esc = FT.fmt.esc, fix = FT.fmt.fix;

  // The smallest 1, 2 or 5 × 10^k step at least as large as raw.
  function step125(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }
  function niceStep(range) { return step125(range / 4); }
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
        fix(p.burst) + ' WPM this word · ' + fix(p.running) + ' average' + (p.error ? '<br><span style="color:var(--err)">× error on the first try</span>' : '');
      var r = root.getBoundingClientRect(), px = cx * r.width / W;
      var left = px + 14, w = tip.offsetWidth;
      if (left + w > r.width) left = px - 14 - w;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = '24px';
    }
    hit.addEventListener('pointermove', function (e) { showPoint(at(e)); });
    hit.addEventListener('pointerleave', function () { g.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  // ---- scales and ticks (pure) ----
  function scale(domain, range, log) {
    var f = log ? Math.log : function (v) { return v; };
    var d0 = f(domain[0]), d1 = f(domain[1]), r0 = range[0], r1 = range[1];
    return function (v) { return d1 === d0 ? (r0 + r1) / 2 : r0 + (f(v) - d0) / (d1 - d0) * (r1 - r0); };
  }
  function ticks(lo, hi) {
    var step = step125((hi - lo) / 5 || 1), out = [];
    for (var v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  var LOG_MANTISSA = [1, 1.5, 2, 3, 5, 8];
  function logTicks(lo, hi) {
    var all = [];
    for (var e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)); e++) {
      LOG_MANTISSA.forEach(function (m) { all.push(+(m * Math.pow(10, e)).toPrecision(6)); });
    }
    var first = all.filter(function (v) { return v <= lo; }).pop(), last = all.filter(function (v) { return v >= hi; })[0];
    var out = all.filter(function (v) { return v >= first && v <= last; });
    // When the data covers little of that span (or too few ticks), use round
    // linear values instead, still placed on the log scale.
    var covered = Math.log(hi / lo) / Math.log(last / first);
    return out.length >= 3 && covered >= 0.4 ? out : ticks(lo, hi);
  }
  // Ticks at local midnights (like the per-day grouping in FT.progress).
  var DAY = 864e5, DAY_STEPS = [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365];
  function dayTicks(t0, t1) {
    var span = Math.max(1, (t1 - t0) / DAY), step = DAY_STEPS.filter(function (s) { return span / s <= 6; })[0] || 365;
    var d = new Date(t0), out = [];
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() || d.getMinutes() || d.getSeconds() ? 1 : 0));
    for (; d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step)) out.push(d.getTime());
    return out;
  }

  // ---- progress chart: one series over time, one axis ----
  // cfg: { points: [{ t, y, lo, hi, fill (0..1 or null), tip }], log, yMin, yMax,
  //        color: CSS var name, fmt: value formatter, label: axis caption }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(t) { var d = new Date(t); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function progress(el, cfg) {
    var pts = cfg.points;
    var W = Math.max(280, el.clientWidth || 480), H = 190, L = 46, R = 14, T = 12, B = 26;
    var ys = [];
    pts.forEach(function (p) { ys.push(p.y); if (p.lo != null) ys.push(p.lo, p.hi); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (cfg.yMin != null) lo = Math.min(lo, cfg.yMin);
    if (cfg.yMax != null) hi = Math.max(hi, cfg.yMax);
    var tk = cfg.log ? logTicks(lo, hi) : ticks(lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.1);
    if (cfg.yMax != null) tk = tk.filter(function (v) { return v <= cfg.yMax; });
    var y = scale([tk[0], tk[tk.length - 1]], [H - B, T], cfg.log);
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t1 - t0 < DAY) { t0 -= DAY; t1 += DAY; }
    var x = scale([t0, t1], [L + 8, W - R - 8]);
    var fmt = cfg.fmt || function (v) { return fix(v); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.label) + ' over time"><g class="axis">';
    tk.forEach(function (v) {
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(fmt(v)) + '</text>';
    });
    dayTicks(t0, t1).forEach(function (t) { svg += '<text x="' + x(t) + '" y="' + (H - 6) + '" text-anchor="middle">' + dayLabel(t) + '</text>'; });
    svg += '</g>';
    var color = 'var(' + (cfg.color || '--series-1') + ')';
    if (pts.length > 1) svg += '<path class="trend" style="stroke:' + color + '" d="' + monotonePath(pts.map(function (p) { return [x(p.t), y(p.y)]; })) + '"/>';
    pts.forEach(function (p, i) {
      if (p.lo != null) svg += '<line class="range" style="stroke:' + color + '" x1="' + x(p.t) + '" x2="' + x(p.t) + '" y1="' + y(p.lo) + '" y2="' + y(p.hi) + '"/>';
      var fill = p.fill === undefined ? 1 : p.fill;
      svg += '<circle class="pt" data-i="' + i + '" cx="' + x(p.t) + '" cy="' + y(p.y) + '" r="5" style="stroke:' + color + ';fill:' +
        (fill == null ? 'var(--surface)' : color) + ';fill-opacity:' + (fill == null ? 1 : 0.15 + 0.85 * fill) + '"/>';
    });
    svg += '<line class="cross" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/>' +
      '<rect class="hit" x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>';
    el.innerHTML = svg + '<div class="tip" hidden></div>';
    var root = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('line.cross');
    el.querySelector('.hit').addEventListener('pointermove', function (e) {
      var r = root.getBoundingClientRect(), sx = (e.clientX - r.left) * (W / r.width), best = 0;
      pts.forEach(function (p, i) { if (Math.abs(x(p.t) - sx) < Math.abs(x(pts[best].t) - sx)) best = i; });
      var p = pts[best], px = x(p.t) * r.width / W;
      cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = p.tip;
      var left = px + 12;
      if (left + tip.offsetWidth > r.width) left = px - 12 - tip.offsetWidth;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '8px';
    });
    el.querySelector('.hit').addEventListener('pointerleave', function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }

  // ---- keyboard heatmap ----
  // grid: FT.layout.grid(); stats: { keys: {press: [n, errors]}, land: {char: n} }.
  // Two views: first-attempt error rate on the intended key, or where wrong
  // presses landed. One hue (the error colour), light to dark; keys with too
  // few presses stay neutral.
  var MIN_PRESSES = 10, MIN_SCALE = 0.05;
  // Per-cell values and shades (pure). Capitals count towards their key.
  //   err:  first-attempt error rate; keys with < MIN_PRESSES presses are not
  //         rated; shade = rate / max rate, the max never below 5%;
  //   land: wrong presses that landed on the key; shade = count / max count.
  function heatValues(grid, stats, mode) {
    var k = stats.keys || {}, l = stats.land || {};
    var both = function (map, key, add) {
      var up = key.toUpperCase();
      return add(map[key], up !== key ? map[up] : undefined);
    };
    var vals = grid.cells.map(function (c) {
      var p = both(k, c.key, function (a, b) { a = a || [0, 0]; b = b || [0, 0]; return [a[0] + b[0], a[1] + b[1]]; });
      var landed = both(l, c.key, function (a, b) { return (a || 0) + (b || 0); });
      var rated = p[0] >= MIN_PRESSES;
      return { key: c.key, label: c.label, n: p[0], err: p[1], rate: rated ? p[1] / p[0] : null, landed: landed,
        rated: mode === 'land' || rated, value: mode === 'land' ? landed : rated ? p[1] / p[0] : null };
    });
    var max = vals.reduce(function (a, v) { return v.value != null ? Math.max(a, v.value) : a; }, 0);
    if (mode === 'err') max = Math.max(max, MIN_SCALE);
    vals.forEach(function (v) { v.shade = v.value == null || !max ? 0 : v.value / max; });
    vals.max = max;
    return vals;
  }
  function heatmap(el, grid, stats, opts) {
    var mode = (opts && opts.mode) || 'err';
    function render() {
      var U = 42, G = 4, W = grid.width * U, H = grid.height * U;
      var vals = heatValues(grid, stats, mode), max = vals.max;
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Keyboard heatmap: ' +
        (mode === 'err' ? 'error rate per key (first try)' : 'where wrong presses landed') + '">';
      grid.cells.forEach(function (c, i) {
        var v = vals[i], w = c.w * U - G;
        svg += '<g data-i="' + i + '"><rect class="key' + (v.rated ? '' : ' few') + '" x="' + (c.x * U) + '" y="' + (c.y * U) + '" width="' + w + '" height="' + (U - G) + '" rx="6" ' +
          'style="fill-opacity:' + (v.rated ? 0.12 + 0.88 * Math.sqrt(v.shade) : 1) + '"/>' +
          '<text x="' + (c.x * U + w / 2) + '" y="' + (c.y * U + (U - G) / 2 + 5) + '" text-anchor="middle" class="' + (Math.sqrt(v.shade) > 0.55 ? 'on-dark' : '') + '">' + esc(c.label) + '</text></g>';
      });
      svg += '</svg>';
      var legend = mode === 'err'
        ? 'Shade: error rate on the first try, from 0% (lightest) to ' + (100 * max).toFixed(1) + '% (darkest). Dashed keys: fewer than ' + MIN_PRESSES + ' presses so far. Characters not on your layout are not shown.'
        : 'Shade: how many wrong presses landed on each key (darkest: ' + Math.round(max) + ').';
      el.innerHTML = '<div class="tabs" role="group">' +
        '<button type="button" data-mode="err" aria-pressed="' + (mode === 'err') + '">Errors on the intended key</button>' +
        '<button type="button" data-mode="land" aria-pressed="' + (mode === 'land') + '">Where wrong presses land</button></div>' +
        '<div class="hm-wrap">' + svg + '<div class="tip" hidden></div></div><p class="muted">' + esc(legend) + '</p>' + heatTable(vals);
      el.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { mode = b.dataset.mode; render(); }; });
      bindHeatTips(el, vals);
    }
    render();
  }
  function heatTable(vals) {
    return '<details class="tableview"><summary>Show as table</summary><div class="tablewrap"><table><thead><tr><th>Key</th><th>Presses</th><th>First-attempt errors</th><th>Rate</th><th>Wrong presses landed here</th></tr></thead><tbody>' +
      vals.map(function (v) {
        return '<tr><td>' + esc(v.label) + '</td><td class="num">' + v.n + '</td><td class="num">' + fix(v.err, 0) + '</td><td class="num">' +
          (v.rate == null ? '–' : (100 * v.rate).toFixed(1) + '%') + '</td><td class="num">' + fix(v.landed, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }
  function bindHeatTips(el, vals) {
    var tip = el.querySelector('.tip'), wrap = el.querySelector('.hm-wrap');
    el.querySelectorAll('svg g[data-i]').forEach(function (g) {
      g.addEventListener('pointerenter', function () {
        var v = vals[+g.dataset.i];
        tip.hidden = false;
        tip.innerHTML = '<b>' + esc(v.label) + '</b><br>' + (v.n ? (v.rate == null ? v.n + ' presses (too few to rate)' : (100 * v.rate).toFixed(1) + '% wrong first attempts (' + fix(v.err, 0) + ' of ' + v.n + ')') : 'not typed yet') +
          '<br>' + fix(v.landed, 0) + ' wrong presses landed here';
        var r = g.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        tip.style.left = Math.max(0, Math.min(wr.width - tip.offsetWidth, r.left - wr.left)) + 'px';
        tip.style.top = (r.bottom - wr.top + 6) + 'px';
      });
      g.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
  }

  FT.chart = { heatValues: heatValues, dayLabel: dayLabel, heatmap: heatmap, progress: progress, niceStep: niceStep, monotonePath: monotonePath, timeline: timeline,
    scale: scale, ticks: ticks, logTicks: logTicks, dayTicks: dayTicks };
})(globalThis.FT);
