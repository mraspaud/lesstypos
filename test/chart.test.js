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
