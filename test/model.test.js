'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { syntheticRecords, trainSessions } = require('./helpers/model');
const { near, deepClose } = require('./helpers/assert');

// Functionality: the sequence model discovers genuinely weak (error-prone) and
// hesitant (slow) contexts. Each context is judged against its backoff parent
// (shorter suffix) with empirical-Bayes shrinkage, so blame does not spread
// over overlapping n-grams and rarity is not mistaken for weakness.

const FT = load();

const FILLER = ['the', 'and', 'of', 'water', 'people', 'house', 'mind', 'plan', 'cold', 'make', 'over', 'just', 'like', 'blue', 'paid'];
const TR = ['tree', 'train', 'trip', 'metro', 'patrol', 'extra', 'retro', 'trust', 'entry', 'control'];
const STR = ['strong', 'street', 'stream', 'strange'];
const RN = ['turn', 'learn', 'modern', 'corner', 'return', 'burn'];
const N_WORDS = ['and', 'not', 'any', 'one', 'when', 'into', 'hand', 'land', 'end', 'sun', 'win', 'can'];

const records = (words, count, rule, seed) => syntheticRecords(FT, words, count, rule, seed);
const train = (model, opts) => trainSessions(FT, model, opts);
const RN_WORDS = [...FILLER, ...RN, ...N_WORDS];
const STR_WORDS = [...FILLER, ...TR, ...STR];

const slowStr = (ctx, ch) => (ch === 'r' && ctx.endsWith('st') ? { log: Math.log(2) } : null);
const errRn = (ctx, ch) => (ch === 'n' && ctx.endsWith('r') ? { p: 0.15 } : null);

test('a slow trigram is flagged as hesitant but its bigram and letters are not', () => {
  const m = FT.model.create();
  train(m, { words: STR_WORDS, count: 400, rule: slowStr, seed: 10, sessions: 5 });
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get('str').hesitant, true, JSON.stringify(m.explain('str', { day: 5 })));
  assert.equal(ev.get('tr').hesitant, false);
  assert.equal(ev.get('r').hesitant, false);
  assert.equal(ev.get('st').hesitant, false);
});

test('an error-prone bigram is flagged as weak but its letters are not', () => {
  const m = FT.model.create();
  train(m, { words: RN_WORDS, count: 400, rule: errRn, seed: 50, sessions: 5 });
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get('rn').weak, true, JSON.stringify(m.explain('rn', { day: 5 })));
  assert.equal(ev.get('n').weak, false);
  assert.equal(ev.get('r').weak, false);
});

test('rarely seen contexts have insufficient evidence and are never flagged', () => {
  const m = FT.model.create();
  const recs = records(FILLER, 300, () => null, 3);
  for (let i = 0; i < 3; i++) recs.push({ ch: 'q', ctx: 'xy', err: 1, clean: false, word: 'xyq', wordInitial: false });
  m.ingest(recs, { session: 1, day: 0 });
  const e = m.evaluate({ day: 0 }).get('yq');
  assert.equal(e.state, 'insufficient');
  assert.equal(e.weak, false);
});

test('consistently easy contexts are reported as ok', () => {
  const m = FT.model.create();
  m.ingest(records(FILLER, 600, () => null, 4), { session: 1, day: 0 });
  assert.equal(m.evaluate({ day: 0 }).get('th').state, 'ok');
});

test('old weakness fades when recent practice is good (recency weighting)', () => {
  const m = FT.model.create();
  m.ingest(records(RN_WORDS, 750, errRn, 7), { session: 1, day: 0 });
  m.ingest(records(RN_WORDS, 750, errRn, 17), { session: 2, day: 0 });
  assert.equal(m.evaluate({ day: 0 }).get('rn').weak, true);
  train(m, { words: RN_WORDS, count: 300, seed: 71, sessions: 6, first: 3, dayOf: (i) => 31 + i });
  assert.equal(m.evaluate({ day: 36 }).get('rn').weak, false);
});

