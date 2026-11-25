'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: character-level error analysis of the input stream
// (Wobbrock & Myers 2006; MacKenzie & Soukoreff 2002; Soukoreff & MacKenzie 2003).
// '<' in the test notation is a backspace.

const FT = load();
function stream(str, dt = 100) {
  return Array.from(str).map((ch, i) =>
    ch === '<' ? { k: 'b', t: i * dt } : { k: 'c', ch, t: i * dt, g: i });
}
const A = (p, s) => FT.align.analyzeWord(p, stream(s));
const errs = (r) => plain(r.events.filter((e) => e.type !== 'none').map((e) => [e.type, e.corrected, e.pos, e.expected ?? null, e.actual ?? null]));
const firstErr = (r) => plain(r.targets.map((x) => x.err));

test('a perfectly typed word has only correct keystrokes', () => {
  const r = A('cat ', 'cat ');
  assert.deepEqual(plain(r.counts), { C: 4, INF: 0, IF: 0, F: 0 });
  assert.deepEqual(errs(r), []);
  assert.deepEqual(firstErr(r), [0, 0, 0, 0]);
});

test('a corrected substitution is kept as an error of the first attempt', () => {
  const r = A('cat ', 'cx<at ');
  assert.deepEqual(plain(r.counts), { C: 4, INF: 0, IF: 1, F: 1 });
  assert.deepEqual(errs(r), [['sub', true, 1, 'a', 'x']]);
  assert.deepEqual(firstErr(r), [0, 1, 0, 0]);
});

test('an uncorrected substitution', () => {
  const r = A('cat ', 'cbt ');
  assert.deepEqual(plain(r.counts), { C: 3, INF: 1, IF: 0, F: 0 });
  assert.deepEqual(errs(r), [['sub', false, 1, 'a', 'b']]);
});

test('an uncorrected insertion does not cascade into substitutions', () => {
  const r = A('cats ', 'caxts ');
  assert.deepEqual(errs(r), [['ins', false, 2, null, 'x']]);
  assert.deepEqual(firstErr(r), [0, 0, 1, 0, 0]);
  assert.equal(r.counts.C, 5);
  assert.equal(r.counts.INF, 1);
});

test('an uncorrected omission does not cascade', () => {
  const r = A('cats ', 'cts ');
  assert.deepEqual(errs(r), [['omit', false, 1, 'a', null]]);
  assert.deepEqual(firstErr(r), [0, 1, 0, 0, 0]);
});

test('a corrected omission (typing the next letter early, then fixing)', () => {
  const r = A('cat ', 'ct<at ');
  assert.deepEqual(errs(r), [['omit', true, 1, 'a', null]]);
  assert.deepEqual(firstErr(r), [0, 1, 0, 0]);
});

test('correct letters erased and retyped are corrected no-errors', () => {
  const r = A('cat ', 'cax<<at ');
  // 'a' was right, then erased: a corrected no-error. 'x' was wrong.
  assert.deepEqual(errs(r), [['sub', true, 2, 't', 'x']]);
  assert.equal(r.counts.IF, 2);
  assert.equal(r.counts.F, 2);
  assert.deepEqual(firstErr(r), [0, 0, 1, 0]);
});

test('adjacent swapped letters are tagged as a transposition', () => {
  const r = A('form ', 'from ');
  const tr = r.events.filter((e) => e.type === 'transpose');
  assert.equal(tr.length, 2);
  assert.deepEqual(plain(tr.map((e) => e.pos)), [1, 2]);
});

test('a substitution by a letter occurring later in the word is premature', () => {
  const r = A('stand ', 'sdand ');
  const sub = r.events.find((e) => e.type === 'sub');
  assert.equal(sub.premature, true);
  const r2 = A('stand ', 'sxand ');
  assert.equal(r2.events.find((e) => e.type === 'sub').premature, false);
});

test('ambiguous alignments are weighted by 1/number of alignments', () => {
  // P="aab", T="ab": the omitted 'a' can be either of the two.
  const r = A('aab ', 'ab ');
  const om = r.events.filter((e) => e.type === 'omit');
  assert.ok(om.length >= 1);
  const total = om.reduce((s, e) => s + e.w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(Math.abs(r.counts.INF - 1) < 1e-9);
});

test('each target position records the time of its first attempt', () => {
  const r = A('cat ', 'cx<at ');
  assert.deepEqual(plain(r.targets.map((x) => x.t)), [0, 100, 400, 500]);
});

test('an omission right before the word-ending space', () => {
  const r = A('cat ', 'ca ');
  assert.deepEqual(errs(r), [['omit', false, 2, 't', null]]);
  assert.deepEqual(firstErr(r), [0, 0, 1, 0]);
});

test('ambiguous first-attempt errors are shared between candidate positions', () => {
  const r = A('aab ', 'ab ');
  assert.deepEqual(firstErr(r), [0.5, 0.5, 0, 0]);
});

test('a word abandoned with a space keeps its trailing omissions', () => {
  const r = A('cats ', 'c ');
  assert.equal(r.events.filter((e) => e.type === 'omit').length, 3);
  assert.equal(r.counts.INF, 3);
});
