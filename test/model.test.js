'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

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

function gauss(rng) {
  const u = rng() || 1e-12, v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Synthetic timing records: rule(key3, ch) -> { log: mean log-ratio, p: error prob }
function makeRecords(words, count, rule, seed) {
  const rng = FT.rng(seed);
  const recs = [];
  let text = '';
  for (let i = 0; i < count; i++) {
    const w = words[Math.floor(rng() * words.length)] + ' ';
    Array.from(w).forEach((ch, pos) => {
      const ctx = text.slice(-3);
      const r = rule(ctx, ch) || {};
      const err = rng() < (r.p ?? 0.01) ? 1 : 0;
      const logRatio = (r.log ?? 0) + 0.25 * gauss(rng);
      recs.push({ ch, ctx, err, clean: !err, logRatio, ratio: Math.exp(logRatio), word: w.trim(), wordInitial: pos === 0 });
      text += ch;
    });
  }
  return recs;
}

const slowStr = (ctx, ch) => (ch === 'r' && ctx.endsWith('st') ? { log: Math.log(2) } : null);
const errRn = (ctx, ch) => (ch === 'n' && ctx.endsWith('r') ? { p: 0.15 } : null);

test('a slow trigram is flagged as hesitant but its bigram and letters are not', () => {
  const m = FT.model.create();
  for (let s = 0; s < 5; s++) {
    m.ingest(makeRecords([...FILLER, ...TR, ...STR], 400, slowStr, 10 + s), { session: s + 1, day: s });
  }
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get('str').hesitant, true, JSON.stringify(m.explain('str', { day: 5 })));
  assert.equal(ev.get('tr').hesitant, false);
  assert.equal(ev.get('r').hesitant, false);
  assert.equal(ev.get('st').hesitant, false);
});

test('an error-prone bigram is flagged as weak but its letters are not', () => {
  const m = FT.model.create();
  for (let s = 0; s < 5; s++) {
    m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 400, errRn, 50 + s), { session: s + 1, day: s });
  }
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get('rn').weak, true, JSON.stringify(m.explain('rn', { day: 5 })));
  assert.equal(ev.get('n').weak, false);
  assert.equal(ev.get('r').weak, false);
});

test('rarely seen contexts have insufficient evidence and are never flagged', () => {
  const m = FT.model.create();
  const recs = makeRecords(FILLER, 300, () => null, 3);
  for (let i = 0; i < 3; i++) recs.push({ ch: 'q', ctx: 'xy', err: 1, clean: false, word: 'xyq', wordInitial: false });
  m.ingest(recs, { session: 1, day: 0 });
  const e = m.evaluate({ day: 0 }).get('yq');
  assert.equal(e.state, 'insufficient');
  assert.equal(e.weak, false);
});

test('consistently easy contexts are reported as ok', () => {
  const m = FT.model.create();
  m.ingest(makeRecords(FILLER, 600, () => null, 4), { session: 1, day: 0 });
  assert.equal(m.evaluate({ day: 0 }).get('th').state, 'ok');
});

test('old weakness fades when recent practice is good (recency weighting)', () => {
  const m = FT.model.create();
  m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 750, errRn, 7), { session: 1, day: 0 });
  m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 750, errRn, 17), { session: 2, day: 0 });
  assert.equal(m.evaluate({ day: 0 }).get('rn').weak, true);
  for (let s = 1; s < 7; s++) {
    m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 300, () => null, 70 + s), { session: s + 2, day: 30 + s });
  }
  assert.equal(m.evaluate({ day: 36 }).get('rn').weak, false);
});

test('explain exposes the evidence behind a judgement', () => {
  const m = FT.model.create();
  m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 750, errRn, 8), { session: 1, day: 0 });
  m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 750, errRn, 18), { session: 2, day: 0 });
  const x = plain(m.explain('rn', { day: 0 }));
  assert.equal(x.key, 'rn');
  assert.equal(x.parent, 'n');
  for (const f of ['n', 'errors', 'errorRate', 'parentErrorRate', 'pWorse', 'latency', 'state', 'examples', 'sessionsWithDeficit']) {
    assert.ok(f in x, f);
  }
  assert.ok(x.examples.includes('turn') || x.examples.includes('learn') || x.examples.length > 0);
});

test('the model state survives serialisation', () => {
  const m = FT.model.create();
  m.ingest(makeRecords([...FILLER, ...RN, ...N_WORDS], 800, errRn, 9), { session: 1, day: 0 });
  const m2 = FT.model.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.deepEqual(plain(m2.explain('rn', { day: 0 })), plain(m.explain('rn', { day: 0 })));
});

test('a longer context carrying no data beyond its parent is marked redundant', () => {
  const m = FT.model.create();
  for (let s = 0; s < 5; s++) {
    m.ingest(makeRecords([...FILLER, ...TR, ...STR], 400, slowStr, 10 + s), { session: s + 1, day: s });
  }
  const ev = m.evaluate({ day: 5 });
  assert.equal(ev.get(' str').state, 'redundant'); // every "str" here is word-initial
  assert.equal(ev.get('str').state, 'hesitant');
});

