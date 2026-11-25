'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: an optional layout declaration (genkey-style key rows plus a
// matching finger grid, fingers 0-9 = left pinky..right pinky, 4/5 thumbs)
// lets the app explain sequences with the layout community's movement
// categories (SFB, LSB, scissors, rolls, alternation, redirects). Multi-
// character keys are recognised as macros.

const FT = load();
const QWERTY = `
q w e r t   y u i o p
a s d f g   h j k l ;
z x c v b   n m , . /
0 1 2 3 3   6 6 7 8 9
0 1 2 3 3   6 6 7 8 9
0 1 2 3 3   6 6 7 8 9
`;
const L = FT.layout.parse(QWERTY);
const kind = (s) => FT.layout.classify(L, s)?.type ?? null;

test('parses keys with row, column, finger and hand', () => {
  assert.deepEqual(plain(L.keys.f), { row: 1, col: 3, finger: 3, hand: 'L' });
  assert.equal(L.keys.j.hand, 'R');
});

test('bigram categories', () => {
  assert.equal(kind('ed'), 'sfb');
  assert.equal(kind('ee'), 'repeat');
  assert.equal(kind('fj'), 'alternate');
  assert.equal(kind('df'), 'roll-in');
  assert.equal(kind('fd'), 'roll-out');
  // Scissor: adjacent fingers, the longer finger on the lower row (layouts.wiki).
  assert.ok(FT.layout.classify(L, 'cr').tags.includes('full-scissor')); // middle bottom, index top
  assert.ok(!FT.layout.classify(L, 'ex').tags.includes('full-scissor')); // middle top, ring bottom
  assert.ok(FT.layout.classify(L, 'vw').tags.length === 0);
  assert.ok(FT.layout.classify(L, 'te').tags.includes('lsb'));
});

test('trigram categories', () => {
  assert.equal(kind('sfd'), 'redirect');
  assert.equal(kind('sdf'), 'onehand');
  assert.equal(kind('fjf'), 'alternate');
  assert.equal(kind('dfj'), 'roll');
  assert.ok(FT.layout.classify(L, 'dkd').tags.includes('sfs'));
});

test('unknown characters and spaces give no classification', () => {
  assert.equal(FT.layout.classify(L, 'a b'), null);
  assert.equal(FT.layout.classify(L, 'aé'), null);
});

test('multi-character keys are declared as macros', () => {
  const T = FT.layout.parse('th e\n3 2');
  assert.deepEqual(plain(T.macros), ['th']);
  assert.equal(FT.layout.classify(T, 'th').type, 'macro');
});

test('mismatched grids are reported with a useful message', () => {
  assert.throws(() => FT.layout.parse('a b c\n0 1'), /row 1.*3 keys.*2 fingers/);
  assert.throws(() => FT.layout.parse('a b\n0 x'), /finger/);
});

// The user's own column-staggered split layout, with a thumb row.
const THORNIUM = `
z b w h g " : . / j x @
( s c n t k , a e i m )
[ f p l d v = u o y th ]
qu r space '
0 0 1 2 3 3 6 6 7 8 9 9
0 0 1 2 3 3 6 6 7 8 9 9
0 0 1 2 3 3 6 6 7 8 9 9
4 4 5 5
`;

test('space can be declared with the "space" token; underscore stays a literal key', () => {
  const T = FT.layout.parse(THORNIUM);
  assert.equal(T.keys[' '].finger, 5);
  assert.equal(T.keys[' '].hand, 'R');
  assert.ok(!T.keys._);
  assert.deepEqual(plain(T.macros), ['th', 'qu']);
  assert.ok(FT.layout.parse('a _\n0 1').keys._);
  assert.equal(FT.layout.parse('a ␣\n0 5').keys[' '].finger, 5);
});

test('multi-letter keys count as one press inside longer sequences', () => {
  const T = FT.layout.parse(THORNIUM);
  const the = FT.layout.classify(T, 'the');
  assert.deepEqual(plain(the.keys), ['th', 'e']);
  assert.equal(the.type, 'roll-in'); // th (right pinky) -> e (right middle)
});

test('movement categories on the user layout', () => {
  const T = FT.layout.parse(THORNIUM);
  assert.equal(FT.layout.classify(T, 'tk').type, 'sfb');      // both left index
  assert.equal(FT.layout.classify(T, 'nt').type, 'roll-in');  // middle -> index
  assert.notEqual(FT.layout.classify(T, 'd t'), null);        // across the space key
});

// Functionality: substitutions are classified by how the intended and typed
// keys relate on the declared layout (adjacent-key and homologous errors are
// the most common kinds in skilled typing, Grudin 1983).
test('a same-finger substitution one row lower is a missed reach up', () => {
  const T = FT.layout.parse(THORNIUM);
  const r = plain(FT.layout.relation(T, 'w', 'c')); // left ring: top row intended, home row typed
  assert.equal(r.kind, 'reach-up');
  assert.match(r.label, /reach up/);
  assert.equal(FT.layout.relation(T, 'c', 'w').kind, 'reach-down');
});

test('neighbouring, mirror-image and unrelated substitutions', () => {
  const T = FT.layout.parse(THORNIUM);
  assert.equal(FT.layout.relation(T, 'n', 't').kind, 'neighbour');   // left middle vs left index, home row
  assert.equal(FT.layout.relation(T, 'n', 'e').kind, 'mirror');      // left middle vs right middle, home row
  assert.equal(FT.layout.relation(T, 'z', 'y').kind, 'other-hand');
  assert.equal(FT.layout.relation(T, 's', 'd').kind, 'same-hand');
  assert.equal(FT.layout.relation(T, 'n', 'é'), null);           // not on the layout
});