test('explain exposes the evidence behind a judgement', () => {
  const m = FT.model.create();
  m.ingest(records(RN_WORDS, 750, errRn, 8), { session: 1, day: 0 });
  m.ingest(records(RN_WORDS, 750, errRn, 18), { session: 2, day: 0 });
  const x = plain(m.explain('rn', { day: 0 }));
  assert.equal(x.key, 'rn');
  assert.equal(x.parent, 'n');
  for (const f of ['n', 'errors', 'errorRate', 'parentErrorRate', 'pWorse', 'latency', 'state', 'examples', 'sessionsWithDeficit']) {
    assert.ok(f in x, f);
  }
  assert.ok(x.examples.length && x.examples.every((w) => w.includes('rn')), JSON.stringify(x.examples));
});

test('the model state survives serialisation', () => {
  const m = FT.model.create();
  m.ingest(records(RN_WORDS, 800, errRn, 9), { session: 1, day: 0 });
  const m2 = FT.model.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  deepClose(plain(m2.explain('rn', { day: 0 })), plain(m.explain('rn', { day: 0 })), 1e-6);   // to the stored precision (9 significant digits on log sums)
});

test('a longer context carrying no data beyond its parent is marked redundant', () => {
  const m = FT.model.create();
  train(m, { words: STR_WORDS, count: 400, rule: slowStr, seed: 10, sessions: 5 });
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get(' str').state, 'redundant'); // every "str" here is word-initial
  assert.equal(ev.get('str').state, 'hesitant');
});

test('a mastered context that becomes weak again is flagged again', () => {
  const m = FT.model.create();
  const words = RN_WORDS;
  train(m, { words, count: 300, seed: 90, sessions: 4 });
  assert.equal(m.evaluate({ day: 4 }).get('rn').weak, false);
  train(m, { words, count: 300, rule: errRn, seed: 94, sessions: 3, first: 5, dayOf: (i) => 4 + i });
  assert.equal(m.evaluate({ day: 7 }).get('rn').weak, true);
});

test('long histories are compacted without changing judgements materially', () => {
  const m = FT.model.create({ exactSessions: 6, block: 4 });
  const words = RN_WORDS;
  train(m, { words, count: 60, rule: errRn, seed: 200, sessions: 30 });
  assert.ok(m.state().contexts.rn.buckets.length <= 12);
  const ref = FT.model.create({ exactSessions: 1000 });
  train(ref, { words, count: 60, rule: errRn, seed: 200, sessions: 30 });
  const a = m.explain('rn', { day: 30 }), b = ref.explain('rn', { day: 30 });
  assert.equal(a.state, b.state);
  near(a.errorRate, b.errorRate, 0.01);
  assert.ok(a.sessions < b.sessions, a.sessions + ' buckets against ' + b.sessions);
});

test('a deficit seen in only one session is emerging, and is confirmed by a second session', () => {
  const m = FT.model.create();
  const words = RN_WORDS;
  m.ingest(records(words, 1500, errRn, 300), { session: 1, day: 0 });
  const one = m.evaluate({ day: 0 }).get('rn');
  assert.equal(one.state, 'emerging');
  assert.equal(one.weak, false);
  m.ingest(records(words, 400, errRn, 301), { session: 2, day: 1 });
  const two = m.evaluate({ day: 1 }).get('rn');
  assert.equal(two.weak, true);
  assert.ok(two.errSessions >= 2);
});

test('a deficit in one session that is absent in the next is never confirmed', () => {
  const m = FT.model.create();
  const words = RN_WORDS;
  m.ingest(records(words, 1500, errRn, 310), { session: 1, day: 0 });
  m.ingest(records(words, 300, (ctx, ch) => (ch === 'n' && ctx.endsWith('r') ? { p: 0 } : null), 311), { session: 2, day: 1 });
  assert.equal(m.evaluate({ day: 1 }).get('rn').weak, false);
});

// Functionality: a key the keyboard sends late (FT.keyevents.lateKeys) has shifted
// timestamps. Its sequences are compared with a parent that ends on the same
// key, so the shift cancels; the single key is compared with all keys, so it
// does not: its speed is not judged. Its errors are.
const slowE = (ctx, ch) => (ch === 'e' ? { log: Math.log(1.6) } : null);
const errE = (ctx, ch) => (ch === 'e' ? { p: 0.12 } : null);
const late = { chars: ['e'], judged: ['e', 'a'] };

