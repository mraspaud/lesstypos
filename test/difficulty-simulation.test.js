'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the vocabulary controller on simulated typists. Each
// exercise has `unbiased` words drawn like the generator's unbiased words
// (90% of ranks uniform below the frontier, 10% up to 1.5 times it); each
// character is a first-try error with the typist's error rate on the
// easiest words, times `ratio` on the less common ones (rank 100 and
// beyond). The easiest words have 5 characters, the others 7.

const FT = load();
const EASIEST = FT.difficulty.EASIEST_RANKS;
const feeling = { hesitationRate: 0.05, rhythmCv: 0.3, effort: 2 };

function simulatedTypist(seed, { ratio, unbiased = 225 }) {
  const rng = FT.rng(seed);
  const errors = (chars, p) => { let k = 0; for (let i = 0; i < chars; i++) if (rng() < p) k++; return k; };
  const rankBelow = (R) => Math.floor(rng() < 0.9 ? rng() * R : R + rng() * 0.5 * R);
  return function exercise(frontier, easiestRate) {
    const out = Object.assign({ vocabulary: [], easiest: { words: 0, chars: 0, errors: 0 } }, feeling);
    for (let i = 0; i < unbiased; i++) {
      const rank = rankBelow(frontier);
      if (rank < EASIEST) {
        out.easiest.words++; out.easiest.chars += 5; out.easiest.errors += errors(5, easiestRate);
      } else {
        out.vocabulary.push([rank, 7, errors(7, ratio * easiestRate)]);
      }
    }
    return out;
  };
}
// The decisions of 20 exercises while the error rate on the easiest words
// falls evenly from `from` to `to`.
function improving(seed, { ratio, from = 0.02, to = 0.004, exercises = 20 }) {
  const d = FT.difficulty.create({}), typist = simulatedTypist(seed, { ratio });
  const actions = [];
  for (let i = 0; i < exercises; i++) actions.push(d.update(typist(d.state().frontier, from + (to - from) * i / (exercises - 1))).action);
  return actions;
}
const indicesOf = (actions, action) => actions.flatMap((a, i) => (a === action ? [i] : []));

test('an improving typist whose less common words have 1.5x the errors grows the vocabulary several times, never shrinking it', () => {
  for (const seed of [1, 2, 3]) {
    const actions = improving(seed, { ratio: 1.5 });
    assert.ok(indicesOf(actions, 'advance').length >= 5, seed + ': ' + actions.join(' '));
    assert.equal(indicesOf(actions, 'retreat').length, 0, seed + ': ' + actions.join(' '));
  }
});

test('with clear evidence, one step can follow another in the next exercise', () => {
  for (const seed of [1, 2, 3]) {
    const advances = indicesOf(improving(seed, { ratio: 1.5 }), 'advance');
    assert.ok(advances.slice(1).some((x, i) => x - advances[i] === 1), seed + ': ' + advances.join(' '));
  }
});