test('a mastered context that becomes weak again is flagged again', () => {
  const m = FT.model.create();
  const words = [...FILLER, ...RN, ...N_WORDS];
  for (let s = 0; s < 4; s++) m.ingest(makeRecords(words, 300, () => null, 90 + s), { session: s + 1, day: s });
  assert.equal(m.evaluate({ day: 4 }).get('rn').weak, false);
  for (let s = 4; s < 7; s++) m.ingest(makeRecords(words, 300, errRn, 90 + s), { session: s + 1, day: s });
  assert.equal(m.evaluate({ day: 7 }).get('rn').weak, true);
});

test('long histories are compacted without changing judgements materially', () => {
  const m = FT.model.create({ exactSessions: 6, block: 4 });
  const words = [...FILLER, ...RN, ...N_WORDS];
  for (let s = 0; s < 30; s++) m.ingest(makeRecords(words, 60, errRn, 200 + s), { session: s + 1, day: s });
  assert.ok(m.state().contexts.rn.b.length <= 12);
  const ref = FT.model.create({ exactSessions: 1000 });
  for (let s = 0; s < 30; s++) ref.ingest(makeRecords(words, 60, errRn, 200 + s), { session: s + 1, day: s });
  const a = m.explain('rn', { day: 30 }), b = ref.explain('rn', { day: 30 });
  assert.equal(a.state, b.state);
  assert.ok(Math.abs(a.errorRate - b.errorRate) < 0.01);
  assert.equal(a.sessions >= 1, true);
});

test('a deficit seen in only one session is emerging, and is confirmed by a second session', () => {
  const m = FT.model.create();
  const words = [...FILLER, ...RN, ...N_WORDS];
  m.ingest(makeRecords(words, 1500, errRn, 300), { session: 1, day: 0 });
  const one = m.evaluate({ day: 0 }).get('rn');
  assert.equal(one.state, 'emerging');
  assert.equal(one.weak, false);
  m.ingest(makeRecords(words, 400, errRn, 301), { session: 2, day: 1 });
  const two = m.evaluate({ day: 1 }).get('rn');
  assert.equal(two.weak, true);
  assert.ok(two.errSessions >= 2);
});

test('a deficit in one session that is absent in the next is never confirmed', () => {
  const m = FT.model.create();
  const words = [...FILLER, ...RN, ...N_WORDS];
  m.ingest(makeRecords(words, 1500, errRn, 310), { session: 1, day: 0 });
  m.ingest(makeRecords(words, 300, (ctx, ch) => (ch === 'n' && ctx.endsWith('r') ? { p: 0 } : null), 311), { session: 2, day: 1 });
  assert.equal(m.evaluate({ day: 1 }).get('rn').weak, false);
});

// Functionality: a key the keyboard sends late (timing.lateKeys) has shifted
// timestamps. Its sequences are compared with a parent that ends on the same
// key, so the shift cancels; the single key is compared with all keys, so it
// does not: its speed is not judged. Its errors are.
const slowE = (ctx, ch) => (ch === 'e' ? { log: Math.log(1.6) } : null);
const errE = (ctx, ch) => (ch === 'e' ? { p: 0.12 } : null);
const late = { chars: ['e'], judged: ['e', 'a'] };

test('a late key is not judged slow as a single key', () => {
  const plainM = FT.model.create(), lateM = FT.model.create();
  for (let s = 0; s < 4; s++) {
    const recs = makeRecords(FILLER, 400, slowE, 40 + s);
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
  for (let s = 0; s < 4; s++) m.ingest(makeRecords(FILLER, 400, errE, 50 + s), { session: s + 1, day: s, late });
  assert.equal(m.evaluate({ day: 4 }).get('e').weak, true);
});

test('a key judged on time again in a later session is no longer late', () => {
  const m = FT.model.create();
  m.ingest(makeRecords(FILLER, 100, () => null, 60), { session: 1, day: 0, late });
  m.ingest(makeRecords(FILLER, 100, () => null, 61), { session: 2, day: 1, late: { chars: [], judged: ['e'] } });
  assert.deepEqual(plain(m.evaluate({ day: 1 }).late), []);
  // a session without enough presses of the key leaves the verdict as it was
  m.ingest(makeRecords(FILLER, 100, () => null, 62), { session: 3, day: 2, late });
  m.ingest(makeRecords(FILLER, 100, () => null, 63), { session: 4, day: 3, late: { chars: [], judged: [] } });
  assert.deepEqual(plain(m.evaluate({ day: 3 }).late), ['e']);
});

test('a longer sequence ending on a late key is judged against the same delay', () => {
  // every e is shifted by the keyboard (x1.6); "he" is genuinely slower again
  const shifted = (ctx, ch) => (ch === 'e' ? { log: Math.log(1.6) + (ctx.endsWith('k') ? Math.log(1.5) : 0) } : null);
  const m = FT.model.create();
  for (let s = 0; s < 4; s++) m.ingest(makeRecords([...FILLER, 'keen', 'kept', 'keys', 'make', 'like', 'take'], 400, shifted, 70 + s), { session: s + 1, day: s, late });
  const ev = m.evaluate({ day: 4 });
  assert.equal(ev.get('e').hesitant, false);
  assert.equal(ev.get('ke').hesitant, true);   // slower than e elsewhere: flagged
  assert.equal(ev.get('he').hesitant, false);  // only the keyboard's delay: not flagged
});