test('a late key is not judged slow as a single key', () => {
  const plainM = FT.model.create(), lateM = FT.model.create();
  for (let s = 0; s < 4; s++) {
    const recs = records(FILLER, 400, slowE, 40 + s);
    plainM.ingest(recs, { session: s + 1, day: s });
    lateM.ingest(recs, { session: s + 1, day: s, late });
  }
  assert.equal(plainM.evaluate({ day: 4 }).get('e').hesitant, true);
  const ev = lateM.evaluate({ day: 4 });
  assert.equal(ev.get('e').hesitant, false);
  assert.equal(ev.get('e').lateKey, true);
  assert.deepEqual(plain(ev.late), ['e']);
  assert.equal(lateM.explain('e', { day: 4 }).lateKey, true);
});

test('a late key is still judged on its errors', () => {
  const m = FT.model.create();
  train(m, { words: FILLER, count: 400, rule: errE, seed: 50, sessions: 4, late });
  assert.equal(m.evaluate({ day: 4 }).get('e').weak, true);
});

test('a key judged on time again in a later session is no longer late', () => {
  const m = FT.model.create();
  m.ingest(records(FILLER, 100, () => null, 60), { session: 1, day: 0, late });
  m.ingest(records(FILLER, 100, () => null, 61), { session: 2, day: 1, late: { chars: [], judged: ['e'] } });
  assert.deepEqual(plain(m.evaluate({ day: 1 }).late), []);
  // a session without enough presses of the key leaves the verdict as it was
  m.ingest(records(FILLER, 100, () => null, 62), { session: 3, day: 2, late });
  m.ingest(records(FILLER, 100, () => null, 63), { session: 4, day: 3, late: { chars: [], judged: [] } });
  assert.deepEqual(plain(m.evaluate({ day: 3 }).late), ['e']);
});

test('a longer sequence ending on a late key is judged against the same delay', () => {
  // every e is shifted by the keyboard (x1.6); "he" is genuinely slower again
  const shifted = (ctx, ch) => (ch === 'e' ? { log: Math.log(1.6) + (ctx.endsWith('k') ? Math.log(1.5) : 0) } : null);
  const m = FT.model.create();
  train(m, { words: [...FILLER, 'keen', 'kept', 'keys', 'make', 'like', 'take'], count: 400, rule: shifted, seed: 70, sessions: 4, late });
  const ev = m.evaluate({ day: 4 });
  assert.equal(ev.get('e').hesitant, false);
  assert.equal(ev.get('ke').hesitant, true);   // slower than e elsewhere: flagged
  assert.equal(ev.get('he').hesitant, false);  // only the keyboard's delay: not flagged
});

// Functionality: the model state is stored compactly (buckets as arrays, sums
// to 9 significant digits; design choice) and judges the same after a reload.
test('a model stored compactly and loaded again judges the same, at about half the size', () => {
  const m = FT.model.create();
  train(m, { words: [...FILLER, ...TR, ...STR, ...RN], count: 400, rule: (c, ch) => slowStr(c, ch) || errRn(c, ch), seed: 80, sessions: 5 });
  const saved = plain(m.toJSON());
  const verbose = JSON.stringify(m.state()).length;
  assert.ok(JSON.stringify(saved.state).length * 1.6 < verbose);
  const again = FT.model.create(saved.cfg, saved.state);
  const a = m.evaluate({ day: 5 }).all, b = again.evaluate({ day: 5 }).all;
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
  for (const k of Object.keys(a)) {
    assert.equal(b[k].state, a[k].state, k);
    near(b[k].latRel ?? 0, a[k].latRel ?? 0, 1e-6, k);
  }
  assert.equal(again.evaluate({ day: 5 }).get('str').state, 'hesitant');
  // and the reloaded model keeps learning
  again.ingest(records(FILLER, 50, () => null, 99), { session: 6, day: 6 });
  assert.ok(again.state().contexts.th.buckets.length >= 6);
});

