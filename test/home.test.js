'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: Train (home) shows one way to train on Enter; every other way
// waits one step away, under More, except a benchmark that is due.
const FT = load();
const everything = { steps: true, trainedToday: false, resumable: false, reading: true, chapterStart: true, benchmarkDue: false, target: true };
const layout = (o) => plain(FT.programme.homeLayout(Object.assign({}, everything, o)));

test('before today’s training, the training is the one thing shown; reading and the rest wait under More', () => {
  assert.deepEqual(layout({}), { primary: 'train', shown: [], more: ['read', 'chapterstart', 'start', 'bench', 'one'] });
});

test('a training under way is resumed on Enter, and starting it over waits under More', () => {
  const l = layout({ resumable: true, trainedToday: true });
  assert.equal(l.primary, 'resume');
  assert.deepEqual(l.more, ['read', 'chapterstart', 'start', 'bench', 'one', 'restart']);
});

test('once today’s training is done, reading and the training swap: reading on Enter, the training again under More', () => {
  assert.deepEqual(layout({ trainedToday: true }), { primary: 'read', shown: [], more: ['again', 'chapterstart', 'start', 'bench', 'one'] });
});

test('with nothing to read, a day already trained still starts the training on Enter', () => {
  const l = layout({ trainedToday: true, reading: false, chapterStart: false });
  assert.equal(l.primary, 'train');
  assert.deepEqual(l.more, ['start', 'bench', 'one']);
});

test('a benchmark that is due is shown beside the training instead of under More', () => {
  const l = layout({ benchmarkDue: true });
  assert.deepEqual(l.shown, ['bench']);
  assert.ok(!l.more.includes('bench'));
});

test('without a focus sequence there is nothing to practise; with no step switched on, Enter chooses the exercises', () => {
  assert.ok(!layout({ target: false }).more.includes('one'));
  assert.equal(layout({ steps: false }).primary, 'choose');
  assert.equal(layout({ steps: false, trainedToday: true }).primary, 'choose');
});
