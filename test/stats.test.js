'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: statistical primitives used by the sequence model.
const FT = load();
const { near } = require('./helpers/assert');

test('regularized incomplete beta matches known values', () => {
  near(FT.stats.betaCdf(0.5, 1, 1), 0.5, 1e-9);
  near(FT.stats.betaCdf(0.2, 2, 3), 0.1808, 1e-4); // 1-(0.8^4+4*0.2*0.8^3)
  near(FT.stats.betaCdf(0.01, 1, 99), 1 - Math.pow(0.99, 99), 1e-9);
});

test('normal cdf matches known values', () => {
  near(FT.stats.normCdf(0), 0.5, 1e-7);
  near(FT.stats.normCdf(1.6448536), 0.95, 1e-6);
});

test('Van Selst & Jolicoeur non-recursive trimming removes a gross outlier only', () => {
  const v = [100, 110, 95, 105, 98, 102, 400];
  assert.deepEqual(plain(FT.stats.vjTrim(v)), [100, 110, 95, 105, 98, 102]);
  assert.deepEqual(plain(FT.stats.vjTrim([100, 300, 200])), [100, 300, 200]); // n < 4: untouched
});

test('recency weight follows the FSRS power-law curve shape', () => {
  near(FT.stats.recencyWeight(0, 3), 1, 1e-12);
  near(FT.stats.recencyWeight(3, 3), 0.9, 1e-9);
  assert.ok(FT.stats.recencyWeight(30, 3) < FT.stats.recencyWeight(10, 3));
});

// Functionality: how credible it is that one beta-distributed proportion
// exceeds another by more than a margin (used to compare two accuracies).
test('the probability that one beta proportion exceeds another by a margin', () => {
  const above = FT.stats.betaDifferenceAbove;
  near(above(1, 1, 1, 1, 0), 0.5, 1e-3);
  near(above(1, 1, 1, 1, 0.5), 0.125, 1e-3); // area of the triangle x - y > 0.5
  near(above(2, 1, 1, 1, 0), 2 / 3, 1e-3); // E[X] for X ~ Beta(2, 1)
  near(above(30, 1470, 20, 1480, 0), 0.92, 0.02); // normal approximation of the difference
  near(above(30, 1470, 20, 1480, 0.1), 0, 1e-6);
  near(above(30, 1470, 20, 1480, -0.1), 1, 1e-6);
});
