'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Characterisation of the chart geometry (extracted from app.js).
const FT = load();

test('axis steps are 1, 2 or 5 times a power of ten', () => {
  assert.equal(FT.chart.niceStep(100), 50);   // 100/4 = 25 -> 50
  assert.equal(FT.chart.niceStep(8), 2);
  assert.equal(FT.chart.niceStep(40), 10);
  assert.equal(FT.chart.niceStep(1000), 500);
});

test('monotone curves pass through every point and never overshoot', () => {
  const pts = [[0, 10], [10, 0], [20, 0], [30, 20], [40, 15]];
  const d = FT.chart.monotonePath(pts);
  assert.match(d, /^M0\.0 10\.0C/);
  assert.equal((d.match(/C/g) || []).length, 4);
  // control points of the flat segment stay flat (no overshoot between equal values)
  const seg = d.split('C')[2].split(' ').map(Number);
  assert.equal(seg[1], 0); assert.equal(seg[3], 0);
  // every control point stays within the y-range of its segment's endpoints
  const segs = d.slice(1).split('C');
  let prev = segs[0].split(' ').map(Number);
  for (const s of segs.slice(1)) {
    const n = s.split(' ').map(Number), lo = Math.min(prev[1], n[5]), hi = Math.max(prev[1], n[5]);
    for (const y of [n[1], n[3]]) assert.ok(y >= lo - 1e-9 && y <= hi + 1e-9, s);
    prev = [n[4], n[5]];
  }
});

test('short series fall back to straight lines', () => {
  assert.equal(FT.chart.monotonePath([]), '');
  assert.equal(FT.chart.monotonePath([[0, 1], [5, 2]]), 'M0.0 1.0L5.0 2.0');
});

test('linear and log scales map a domain onto a pixel range', () => {
  const lin = FT.chart.scale([0, 100], [200, 0]);
  assert.equal(lin(0), 200); assert.equal(lin(50), 100); assert.equal(lin(100), 0);
  const log = FT.chart.scale([10, 1000], [0, 100], true);
  assert.ok(Math.abs(log(100) - 50) < 1e-9);
});

test('ticks cover the domain with round values', () => {
  assert.deepEqual(plain(FT.chart.ticks(0, 87)), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(plain(FT.chart.ticks(52, 61)), [52, 54, 56, 58, 60, 62]);
  assert.deepEqual(plain(FT.chart.logTicks(80, 260)), [80, 100, 150, 200, 300]);
});

test('date ticks are whole days, at most about six', () => {
  const day = 864e5, t0 = Date.UTC(2026, 0, 1);
  const tk = FT.chart.dayTicks(t0, t0 + 40 * day);
  assert.ok(tk.length >= 3 && tk.length <= 7, String(tk.length));
  assert.ok(tk.every((t) => new Date(t).getHours() === 0));
});

test('a narrow log range still gets at least three tick labels', () => {
  const tk = FT.chart.logTicks(103, 130);
  assert.ok(tk.length >= 3, JSON.stringify(tk));
  assert.ok(tk[0] <= 103 && tk[tk.length - 1] >= 130);
});

test('log ticks resolve a range that is narrow relative to its decade', () => {
  const tk = FT.chart.logTicks(95, 110);
  assert.ok(tk.length >= 3 && tk[0] >= 80 && tk[tk.length - 1] <= 120, JSON.stringify(tk));
});

test('heatmap shading merges capitals, needs 10 presses, and never stretches tiny rates', () => {
  const grid = { cells: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 'th', label: 'th' }], width: 3, height: 1 };
  const stats = { keys: { a: [8, 1], A: [4, 1], b: [5, 0], th: [40, 1] }, land: { b: 3, B: 1 } };
  const v = plain(FT.chart.heatValues(grid, stats, 'err'));
  assert.deepEqual([v[0].n, v[0].err], [12, 2]);        // a + A
  assert.equal(v[1].rated, false);                       // 5 presses: too few
  assert.ok(Math.abs(v[0].shade - 1) < 1e-9);            // highest rate gets full shade
  assert.ok(Math.abs(v[2].shade - 0.025 / (2 / 12)) < 1e-9);
  const tiny = plain(FT.chart.heatValues({ cells: [grid.cells[2]] }, { keys: { th: [100, 1] } }, 'err'));
  assert.ok(Math.abs(tiny[0].shade - 0.01 / 0.05) < 1e-9); // 1% against the 5% floor
  const land = plain(FT.chart.heatValues(grid, stats, 'land'));
  assert.equal(land[1].value, 4);
  assert.equal(land[1].shade, 1);
});

test('log ticks never loop on non-positive values', () => {
  assert.ok(Array.isArray(FT.chart.logTicks(0, 100)));
  assert.ok(Array.isArray(FT.chart.logTicks(-5, 10)));
});

// Geometry used by the hover tooltips and the drawn marks.
const word = (i, burst, running, error = false) => ({ i, word: 'w' + i, burst, running, error });

test('the timeline picks the word under the pointer, clamped to the first and last', () => {
  const g = FT.chart.timelineGeometry([word(1, null, 40), word(2, 50, 45), word(3, 60, 50, true)], 600);
  assert.equal(g.x(1), g.left);
  assert.equal(g.x(3), g.right);
  assert.equal(g.pointAt(g.x(2) + 10).i, 2);
  assert.equal(g.pointAt(-100).i, 1);
  assert.equal(g.pointAt(10000).i, 3);
  assert.deepEqual(plain(g.errorMarks), [{ x: g.right, y: g.top - 11 }]);
  assert.equal(g.endLabel.text, '50');
});

test('a progress chart picks the point nearest the pointer', () => {
  const day = 864e5, t0 = Date.UTC(2026, 0, 1);
  const g = FT.chart.progressGeometry({ points: [0, 3, 10].map((d) => ({ t: t0 + d * day, y: 50 + d })) }, 480);
  assert.equal(g.pointAt(g.x(t0 + 2 * day)).t, t0 + 3 * day);
  assert.equal(g.pointAt(0).t, t0);
  assert.ok(g.trendPath.startsWith('M'));
});

test('a tooltip sits right of its point unless it would overflow, and stays inside the box', () => {
  assert.equal(FT.chart.tipBeside(100, 12, 80, 400), 112);
  assert.equal(FT.chart.tipBeside(350, 12, 80, 400), 258);
  assert.equal(FT.chart.tipBeside(20, 12, 80, 90), 0);
  assert.equal(FT.chart.tipWithin(380, 80, 400), 320);
  assert.equal(FT.chart.tipWithin(-5, 80, 400), 0);
});

test('heatmap keys are laid out in key units with a gap between them', () => {
  const grid = { cells: [{ key: 'a', label: 'a', x: 0, y: 0, w: 1 }, { key: ' ', label: '␣', x: 1, y: 1, w: 3 }], width: 4, height: 2 };
  const g = plain(FT.chart.heatCells(grid, [{ rated: true, shade: 1 }, { rated: false, shade: 0 }]));
  assert.deepEqual([g.width, g.height], [168, 84]);
  assert.deepEqual(g.cells[0], { x: 0, y: 0, width: 38, height: 38, labelX: 19, labelY: 24, opacity: 1, onDark: true });
  assert.deepEqual([g.cells[1].x, g.cells[1].width, g.cells[1].opacity, g.cells[1].onDark], [42, 122, 1, false]);
});
