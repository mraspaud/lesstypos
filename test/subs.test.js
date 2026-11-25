'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: recurring substitutions (expected x typed as y), normalised by
// opportunities of x, shrunk toward a global base rate, with contextual
// examples. Independent of the sequence-weakness model.

const FT = load();
function stream(str, t0 = 0) {
  return Array.from(str).map((ch, i) => (ch === '<' ? { k: 'b', t: t0 + i * 100 } : { k: 'c', ch, t: t0 + i * 100, g: i }));
}
function feed(subs, pairs, meta = { exercise: 'relaxed', session: 1, t: 0 }) {
  subs.ingest(pairs.map(([p, s]) => FT.align.analyzeWord(p + ' ', stream(s + ' '))), meta);
}

test('substitution rate is count over opportunities of the expected character', () => {
  const s = FT.subs.create();
  feed(s, [['run', 'nun'], ['ran', 'ran'], ['red', 'red'], ['rot', 'rot']]);
  const row = s.matrix({ minOpp: 1 }).find((r) => r.expected === 'r' && r.actual === 'n');
  assert.equal(row.count, 1);
  assert.equal(row.opportunities, 4);
  assert.ok(Math.abs(row.observedRate - 0.25) < 1e-9);
});

test('corrected substitutions are counted and examples keep their context', () => {
  const s = FT.subs.create();
  feed(s, [['strong', 'stn<rong']]);
  const row = s.matrix({ minOpp: 1 }).find((r) => r.expected === 'r');
  assert.equal(row.actual, 'n');
  const ex = plain(row.examples[0]);
  assert.equal(ex.word, 'strong');
  assert.equal(ex.corrected, true);
  assert.equal(ex.context, 'st[r]ong');
  assert.equal(ex.exercise, 'relaxed');
});

test('shrinkage keeps a one-off from outranking a recurring pattern', () => {
  const s = FT.subs.create();
  const pairs = [['zap', 'xap']]; // z->x once in 1 opportunity
  for (let i = 0; i < 100; i++) pairs.push(i < 10 ? ['eat', 'iat'] : ['eat', 'eat']);
  feed(s, pairs);
  const m = s.matrix({ minOpp: 1 });
  assert.equal(m[0].expected, 'e');
  assert.equal(m[0].actual, 'i');
});

test('substitution statistics survive serialisation', () => {
  const s = FT.subs.create();
  feed(s, [['run', 'nun']]);
  const s2 = FT.subs.create(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(plain(s2.matrix({ minOpp: 1 })), plain(s.matrix({ minOpp: 1 })));
});

// Functionality: swapped letters are reported as their own kind of slip, with
// the letter pair that was meant, how often it was swapped, and how often the
// pair came up.
test('swapped letters are counted per letter pair, not as substitutions', () => {
  const s = FT.subs.create();
  feed(s, [['people', 'poe<<eople'], ['people', 'people'], ['geo', 'goe'], ['form', 'form']]);
  const sw = s.swaps({ minOpp: 1 });
  assert.equal(sw.length, 1);
  assert.equal(sw[0].expected, 'eo');
  assert.equal(sw[0].actual, 'oe');
  assert.equal(sw[0].count, 2);
  assert.equal(sw[0].opportunities, 3);
  assert.deepEqual(plain(sw[0].examples.map((e) => e.context)), ['g[eo]', 'p[eo]ple']);
  assert.equal(s.matrix({ minOpp: 1 }).length, 0);
});