test('the layout grid separates the hands and centres thumb keys under each hand', () => {
  const T = FT.layout.parse(THORNIUM);
  const g = plain(FT.layout.grid(T));
  const cell = (k) => g.cells.find((c) => c.key === k);
  assert.deepEqual([cell('z').x, cell('z').y], [0, 0]);
  assert.ok(cell('j').x - cell('g').x > 1);          // gap between the hands
  assert.equal(cell('th').hand, 'R');
  assert.equal(cell('qu').y, 3);
  // left thumbs (qu r) centred under the six left columns: x = 2, 3
  assert.deepEqual([cell('qu').x, cell('r').x], [2, 3]);
  assert.equal(g.width, 13);
});

test('every key is one unit wide, the space bar included (as on the user\'s board)', () => {
  const T = FT.layout.parse(THORNIUM);
  const g = plain(FT.layout.grid(T));
  const cell = (k) => g.cells.find((c) => c.key === k);
  assert.equal(cell(' ').w, 1);
  assert.equal(cell(' ').label, '\u2423');
  assert.equal(cell("'").x, cell(' ').x + 1);
  // right thumbs (space, ') take 2 units, centred under the six right columns starting at 7
  assert.equal(cell(' ').x, 9);
});

// Functionality: a breakdown of letter-pair performance by movement type on
// the declared layout (descriptive; the model stays layout-agnostic).
test('pairs are grouped by movement type, timed relative to alternation', () => {
  const L = FT.layout.parse('a s d   j k l\n0 1 2   7 8 9');
  const ctx = (key, n, errors, latRel, mu) => ({ key, order: 2, n, errors, latN: n, mu, rawMu: mu, latRel, state: 'ok' });
  const all = {
    aj: ctx('aj', 100, 1, 1, Math.log(1.0)),   // alternation
    sk: ctx('sk', 100, 1, 1, Math.log(1.0)),   // alternation
    as: ctx('as', 50, 2, 1.1, Math.log(0.9)),  // roll-in (pinky -> ring)
    aa: ctx('aa', 20, 0, 1, Math.log(1.2)),    // repeat
    a: { key: 'a', order: 1, n: 500, errors: 5, latN: 500, mu: 0 },
    xyz: { key: 'xyz', order: 3, n: 9, errors: 0, latN: 9, mu: 0 },
  };
  const b = plain(FT.layout.breakdown({ all }, L));
  const alt = b.find((r) => r.type === 'alternate'), roll = b.find((r) => r.type === 'roll-in');
  assert.equal(alt.pairs, 2);
  assert.equal(alt.n, 200);
  assert.equal(alt.time, 1);
  assert.ok(Math.abs(roll.time - 0.9) < 1e-9);
  assert.equal(roll.errorRate, 0.04);
  assert.deepEqual(roll.worst, ['as']);
  assert.ok(!b.some((r) => r.type === 'macro'));
});

test('scissors and lateral stretches get their own (overlapping) rows', () => {
  const ctx = (key) => ({ key, order: 2, n: 40, errors: 1, latN: 40, mu: 0, latRel: 1 });
  const b = plain(FT.layout.breakdown({ all: { te: ctx('te'), cr: ctx('cr'), fj: ctx('fj') } }, L));
  const lsb = b.find((r) => r.type === 'lsb'), sc = b.find((r) => r.type === 'full-scissor');
  assert.deepEqual(lsb.worst, ['te']);
  assert.deepEqual(sc.worst, ['cr']);
  assert.equal(lsb.overlapping, true);
});

test('each movement type reports its share of all letter pairs typed', () => {
  const ctx = (key, n) => ({ key, order: 2, n, errors: 0, latN: n, mu: 0, latRel: 1 });
  const b = plain(FT.layout.breakdown({ all: { fj: ctx('fj', 300), ed: ctx('ed', 100), te: ctx('te', 100) } }, L));
  const share = (t) => b.find((r) => r.type === t).share;
  assert.equal(share('alternate'), 0.6);
  assert.equal(share('sfb'), 0.2);
  assert.equal(share('lsb'), 0.2);    // overlapping rows use the same total
});

test('the breakdown leaves out word-boundary pairs and uses measured, not shrunk, timing', () => {
  const T = FT.layout.parse(THORNIUM);
  const ctx = (key, rawMu, mu) => ({ key, order: 2, n: 50, errors: 0, latN: 50, mu, rawMu, latRel: 1 });
  const b = plain(FT.layout.breakdown({ all: {
    tk: ctx('tk', Math.log(1.5), Math.log(1.1)),   // sfb: measured 1.5, shrunk 1.1
    ta: ctx('ta', Math.log(1.0), Math.log(1.0)),   // alternation
    'e ': ctx('e ', Math.log(3), Math.log(3)),     // word boundary
  } }, T));
  assert.ok(!b.some((r) => r.worst.includes('e ')));
  assert.ok(Math.abs(b.find((r) => r.type === 'sfb').time - 1.5) < 1e-9);
});

test('without alternation data there is no reference, so no relative time', () => {
  const ctx = (key) => ({ key, order: 2, n: 50, errors: 0, latN: 50, mu: 0, rawMu: 0, latRel: 1 });
  const b = plain(FT.layout.breakdown({ all: { ed: ctx('ed') } }, L));
  assert.equal(b.find((r) => r.type === 'sfb').time, null);
});

test('the model exposes measured (unshrunk) timing per context', () => {
  const m = FT.model.create();
  const recs = [];
  for (let i = 0; i < 30; i++) recs.push({ ch: 'b', ctx: 'a', err: 0, clean: true, logRatio: Math.log(2), word: 'ab' });
  m.ingest(recs, { session: 1, day: 0 });
  assert.ok(Math.abs(m.evaluate({ day: 0 }).get('ab').rawMu - Math.log(2)) < 1e-6);
});
