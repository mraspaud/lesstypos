'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');
const { stream } = require('./helpers/typing');

// Functionality: recurring substitutions (expected x typed as y), normalised by
// opportunities of x, shrunk toward a global base rate, with contextual
// examples. Independent of the sequence-weakness model.

const FT = load();
function feed(subs, pairs, meta = { exercise: 'relaxed', session: 1, t: 0 }, macros = []) {
  subs.ingest(pairs.map(([p, s]) => FT.align.analyzeWord(p + ' ', stream(s + ' '), { macros })), meta);
}
const pair = (subs, expected, actual) => subs.matrix({ minOpp: 1 }).find((r) => r.expected === expected && r.actual === actual);

test('substitution rate is count over opportunities of the expected character', () => {
  const s = FT.subs.create();
  feed(s, [['run', 'bun'], ['ran', 'ran'], ['red', 'red'], ['rot', 'rot']]);
  const row = pair(s, 'r', 'b');
  assert.equal(row.count, 1);
  assert.equal(row.opportunities, 4);
  assert.ok(Math.abs(row.observedRate - 0.25) < 1e-9);
});

test('corrected substitutions are counted and examples keep their context', () => {
  const s = FT.subs.create();
  feed(s, [['strong', 'stl<rong']]);
  const row = s.matrix({ minOpp: 1 }).find((r) => r.expected === 'r');
  assert.equal(row.actual, 'l');
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
  feed(s, [['run', 'bun'], ['sun', 'nun']]);
  const s2 = FT.subs.create(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(plain(s2.matrix({ minOpp: 1 })), plain(s.matrix({ minOpp: 1 })));
  assert.deepEqual(plain(s2.premature({ minOpp: 1 })), plain(s.premature({ minOpp: 1 })));
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

// Functionality: opportunities count per press of the intended key. A
// declared multi-letter key is a key of its own, so a th press is not an
// opportunity to type t, and a slip on it is a slip of the th key.
test('a press of a multi-letter key is not an opportunity for its letters', () => {
  const s = FT.subs.create();
  feed(s, [['tea', 'dea'], ['the', 'the'], ['then', 'then'], ['top', 'top']], undefined, ['th']);
  const row = pair(s, 't', 'd');
  assert.equal(row.opportunities, 2);
  assert.equal(row.observedRate, 0.5);
});

test('a slip on a multi-letter key is counted once, for that key', () => {
  const s = FT.subs.create();
  feed(s, [['the', 'dhe'], ['this', 'this']], undefined, ['th']);
  const row = pair(s, 'th', 'd');
  assert.equal(row.count, 1);
  assert.equal(row.opportunities, 2);
  assert.equal(plain(row.examples[0]).context, '[th]e ');
  assert.equal(pair(s, 't', 'd'), undefined);
});

// Functionality: a letter typed early (premature: it comes later in the word)
// is a sequencing error, reported apart from the finger confusions.
test('premature slips are reported apart from finger confusions', () => {
  const s = FT.subs.create();
  feed(s, [['sun', 'nun'], ['sit', 'nit'], ['sat', 'sat']]);
  const confusion = pair(s, 's', 'n');
  assert.equal(confusion.count, 1);
  assert.equal(confusion.examples.length, 1);
  assert.equal(plain(confusion.examples[0]).word, 'sit');
  const premature = s.premature({ minOpp: 1 });
  assert.equal(premature.length, 1);
  assert.equal(premature[0].expected, 's');
  assert.equal(premature[0].actual, 'n');
  assert.equal(premature[0].count, 1);
  assert.equal(premature[0].opportunities, 3);
  assert.equal(plain(premature[0].examples[0]).word, 'sun');
});

test('a pair slipped only prematurely is not a finger confusion', () => {
  const s = FT.subs.create();
  feed(s, [['sun', 'nun']]);
  assert.equal(pair(s, 's', 'n'), undefined);
});

// Functionality: a slip pair is confirmed like a sequence: credibly above the
// base substitution rate (P > 0.95 under its beta posterior) and seen in 2
// separate sessions (user decision: replication).
const typedTimes = (n, target, typed) => Array.from({ length: n }, () => [target, typed]);
function feedSessions(subs, perSession) {
  perSession.forEach((pairs, i) => feed(subs, pairs, { exercise: 'relaxed', session: i + 1, t: i }));
}
const oneSessionOfEat = () => typedTimes(5, 'eat', 'iat').concat(typedTimes(45, 'eat', 'eat'));

test('a credible slip pair seen in 2 sessions is confirmed', () => {
  const s = FT.subs.create();
  feedSessions(s, [oneSessionOfEat(), oneSessionOfEat()]);
  assert.equal(pair(s, 'e', 'i').confirmed, true);
  assert.deepEqual(plain(s.confirmedPairs().map((r) => r.expected + r.actual)), ['ei']);
});

test('a credible slip pair seen in one session only is not confirmed yet', () => {
  const s = FT.subs.create();
  feedSessions(s, [oneSessionOfEat().concat(oneSessionOfEat())]);
  assert.equal(pair(s, 'e', 'i').confirmed, false);
  assert.equal(s.confirmedPairs().length, 0);
});

test('a slip pair seen in 2 sessions but not credibly above the base rate is not confirmed', () => {
  const s = FT.subs.create();
  const session = () => [['e', 'i']].concat(typedTimes(999, 'e', 'e'), typedTimes(29, 'a', 'b'));
  feedSessions(s, [session(), session()]);
  assert.equal(pair(s, 'e', 'i').confirmed, false);
  assert.equal(pair(s, 'a', 'b').confirmed, true);
});

test('loading stored statistics leaves the stored object untouched', () => {
  const stored = { opp: {}, pairs: {}, totalSubs: 0, totalOpp: 0 };
  FT.subs.create(stored);
  assert.deepEqual(Object.keys(stored).sort(), ['opp', 'pairs', 'totalOpp', 'totalSubs']);
});