test('a model state stored before compaction still loads', () => {
  const m = FT.model.create();
  m.ingest(records(FILLER, 100, () => null, 3), { session: 1, day: 0 });
  const old = plain({ cfg: m.toJSON().cfg, state: m.state() });
  const again = FT.model.create(old.cfg, old.state);
  assert.deepEqual(plain(again.state().contexts.th), plain(m.state().contexts.th));
});

// Functionality: model storage stays bounded over years. Sessions older than
// cfg.bigAfter merge into 64-session blocks, aligned across all contexts
// (design choice; old evidence carries little weight after exposure decay).
test('after 400 sessions a context keeps a bounded number of buckets and judgements still work', () => {
  const m = FT.model.create();
  train(m, { words: STR_WORDS, count: 40, rule: slowStr, seed: 1001, sessions: 400, dayOf: (i) => i + 1 });
  const b = m.state().contexts.th.buckets;
  assert.ok(b.length <= 45, String(b.length));
  assert.ok(b.some((x) => typeof x.block === 'string')); // 64-session blocks exist
  const ev = m.evaluate({ day: 400 });
  assert.equal(ev.get('str').state, 'hesitant');
  assert.ok(ev.get('str').latSessions >= 2);
  assert.notEqual(ev.get('tr').state, 'hesitant');
  // parent and child buckets stay aligned: same block keys
  const keys = (k) => m.state().contexts[k].buckets.filter((x) => typeof x.block === 'string').map((x) => x.block);
  assert.deepEqual(plain(keys('str')), plain(keys('tr')).filter((k) => keys('str').includes(k)));
  const saved = plain(m.toJSON());
  assert.deepEqual(plain(FT.model.create(saved.cfg, saved.state).state().contexts.th.buckets.map((x) => x.block ?? null)), plain(b.map((x) => x.block ?? null)));
});

// Review findings: contexts typed in different sessions must sit at the same
// compaction level, so per-session comparisons with the parent and with all
// typing stay matched.
test('a deficit replicated long ago and recently is still confirmed after years of other typing', () => {
  const errQ = (ctx, ch) => (ch === 'q' ? { p: 0.3 } : null);
  const Q = ['quiet', 'quick', 'queen', 'equal', 'quote'];
  const m = FT.model.create();
  for (let s = 1; s <= 250; s++) {
    const words = s <= 60 || s === 130 || s === 131 ? [...FILLER, ...Q] : FILLER;
    m.ingest(records(words, 40, errQ, 2000 + s), { session: s, day: s });
  }
  const st = m.state().contexts;
  const levels = (k) => st[k].buckets.filter((b) => b.session <= 64).map((b) => typeof b.block);
  assert.deepEqual(plain(levels('q')), plain(levels('e'))); // same level for the same old sessions
  assert.ok(m.evaluate({ day: 250 }).get('q').errSessions >= 2);
});

// Functionality: after compaction a block's copies in a sequence and in its
// shorter parent sit at the same place in time, so they get the same weight
// and "the parent without this sequence" stays exact.
test('a compacted block weighs the same in a sequence and in its parent', () => {
  // 'ab' sits in block 0 of 'b', which holds 40 other keystrokes: subtracting
  // 'ab' from 'b' must leave them, so 'ab' is judged, not "same as shorter".
  const m = FT.model.create({ exactSessions: 2, block: 4, halfLifeObs: 5 });
  const rec = (ch, ctx, err) => ({ ch, ctx, err, clean: true, logRatio: 0.1, word: 'w' });
  for (let s = 1; s <= 6; s++) {
    const recs = [];
    if (s <= 4) for (let i = 0; i < 10; i++) recs.push(rec('b', 'x', 0));
    if (s === 4) for (let i = 0; i < 20; i++) recs.push(rec('b', 'a', 1));
    if (s > 4) for (let i = 0; i < 10; i++) recs.push(rec('c', 'x', 0));
    m.ingest(recs, { session: s, day: 0 });
  }
  assert.equal(typeof m.state().contexts.b.buckets[0].block, 'number'); // block 0 is merged
  assert.equal(m.explain('ab', { day: 0 }).redundant, false);
});
