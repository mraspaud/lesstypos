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

// Functionality: one key action = one mistake. Letters of one wrong press, on
// the typed side (th key) or the target side (a missed th press), count as one
// error, shared between the positions they cover.
// Notation: [..] is one multi-character input event; '<' a backspace.
function pressStream(typed, gapMs = 100) {
  const out = [];
  let g = 0, t = 0;
  for (const part of typed.match(/\[[^\]]+\]|./g)) {
    g++; t += gapMs;
    if (part === '<') { out.push({ k: 'b', t }); continue; }
    for (const ch of part.replace(/^\[|\]$/g, '')) out.push({ k: 'c', ch, t, g });
  }
  return out;
}
const AP = (p, typed, macros = ['th']) => FT.align.analyzeWord(p, pressStream(typed), { macros });
const total = (r) => r.targets.reduce((a, x) => a + x.err, 0);

test('th pressed for y in "you": only y is wrong, one error', () => {
  const r = AP('you ', '[th]ou ');
  assert.deepEqual(plain(r.targets.map((x) => x.err)), [1, 0, 0, 0]);
});

test('a single key for a th press in "the": t and h share one error, e matches', () => {
  const r = AP('the ', 'xe ');
  assert.deepEqual(plain(r.targets.map((x) => x.err)), [0.5, 0.5, 0, 0]);
  assert.equal(total(AP('the ', 'xe ', [])), 2);   // without the multi-letter key: two letters, two errors
});

test('th pressed for "we" in "wet" is one error, corrected or not', () => {
  assert.equal(total(AP('wet ', '[th]<<wet ')), 1);
  assert.equal(total(AP('wet ', '[th]et ')), 1);
});

test('a declared th key sending two fast keystrokes counts as one press too', () => {
  const st = [{ k: 'c', ch: 't', t: 100, g: 1 }, { k: 'c', ch: 'h', t: 105, g: 2 }, { k: 'b', t: 300 }, { k: 'b', t: 400 },
    ...Array.from('wet ').map((ch, i) => ({ k: 'c', ch, t: 500 + i * 100, g: 3 + i }))];
  assert.equal(total(FT.align.analyzeWord('wet ', st, { macros: ['th'] })), 1);
  assert.equal(total(FT.align.analyzeWord('wet ', st, { macros: [] })), 2);
});

test('ordinary errors are unchanged by press grouping', () => {
  assert.deepEqual(plain(AP('cat ', 'cbt ').targets.map((x) => x.err)), [0, 1, 0, 0]);
  assert.equal(total(AP('to ', '[th]<<to ')), 1);
});

// Functionality: the word on screen shows the best alignment of what was typed
// with the target, with one mark per wrong press.
const DW = (p, typed, done = true, macros = ['th']) => {
  const st = pressStream(typed);
  const text = st.filter((e, i) => FT.align.flagStream(st)[i]).map((e) => e.ch).join('');
  return plain(FT.align.displayWord(p, text, st, macros, done));
};
const statuses = (d) => d.positions.map((x) => x.status).join(' ');

test('display: th typed for y in "you" marks only y', () => {
  const d = DW('you', '[th]ou');
  assert.equal(statuses(d), 'bad ok ok');
  assert.deepEqual(d.extras, []);
});

test('display: a single key for the th press marks t and h as one group', () => {
  const d = DW('the', 'xe');
  assert.equal(statuses(d), 'bad bad ok');
  assert.equal(d.positions[0].group, d.positions[1].group);
  assert.notEqual(d.positions[0].group, null);
});

test('display: an ordinary extra letter shows as one extra, the rest matches', () => {
  const d = DW('cat', 'caat', true, []);
  assert.equal(statuses(d), 'ok ok ok');
  assert.deepEqual(d.extras.map((x) => [x.before, x.ch]), [[2, 'a']]);
});

test('display: a partly typed word leaves the rest untyped and puts the cursor after the typing', () => {
  const d = DW('cat', 'ca', false, []);
  assert.equal(statuses(d), 'ok ok untyped');
  assert.equal(d.cursor, 2);
  const e = DW('cat', 'caat', false, []);
  assert.equal(e.cursor, 4);   // c a [a] t
});

test('display: mistakes involving a multi-letter press are flagged as press marks, ordinary ones are not', () => {
  assert.equal(DW('you', '[th]ou').positions[0].press, true);
  const the = DW('the', 'xe');
  assert.deepEqual([the.positions[0].press, the.positions[1].press], [true, true]);
  assert.equal(DW('cat', 'cbt', true, ['th']).positions[1].press, false);
});

// ---- review findings on press-based errors ----
test('display, word in progress: a wrong first letter shows as a red letter, not an extra in front', () => {
  const d = DW('cat', 'x', false, []);
  assert.equal(statuses(d), 'bad untyped untyped');
  assert.deepEqual(d.extras, []);
  assert.equal(d.cursor, 1);
});

test('display, word in progress: the th key alone for "you" already marks y', () => {
  const d = DW('you', '[th]', false);
  assert.equal(statuses(d), 'bad untyped untyped');
  assert.deepEqual(d.extras, []);
});

test('correcting a wrong th press does not blame the next letter', () => {
  assert.deepEqual(plain(AP('you ', '[th]<<you ').targets.map((x) => x.err)), [1, 0, 0, 0]);
  assert.deepEqual(plain(AP('you ', '[th]<ou ').targets.map((x) => x.err)), [1, 0, 0, 0]);
});

test('target-press grouping does not depend on the alignment: separate wrong presses stay separate', () => {
  assert.equal(total(AP('the ', 'hte ')), 2);       // two separate keys, both out of place
  assert.equal(total(AP('the ', 'xye ')), 2);       // two separate wrong presses for the th key
  assert.equal(total(AP('the ', 'xe ')), 1);        // one key where the th key was meant
});

test('stream entries without an input group are separate presses', () => {
  const st = Array.from('cxyt ').map((ch, i) => ({ k: 'c', ch, t: i * 100 }));
  assert.deepEqual(plain(FT.text.pressIds(st, [])), [0, 1, 2, 3, 4]);
  // nothing absorbed: x and y are two mistakes; the two equally good readings
  // (x for a and y for t, or both x and y at a) are weighted 1/2 each
  assert.equal(total(FT.align.analyzeWord('cat ', st, { macros: [] })), 1.5);
});

test('display: a press whose extra letter was erased is not marked as a multi-letter press', () => {
  const d = DW('yo', '[th]<o', true);
  assert.equal(d.positions[0].status, 'bad');
  assert.equal(d.positions[0].press, false);
});
