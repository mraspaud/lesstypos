'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: a training programme guides the user through its enabled
// exercises in order, can skip, repeat or finish early, and an interrupted
// programme can be resumed later the same day.

const FT = load();
const types = (r) => { const out = []; while (r.current()) { out.push(r.current().type); r.complete({}); } return out; };

test('the default programme is the 20-minute daily training', () => {
  const d = plain(FT.programme.DEFAULT);
  assert.deepEqual(d.steps.map((s) => [s.type, s.minutes]), [['warmup', 2], ['relaxed', 5], ['bursts', 3], ['prose', 7], ['targeted', 3]]);
  assert.equal(FT.programme.totalMinutes(FT.programme.DEFAULT), 20);
});

test('the runner visits enabled steps in order', () => {
  const def = JSON.parse(JSON.stringify(FT.programme.DEFAULT));
  def.steps[2].enabled = false;
  assert.deepEqual(types(FT.programme.runner(def, { day: 1 })), ['warmup', 'relaxed', 'prose', 'targeted']);
});

test('skip, repeat and finish early', () => {
  const r = FT.programme.runner(FT.programme.DEFAULT, { day: 1 });
  r.complete({ wpm: 50 });            // warmup
  r.skip();                            // relaxed skipped
  assert.equal(r.current().type, 'bursts');
  r.complete({ wpm: 70 });
  r.repeat();                          // bursts again
  assert.equal(r.current().type, 'bursts');
  r.complete({ wpm: 72 });
  r.finishEarly();
  assert.equal(r.current(), null);
  assert.equal(r.done(), true);
  assert.deepEqual(plain(r.results().map((x) => [x.type, !!x.skipped])),
    [['warmup', false], ['relaxed', true], ['bursts', false], ['bursts', false]]);
});

test('an interrupted programme resumes the same day but not the next', () => {
  const r = FT.programme.runner(FT.programme.DEFAULT, { day: 10 });
  r.complete({});
  const saved = JSON.parse(JSON.stringify(r.toJSON()));
  const same = FT.programme.resume(saved, 10);
  assert.equal(same.current().type, 'relaxed');
  assert.equal(same.results().length, 1);
  assert.equal(FT.programme.resume(saved, 11), null);
  const finished = FT.programme.runner(FT.programme.DEFAULT, { day: 10 });
  finished.finishEarly();
  assert.equal(FT.programme.resume(JSON.parse(JSON.stringify(finished.toJSON())), 10), null);
});

test('step durations come from the definition', () => {
  const def = JSON.parse(JSON.stringify(FT.programme.DEFAULT));
  def.steps[0].minutes = 0.1;
  assert.equal(FT.programme.runner(def, { day: 1 }).current().minutes, 0.1);
});

test('a run has an id that survives resuming', () => {
  const r = FT.programme.runner(FT.programme.DEFAULT, { day: 3 });
  assert.ok(r.id());
  r.complete({});
  assert.equal(FT.programme.resume(JSON.parse(JSON.stringify(r.toJSON())), 3).id(), r.id());
  assert.notEqual(FT.programme.runner(FT.programme.DEFAULT, { day: 3 }).id(), r.id());
});
