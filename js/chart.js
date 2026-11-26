// Charts: pure geometry (scales, ticks, paths and positions, tested in Node)
// and its rendering as inline SVG (no library). Callers pass the element to
// draw into; a chart looks up nothing outside it.
(function (FT) {
  'use strict';
  var esc = FT.fmt.esc, fix = FT.fmt.fix;

  // ======== geometry (pure) ========

  // The smallest 1, 2 or 5 × 10^k step at least as large as raw.
  function step125(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }
  function niceStep(range) { return step125(range / 4); }
  // Monotone cubic curves (Fritsch-Carlson), which never overshoot the data.
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
    if (!(lo > 0) || !(hi > lo)) return ticks(lo, hi); // a log scale needs positive values
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
  var DAY = FT.days.MS, DAY_STEPS = [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365];
  function dayTicks(t0, t1) {
    var span = Math.max(1, (t1 - t0) / DAY), step = DAY_STEPS.filter(function (s) { return span / s <= 6; })[0] || 365;
    var out = [];
    for (var t = FT.days.midnightFrom(t0); t <= t1; t = FT.days.add(t, step)) out.push(t);
    return out;
  }

  // A tooltip's left edge beside a point at px: to its right, or to its left
  // when it would overflow the box.
  function tipBeside(px, gap, tipWidth, boxWidth) {
    var left = px + gap;
    if (left + tipWidth > boxWidth) left = px - gap - tipWidth;
    return Math.max(0, left);
  }
  // A tooltip's left edge at `left`, kept inside the box.
  function tipWithin(left, tipWidth, boxWidth) { return Math.max(0, Math.min(boxWidth - tipWidth, left)); }

  // Per-word speed is lightly smoothed ([1 2 1] / 4 over neighbouring words);
  // the tooltip and table keep the raw values.
  function smoothedBursts(tl) {
    return tl.map(function (p, k) {
      var a = tl[k - 1], c = tl[k + 1], sum = 2 * (p.burst || 0), w = 2;
      if (a && a.burst != null) { sum += a.burst; w++; }
      if (c && c.burst != null) { sum += c.burst; w++; }
      return p.burst == null ? null : sum / w;
    });
  }

  // Exercise timeline: one WPM axis over the words; error marks are
  // annotations, not a scale. tl: FT.exerciseStats.timeline.
  function timelineGeometry(tl, clientWidth) {
    var W = Math.max(300, clientWidth || 600), H = 230, L = 44, R = 54, T = 22, B = 26;
    var bursts = tl.map(function (p) { return p.burst; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    var p98 = bursts[Math.floor(0.98 * (bursts.length - 1))] || 0;
    var top = Math.max(p98, Math.max.apply(null, tl.map(function (p) { return p.running || 0; }))) * 1.1 || 10;
    var step = niceStep(top), yMax = Math.ceil(top / step) * step;
    var n = tl.length;
    var x = function (i) { return L + (W - L - R) * (n === 1 ? 0.5 : (i - 1) / (n - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - Math.min(v, yMax) / yMax); };
    var yTicks = [];
    for (var v = 0; v <= yMax + 1e-9; v += step) yTicks.push({ value: v, y: y(v), label: String(Math.round(v)) });
    var xs = Math.max(1, Math.round(niceStep(Math.max(n - 1, 1) * 0.8))), xTicks = [];
    for (var i = 1; i <= n; i += (i === 1 && xs > 1 ? xs - 1 : xs)) xTicks.push({ index: i, x: x(i) });
    var smooth = smoothedBursts(tl);
    var path = function (value) {
      return monotonePath(tl.map(function (p, k) { var v = value(p, k); return v == null ? null : [x(p.i), y(v)]; }).filter(Boolean));
    };
    var last = tl[n - 1];
    return {
      width: W, height: H, left: L, right: W - R, top: T, bottom: H - B, x: x, y: y, yTicks: yTicks, xTicks: xTicks,
      burstPath: path(function (p, k) { return smooth[k]; }),
      runningPath: path(function (p) { return p.running; }),
      errorMarks: tl.filter(function (p) { return p.error; }).map(function (p) { return { x: x(p.i), y: T - 11 }; }),
      endLabel: last.running != null ? { x: x(n) + 8, y: y(last.running) + 4, text: String(Math.round(last.running)) } : null,
      // The word under svg x-coordinate sx.
      pointAt: function (sx) {
        var k = Math.round(1 + (sx - L) / (W - L - R) * (n - 1));
        return tl[Math.min(n, Math.max(1, k)) - 1];
      },
    };
  }

  // Progress chart: one series over time, one axis.
  // cfg: { points: [{ t, y, lo, hi, fill (0..1 or null), tip }], log, yMin, yMax }
  function progressGeometry(cfg, clientWidth) {
    var pts = cfg.points;
    var W = Math.max(280, clientWidth || 480), H = 190, L = 46, R = 14, T = 12, B = 26;
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
    return {
      width: W, height: H, left: L, right: W - R, top: T, bottom: H - B, x: x, y: y,
      yTicks: tk.map(function (v) { return { value: v, y: y(v) }; }),
      dayTicks: dayTicks(t0, t1).map(function (t) { return { t: t, x: x(t) }; }),
      trendPath: pts.length > 1 ? monotonePath(pts.map(function (p) { return [x(p.t), y(p.y)]; })) : null,
      // The point nearest to svg x-coordinate sx.
      pointAt: function (sx) {
        var best = 0;
        pts.forEach(function (p, i) { if (Math.abs(x(p.t) - sx) < Math.abs(x(pts[best].t) - sx)) best = i; });
        return pts[best];
      },
    };
  }

  // Keyboard heatmap. grid: FT.layout.grid(); stats: { keys: {press: [n,
  // errors]}, land: {char: n} }. Two views: first-attempt error rate on the
  // intended key, or where wrong presses landed. One hue (the error colour),
  // light to dark; keys with too few presses stay neutral.
  var MIN_PRESSES = 10, MIN_SCALE = 0.05;
  // Per-cell values and shades. Capitals count towards their key.
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
  var KEY_UNIT = 42, KEY_GAP = 4;
  // Key rectangles and label positions in svg units; the fill follows the
  // square root of the shade.
  function heatCells(grid, vals) {
    var U = KEY_UNIT, G = KEY_GAP;
    return {
      width: grid.width * U, height: grid.height * U,
      cells: grid.cells.map(function (c, i) {
        var v = vals[i], w = c.w * U - G, tone = Math.sqrt(v.shade);
        return { x: c.x * U, y: c.y * U, width: w, height: U - G, labelX: c.x * U + w / 2, labelY: c.y * U + (U - G) / 2 + 5,
          opacity: v.rated ? 0.12 + 0.88 * tone : 1, onDark: tone > 0.55 };
      }),
    };
  }

  // ======== rendering (SVG and DOM) ========

  function axisLines(geo, label) {
    return geo.yTicks.map(function (tk) {
      return '<line class="grid" x1="' + geo.left + '" x2="' + geo.right + '" y1="' + tk.y + '" y2="' + tk.y + '"/>' +
        '<text x="' + (geo.left - 6) + '" y="' + (tk.y + 4) + '" text-anchor="end">' + label(tk) + '</text>';
    }).join('');
  }

  // One hover behaviour for every chart. While the pointer moves over a
  // target (or on entering it, with o.on 'pointerenter'), o.show(event,
  // target) draws the marks for the point under it and returns the tooltip's
  // html and place(tipWidth) -> { left, top }. Leaving a target hides the
  // tooltip and calls o.hide.
  function bindHover(o) {
    var tip = o.tip;
    o.targets.forEach(function (target) {
      target.addEventListener(o.on || 'pointermove', function (e) {
        var shown = o.show(e, target);
        tip.hidden = false;
        tip.innerHTML = shown.html;
        var at = shown.place(tip.offsetWidth);
        tip.style.left = at.left + 'px'; tip.style.top = at.top + 'px';
      });
      target.addEventListener('pointerleave', function () { tip.hidden = true; if (o.hide) o.hide(); });
    });
  }
  // Hover along a chart's x axis: the point nearest the pointer, its marks
  // (o.mark returns its svg x) and its tooltip beside it.
  function bindTrack(el, geo, o) {
    var root = el.querySelector('svg');
    bindHover({ tip: el.querySelector('.tip'), targets: [el.querySelector('.hit')], hide: o.hide,
      show: function (e) {
        var r = root.getBoundingClientRect(), p = geo.pointAt((e.clientX - r.left) * (geo.width / r.width));
        var px = o.mark(p) * r.width / geo.width;
        return { html: o.tip(p), place: function (w) { return { left: tipBeside(px, o.gap, w, r.width), top: o.top }; } };
      } });
  }

  function timeline(el, tl) {
    var geo = timelineGeometry(tl, el.clientWidth), W = geo.width, H = geo.height;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Words per minute for each word and as a running average across the exercise">';
    svg += '<g class="axis">' + axisLines(geo, function (tk) { return tk.label; });
    geo.xTicks.forEach(function (tk) { svg += '<text x="' + tk.x + '" y="' + (H - 6) + '" text-anchor="middle">' + tk.index + '</text>'; });
    svg += '<text transform="translate(10 ' + ((geo.top + geo.bottom) / 2) + ') rotate(-90)" text-anchor="middle">WPM</text></g>';
    svg += '<path class="burst" d="' + geo.burstPath + '"/>';
    svg += '<path class="run" d="' + geo.runningPath + '"/>';
    geo.errorMarks.forEach(function (m) {
      svg += '<path class="errmark" d="M' + (m.x - 3) + ' ' + (m.y - 3) + 'L' + (m.x + 3) + ' ' + (m.y + 3) + 'M' + (m.x + 3) + ' ' + (m.y - 3) + 'L' + (m.x - 3) + ' ' + (m.y + 3) + '"/>';
    });
    if (geo.endLabel) svg += '<text class="endlabel" x="' + geo.endLabel.x + '" y="' + geo.endLabel.y + '">' + geo.endLabel.text + '</text>';
    svg += '<g class="hover" visibility="hidden"><line class="cross" y1="' + geo.top + '" y2="' + geo.bottom + '"/>' +
      '<circle class="dot2" r="4"/><circle class="dot1" r="4"/></g>' +
      '<rect class="hit" x="' + geo.left + '" y="0" width="' + (geo.right - geo.left) + '" height="' + H + '" fill="transparent"/></svg>';
    el.innerHTML = svg + '<div class="tip" hidden></div>';
    var marks = el.querySelector('g.hover'), cross = el.querySelector('line.cross');
    var runningDot = el.querySelector('circle.dot1'), burstDot = el.querySelector('circle.dot2');
    bindTrack(el, geo, {
      gap: 14, top: 24,
      mark: function (p) {
        var cx = geo.x(p.i);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
        runningDot.setAttribute('cx', cx); runningDot.setAttribute('cy', geo.y(p.running || 0));
        burstDot.setAttribute('cx', cx); burstDot.setAttribute('cy', geo.y(p.burst || 0));
        marks.setAttribute('visibility', 'visible');
        return cx;
      },
      tip: function (p) {
        return '<b>' + esc(p.word) + '</b> <span class="muted">word ' + p.i + '</span><br>' +
          fix(p.burst) + ' WPM this word · ' + fix(p.running) + ' average' + (p.error ? '<br><span style="color:var(--err)">× error on the first try</span>' : '');
      },
      hide: function () { marks.setAttribute('visibility', 'hidden'); },
    });
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(t) { var d = new Date(t); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  // cfg: progressGeometry's, plus color: CSS var name, fmt: value formatter, label: axis caption.
  function progress(el, cfg) {
    var pts = cfg.points, geo = progressGeometry(cfg, el.clientWidth), x = geo.x, y = geo.y, W = geo.width, H = geo.height;
    var fmt = cfg.fmt || function (v) { return fix(v); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.label) + ' over time"><g class="axis">';
    svg += axisLines(geo, function (tk) { return esc(fmt(tk.value)); });
    geo.dayTicks.forEach(function (tk) { svg += '<text x="' + tk.x + '" y="' + (H - 6) + '" text-anchor="middle">' + dayLabel(tk.t) + '</text>'; });
    svg += '</g>';
    var color = 'var(' + (cfg.color || '--series-1') + ')';
    if (geo.trendPath) svg += '<path class="trend" style="stroke:' + color + '" d="' + geo.trendPath + '"/>';
    pts.forEach(function (p, i) {
      if (p.lo != null) svg += '<line class="range" style="stroke:' + color + '" x1="' + x(p.t) + '" x2="' + x(p.t) + '" y1="' + y(p.lo) + '" y2="' + y(p.hi) + '"/>';
      var fill = p.fill === undefined ? 1 : p.fill;
      svg += '<circle class="pt" data-i="' + i + '" cx="' + x(p.t) + '" cy="' + y(p.y) + '" r="5" style="stroke:' + color + ';fill:' +
        (fill == null ? 'var(--surface)' : color) + ';fill-opacity:' + (fill == null ? 1 : 0.15 + 0.85 * fill) + '"/>';
    });
    svg += '<line class="cross" y1="' + geo.top + '" y2="' + geo.bottom + '" visibility="hidden"/>' +
      '<rect class="hit" x="' + geo.left + '" y="0" width="' + (geo.right - geo.left) + '" height="' + H + '" fill="transparent"/></svg>';
    el.innerHTML = svg + '<div class="tip" hidden></div>';
    var cross = el.querySelector('line.cross');
    bindTrack(el, geo, {
      gap: 12, top: 8,
      mark: function (p) {
        cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
        return x(p.t);
      },
      tip: function (p) { return p.tip; },
      hide: function () { cross.setAttribute('visibility', 'hidden'); },
    });
  }

  function heatmap(el, grid, stats, opts) {
    var mode = (opts && opts.mode) || 'err';
    function render() {
      var vals = heatValues(grid, stats, mode), max = vals.max, geo = heatCells(grid, vals);
      var svg = '<svg viewBox="0 0 ' + geo.width + ' ' + geo.height + '" role="img" aria-label="Keyboard heatmap: ' +
        (mode === 'err' ? 'error rate per key (first try)' : 'where wrong presses landed') + '">';
      geo.cells.forEach(function (c, i) {
        svg += '<g data-i="' + i + '"><rect class="key' + (vals[i].rated ? '' : ' few') + '" x="' + c.x + '" y="' + c.y + '" width="' + c.width + '" height="' + c.height + '" rx="6" ' +
          'style="fill-opacity:' + c.opacity + '"/>' +
          '<text x="' + c.labelX + '" y="' + c.labelY + '" text-anchor="middle" class="' + (c.onDark ? 'on-dark' : '') + '">' + esc(grid.cells[i].label) + '</text></g>';
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
      bindKeyTips(el, vals);
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
  function keyTip(v) {
    return '<b>' + esc(v.label) + '</b><br>' + (v.n ? (v.rate == null ? v.n + ' presses (too few to rate)' : (100 * v.rate).toFixed(1) + '% wrong first attempts (' + fix(v.err, 0) + ' of ' + v.n + ')') : 'not typed yet') +
      '<br>' + fix(v.landed, 0) + ' wrong presses landed here';
  }
  // A key's tooltip goes just below it, inside the heatmap.
  function bindKeyTips(el, vals) {
    var wrap = el.querySelector('.hm-wrap');
    bindHover({ tip: el.querySelector('.tip'), targets: Array.prototype.slice.call(el.querySelectorAll('svg g[data-i]')), on: 'pointerenter',
      show: function (e, key) {
        return { html: keyTip(vals[+key.dataset.i]), place: function (w) {
          var r = key.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
          return { left: tipWithin(r.left - wr.left, w, wr.width), top: r.bottom - wr.top + 6 };
        } };
      } });
  }

  FT.chart = {
    niceStep: niceStep, monotonePath: monotonePath, scale: scale, ticks: ticks, logTicks: logTicks, dayTicks: dayTicks,
    tipBeside: tipBeside, tipWithin: tipWithin, timelineGeometry: timelineGeometry, progressGeometry: progressGeometry,
    heatValues: heatValues, heatCells: heatCells,
    dayLabel: dayLabel, timeline: timeline, progress: progress, heatmap: heatmap,
  };
})(globalThis.FT);
