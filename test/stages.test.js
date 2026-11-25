'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: consolidation and maintenance of trained contexts, in the
// spirit of spaced repetition. weak -> improving -> consolidating (growing
// intervals) -> mastered (rare retention checks); failures send it back.

const FT = load();
const next = (stage, obs) => plain(FT.model.nextStage(stage, Object.assign(
  { flagged: false, suspect: false, localN: 0, localWords: 0, session: 10 }, obs)));
const GOOD = { localN: 12, localWords: 4 };

test('a flagged context becomes weak', () => {
  assert.equal(next(null, { flagged: true }).name, 'weak');
});

test('never-flagged contexts have no stage', () => {
  assert.equal(next(null, GOOD), null);
});

test('a weak context that is no longer flagged starts improving', () => {
  assert.equal(next({ name: 'weak' }, {}).name, 'improving');
});

test('improving needs varied good practice before consolidating', () => {
  assert.equal(next({ name: 'improving' }, { localN: 12, localWords: 1 }).name, 'improving');
  assert.equal(next({ name: 'improving' }, { ...GOOD, suspect: true }).name, 'improving');
  const c = next({ name: 'improving' }, GOOD);
  assert.equal(c.name, 'consolidating');
  assert.equal(c.interval, 1);
  assert.equal(c.due, 11);
});

test('successful reviews grow the interval until mastered', () => {
  let s = { name: 'consolidating', interval: 1, due: 11 };
  const seen = [];
  for (let session = 11; seen.length < 4; session++) {
    const n = next(s, { ...GOOD, session });
    if (session >= s.due) seen.push([n.name, n.interval]);
    s = n;
  }
  assert.deepEqual(seen, [['consolidating', 2], ['consolidating', 4], ['mastered', 8], ['mastered', 16]]);
});

test('before it is due, a consolidating context is left alone', () => {
  const s = { name: 'consolidating', interval: 4, due: 20 };
  assert.deepEqual(next(s, { ...GOOD, session: 15, suspect: true }), s);
});

test('a failed retention check sends it back to improving', () => {
  const n = next({ name: 'mastered', interval: 16, due: 10 }, { ...GOOD, suspect: true });
  assert.equal(n.name, 'improving');
  assert.equal(n.regressed, true);
});

test('a credible deficit sends any stage back to weak', () => {
  const n = next({ name: 'mastered', interval: 16, due: 40 }, { flagged: true });
  assert.equal(n.name, 'weak');
  assert.equal(n.regressed, true);
});

test('training demand reflects stage and due reviews', () => {
  const d = (s, session = 10) => FT.model.demand(s, session);
  assert.ok(d({ name: 'weak' }) > d({ name: 'improving' }));
  assert.ok(d({ name: 'improving' }) > d({ name: 'consolidating', interval: 2, due: 10 }));
  assert.equal(d({ name: 'consolidating', interval: 2, due: 12 }), 0);
  assert.ok(d({ name: 'mastered', interval: 8, due: 9 }) > 0);
  assert.equal(d(null), 0);
});

test('endSession applies stages using this session\'s own observations', () => {
  const m = FT.model.create();
  const recs = [];
  const words = ['turn', 'learn', 'burn', 'corner', 'the', 'and', 'of', 'mind', 'plan', 'cold', 'one', 'hand'];
  for (let i = 0; i < 1200; i++) {
    const w = words[i % words.length];
    let ctx = '';
    for (const ch of w + ' ') {
      const err = ch === 'n' && ctx.endsWith('r') && i % 3 === 0 ? 1 : 0;
      recs.push({ ch, ctx: ctx.slice(-3), err, clean: !err, logRatio: 0, word: w });
      ctx += ch;
    }
  }
  m.ingest(recs.slice(0, recs.length / 2), { session: 1, day: 0 });
  m.endSession({ session: 1, day: 0 });
  m.ingest(recs.slice(recs.length / 2), { session: 2, day: 0 });
  const changes = m.endSession({ session: 2, day: 0 });
  assert.equal(m.state().contexts.rn.stage.name, 'weak');
  assert.ok(changes.some((c) => c.key === 'rn' && c.to === 'weak'));
  const targets = m.trainingTargets({ session: 3, day: 1 });
  assert.equal(targets[0].key, 'rn');
});
