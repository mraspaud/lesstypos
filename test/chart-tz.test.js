'use strict';
// Chart dates follow the local calendar, like the per-day grouping.
process.env.TZ = 'America/Los_Angeles';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const FT = load();

test('day ticks fall on local midnights', () => {
  const t0 = new Date(2026, 10, 2, 20, 30).getTime(), t1 = new Date(2026, 10, 9, 20, 30).getTime();
  const tk = FT.chart.dayTicks(t0, t1);
  assert.ok(tk.length >= 3);
  assert.ok(tk.every((t) => new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0), JSON.stringify(tk.map((t) => new Date(t).toString())));
});

test('day labels name the local date', () => {
  assert.equal(FT.chart.dayLabel(new Date(2026, 10, 3, 20, 30).getTime()), '3 Nov');
});
