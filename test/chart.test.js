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
  assert.ok(tk.every((t) => t % day === 0));
});

test('a narrow log range still gets at least three tick labels', () => {
  const tk = FT.chart.logTicks(103, 130);
  assert.ok(tk.length >= 3, JSON.stringify(tk));
  assert.ok(tk[0] <= 103 && tk[tk.length - 1] >= 130);
});
