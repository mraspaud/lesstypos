'use strict';
// Numeric assertions shared by the tests.
const assert = require('node:assert/strict');

// a is within eps of b.
function near(a, b, eps = 1e-9, message) {
  assert.ok(Math.abs(a - b) <= eps, message || `${a} is not within ${eps} of ${b}`);
}

// Like deepEqual, with numbers compared to within eps.
function deepClose(actual, expected, eps = 1e-9, path = '') {
  if (typeof expected === 'number' && typeof actual === 'number') { near(actual, expected, eps, `${path || 'value'}: ${actual} is not within ${eps} of ${expected}`); return; }
  if (expected === null || typeof expected !== 'object') { assert.equal(actual, expected, path); return; }
  assert.ok(actual !== null && typeof actual === 'object', `${path || 'value'} is not an object`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path || 'value'}: keys differ`);
  for (const k of Object.keys(expected)) deepClose(actual[k], expected[k], eps, path ? path + '.' + k : k);
}

module.exports = { near, deepClose };
