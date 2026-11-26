'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { typeCorrectly } = require('./helpers/typing');

// Functionality: training conditions are tagged once per sitting, and their
// effect on relaxed speed and accuracy is measured (never acted on).
const FT = load();
const C = () => FT.conditions;
const HOUR = 3600e3;
const at = (h, m = 0) => new Date(2026, 10, 26, h, m).getTime();
const relaxed = (startedAt, wpm, acc, tags) => ({ type: 'relaxed', startedAt, durationMs: 300e3, words: 250, wpm, firstAttemptAccuracy: acc, tags });

test('tags are typed as free words or hashtags, in lower case, each once', () => {
  assert.deepEqual(plain(C().parseTags('#Home, wrist-rest  #home tired')), ['home', 'wrist-rest', 'tired']);
  assert.deepEqual(plain(C().parseTags('  ')), []);
});

test('an exercise within an hour of the previous one is in the same sitting and takes its tags; otherwise tags are asked', () => {
  const prev = relaxed(at(9), 50, 0.98, ['home']);
  assert.deepEqual(plain(C().sittingTags([prev], at(9, 50))), { ask: false, tags: ['home'] });
  assert.deepEqual(plain(C().sittingTags([prev], at(11))), { ask: true, tags: ['home'] });   // a new sitting, the last tags offered
  assert.deepEqual(plain(C().sittingTags([], at(11))), { ask: true, tags: [] });
});

test('a sitting goes on from when the previous exercise ended, its pauses included', () => {
  const paused = Object.assign(relaxed(at(9), 50, 0.98, ['home']), { endedAt: at(9, 50) });   // 5 minutes typed over 50
  assert.deepEqual(plain(C().sittingTags([paused], at(10, 40))), { ask: false, tags: ['home'] });
  const before = relaxed(at(9), 50, 0.98, ['home']);   // recorded before the end was: its start and duration
  assert.equal(C().sittingTags([before], at(10, 4)).ask, false);
  assert.equal(C().sittingTags([before], at(10, 6)).ask, true);
});

test('a benchmark trial neither starts nor ends a sitting', () => {
  const trial = { type: 'benchmark', startedAt: at(9, 30), durationMs: 60e3, endedAt: at(9, 31) };
  assert.deepEqual(plain(C().sittingTags([relaxed(at(9), 50, 0.98, ['home']), trial], at(9, 50))), { ask: false, tags: ['home'] });
  assert.equal(C().sittingTags([relaxed(at(7), 50, 0.98, ['home']), trial], at(9, 50)).ask, true);
});

test('a sitting is the run of exercises, each within an hour of the one before, that ends with a given one', () => {
  const ex = (id, h, m, type = 'relaxed') => Object.assign(relaxed(at(h, m), 50, 0.98), { id, type });
  const h = [ex('a', 9, 0), ex('b', 9, 30), ex('c', 11, 0), ex('trial', 11, 20, 'benchmark'), ex('d', 11, 40), ex('e', 12, 0)];
  assert.deepEqual(plain(C().sittingOf(h, 'b')), ['a', 'b']);
  assert.deepEqual(plain(C().sittingOf(h, 'd')), ['c', 'd']);   // the trial between them belongs to no sitting
  assert.deepEqual(plain(C().sittingOf(h, 'c')), ['c']);
  assert.deepEqual(plain(C().sittingOf(h, 'missing')), []);
});

test('the time of day is a condition of its own', () => {
  assert.equal(C().timeOfDay(at(8)), 'morning');
  assert.equal(C().timeOfDay(at(14)), 'afternoon');
  assert.equal(C().timeOfDay(at(20)), 'evening');
});

test('a tag is compared once each side has 5 relaxed exercises: the difference and its 95% interval', () => {
  const h = [];
  for (let i = 0; i < 6; i++) h.push(relaxed(at(9) + i * 24 * HOUR, 60 + (i % 2), 0.99, ['home']));
  for (let i = 0; i < 6; i++) h.push(relaxed(at(9) + (i + 6) * 24 * HOUR, 50 + (i % 2), 0.97, ['office']));
  h.push(relaxed(at(9) + 20 * 24 * HOUR, 55, 0.98, ['rare']));
  const rows = C().compare(h);
  const home = rows.find((r) => r.tag === 'home');
  assert.equal(home.with.n, 6);
  assert.equal(home.without.n, 7);
  assert.ok(Math.abs(home.wpm.difference - 9.5) < 1.5, JSON.stringify(home.wpm));
  assert.ok(home.wpm.low > 0 && home.wpm.high > home.wpm.low);
  assert.ok(home.accuracy.difference > 0);
  assert.ok(!rows.some((r) => r.tag === 'rare'));
  assert.equal(rows.some((r) => r.tag === 'morning' && r.automatic), false);   // every exercise was in the morning: no comparison
});

// A relaxed exercise of 20 words typed correctly at 9:00, processed by tr.
function finishedExercise(tr, extra) {
  const { words, t } = typeCorrectly(FT, tr.newExercise({ type: 'relaxed' }).words.slice(0, 20));
  return tr.finish(Object.assign({ type: 'relaxed', startedAt: at(9), durationMs: t, words }, extra)).raw;
}

test('tags typed after an exercise reach its history entry', () => {
  const tr = FT.trainer.create({ seed: 3 });
  const raw = finishedExercise(tr);
  tr.tag([raw.id], ['home']);
  assert.deepEqual(plain(tr.history().at(-1).tags), ['home']);
});

test('a rebuilt history keeps the tags of the raw records', () => {
  const raw = finishedExercise(FT.trainer.create({ seed: 3 }), { tags: ['home'] });
  assert.deepEqual(plain(FT.trainer.rebuild([raw], { seed: 3 }).history()[0].tags), ['home']);
});

test('the bootstrap interval of a condition is the same each time it is computed', () => {
  const h = [];
  for (let i = 0; i < 12; i++) h.push(relaxed(at(9) + i * 24 * HOUR, 50 + (i % 3) * 4, 0.97 + (i % 2) / 100, i < 6 ? ['home'] : ['office']));
  assert.deepEqual(plain(C().compare(h)), plain(C().compare(h.map((x) => Object.assign({}, x)))));
});

test('a history entry keeps only well-formed tags, each once', () => {
  const raw = finishedExercise(FT.trainer.create({ seed: 3 }));
  const entryTags = (tags) => FT.trainer.rebuild([Object.assign({}, raw, { tags })], { seed: 3 }).history()[0].tags;
  assert.equal(entryTags('home'), undefined);
  assert.deepEqual(plain(entryTags(['home', 5, 'home', 'office'])), ['home', 'office']);
});

test('a tag named like a time of day is a condition apart from that time of day', () => {
  const h = [];
  for (let i = 0; i < 12; i++) h.push(relaxed(at(i % 2 ? 19 : 9) + i * 24 * HOUR, 50 + i, 0.98, i < 6 ? ['morning'] : undefined));
  const rows = C().compare(h).filter((r) => r.tag === 'morning');
  assert.deepEqual(plain(rows.map((r) => [r.key, r.automatic, r.with.n])), [['tag:morning', false, 6], ['time:morning', true, 6]]);
});
