'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./helpers/load');

// Functionality: an experimental fluency index (design choice), the relaxed
// speed that the sequence statistics predict on a fixed reference text.

const FT = load();

// The reference text never changes silently: a change of the word list or of
// the benchmark's sampling shows here, and old predictions would then no
// longer compare with new ones.
test('the reference text is 1,000 frozen words drawn like the benchmark’s', () => {
  const corpus = FT.corpus.get('en'), reference = FT.fluency.reference(corpus);
  assert.equal(reference.words.length, 1000);
  assert.ok(reference.words.every((w) => corpus.rankOf(w) >= 0 && corpus.rankOf(w) < 5000));
  const checksum = crypto.createHash('sha256').update(reference.words.join(' ')).digest('hex');
  assert.equal(checksum, '666d7dbcba4201f856eebf53c8df7ee6827193d2d3fbd04d401d37950a66b5a3');
  assert.equal(FT.fluency.reference(corpus), reference);
});
