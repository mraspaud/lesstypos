'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: settings coming from storage or a pasted backup are cleaned
// to known keys, types and values, so they can never inject markup or break
// a screen.
const FT = load();
const clean = (s) => plain(FT.settings.clean(s));

test('missing or unknown settings fall back to the defaults', () => {
  assert.deepEqual(clean({}), plain(FT.settings.DEFAULTS));
  assert.equal(clean({ nonsense: 1 }).nonsense, undefined);
});

test('numbers are coerced and kept in range; anything else falls back', () => {
  assert.equal(clean({ durationMin: '<img src=x onerror=alert(1)>' }).durationMin, 5);
  assert.equal(clean({ durationMin: '7' }).durationMin, 7);
  assert.equal(clean({ durationMin: 99 }).durationMin, 5);
  assert.equal(clean({ fontSize: 'big' }).fontSize, 1.6);
});

test('choices accept only their known values', () => {
  assert.equal(clean({ theme: '"><script>' }).theme, 'system');
  assert.equal(clean({ theme: 'dark' }).theme, 'dark');
  assert.equal(clean({ errorMode: 'stop' }).errorMode, 'stop');
  assert.equal(clean({ errorStyle: 'loud' }).errorStyle, 'clear');
});

test('text and lists keep their type', () => {
  assert.deepEqual(clean({ macros: ['th', 7, 'qu', '<b>'] }).macros, ['th', 'qu']);
  assert.equal(clean({ layoutText: 42 }).layoutText, '');
  assert.equal(clean({ showTimer: 'yes' }).showTimer, true);
});

test('a daily-training definition keeps known steps only, with sane minutes', () => {
  const def = clean({ programme: { name: 'Mine', steps: [
    { type: 'relaxed', minutes: '4', enabled: true }, { type: 'evil<script>', minutes: 3, enabled: true },
    { type: 'bursts', minutes: 500, enabled: 'no' }] } }).programme;
  assert.deepEqual(def.steps.map((s) => s.type), ['relaxed', 'bursts']);
  assert.equal(def.steps[0].minutes, 4);
  assert.equal(def.steps[1].minutes, 30);
  assert.equal(def.steps[1].enabled, true);
  assert.equal(clean({ programme: { steps: 'x' } }).programme, null);
});

test('a saved daily-training run with an unknown step is dropped', () => {
  const run = FT.programme.runner(FT.programme.DEFAULT, { day: 3 }).toJSON();
  run.def.steps[1].type = 'nope';
  assert.equal(clean({ programmeRun: run }).programmeRun, null);
  const good = FT.programme.runner(FT.programme.DEFAULT, { day: 3 }).toJSON();
  assert.deepEqual(clean({ programmeRun: good }).programmeRun, plain(good));
});

test('a saved run is cleaned like a definition, and refused when its place is out of range', () => {
  const run = FT.programme.runner(FT.programme.DEFAULT, { day: 3 }).toJSON();
  run.def.steps[0].minutes = 45;
  assert.equal(clean({ programmeRun: run }).programmeRun.def.steps[0].minutes, 30);
  for (const broken of [{ index: 99 }, { index: -2 }, { day: 'x' }, { results: [{ type: 'nope' }] }]) {
    assert.equal(clean({ programmeRun: Object.assign({}, FT.programme.runner(FT.programme.DEFAULT, { day: 3 }).toJSON(), broken) }).programmeRun, null, JSON.stringify(broken));
  }
});
