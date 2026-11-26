'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the instruction card says what the code does.
const FT = load();
const text = (type, settings = {}) => FT.exercises.instructions(type, settings);

test('the bursts card states the target, the round times and the accuracy that counts', () => {
  const t = text('bursts');
  assert.match(t.goal, new RegExp(Math.round((FT.bursts.START_ABOVE - 1) * 100) + '% above'));
  assert.match(t.goal, new RegExp(FT.exercises.BURST_ROUND_MS / 1000 + ' seconds.*' + FT.exercises.BURST_REST_MS / 1000));
  assert.match(t.counts, new RegExp(FT.bursts.MIN_ACC * 100 + '% accuracy'));
});

test('the relaxed card states the accuracy that grows the vocabulary', () => {
  assert.match(text('relaxed').counts, new RegExp(String(FT.difficulty.TUNING.high * 100).replace('.', '\\.') + '%'));
});

test('the prose card mentions unaccented letters only when they are accepted', () => {
  assert.match(text('prose', { accents: true }).goal, /unaccented/);
  assert.doesNotMatch(text('prose', { accents: false }).goal, /unaccented/);
});
