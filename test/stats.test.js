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

// Functionality: how credible it is that one beta-distributed proportion is
// more than a multiple of another (used to compare two error rates). The
// expected values are Monte Carlo estimates (10^6 draws, standard error at
// most 0.0005) or exact for uniform distributions.
test('the probability that one beta proportion exceeds a multiple of another', () => {
  const above = FT.stats.betaRatioAbove;
  near(above(1, 1, 1, 1, 1), 0.5, 2e-3);
  near(above(1, 1, 1, 1, 2), 0.25, 2e-3); // area of the triangle x > 2y
  near(above(1, 1, 1, 1, 0.5), 0.75, 2e-3);
  near(above(175, 5627, 79, 4323, 2), 0.1033, 3e-3);
  near(above(175, 5627, 79, 4323, 3), 0, 1e-4);
  near(above(61, 2941, 11, 1741, 3), 0.6209, 3e-3);
  near(above(3, 1201, 2, 601, 2), 0.1811, 3e-3);
});

test('the probability that one beta proportion exceeds a multiple of another, with no errors or all errors', () => {
  const above = FT.stats.betaRatioAbove;
  near(above(1, 1501, 1, 751, 2), 0.2008, 3e-3); // no errors in either
  near(above(1, 1501, 1, 751, 3), 0.1423, 3e-3);
  near(above(1501, 1, 11, 741, 3), 1, 1e-4); // all errors in the first
  near(above(11, 1491, 751, 1, 2), 0, 1e-4); // all errors in the second
});
