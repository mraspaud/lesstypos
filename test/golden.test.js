'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers/load');

// Guard for refactoring: rebuilding the profile from a fixed set of raw
// exercises (tools/make_golden.js) gives exactly the stored snapshot (its
// SHA-256 and a readable summary). Update it only for a deliberate change of
// meaning, with a MODEL_VERSION bump:
//   UPDATE_GOLDEN=1 node --test test/golden.test.js
// On a mismatch the actual profile is written to fixtures/golden-profile.actual.json.
const FT = load();
const dir = path.join(__dirname, 'fixtures');
const raws = JSON.parse(fs.readFileSync(path.join(dir, 'golden-raws.json'), 'utf8')).map(FT.codec.decodeSession);
const snapshotFile = path.join(dir, 'golden-profile.sha256.json');

function snapshot(profile) {
  const json = JSON.stringify(profile);
  return {
    sha256: crypto.createHash('sha256').update(json).digest('hex'),
    modelVersion: profile.modelVersion,
    exercises: profile.history.length,
    sequences: Object.keys(profile.model.state.contexts).length,
    frontier: profile.difficulty.frontier,
    burstTarget: profile.bursts.target,
  };
}

test('rebuilding the golden exercises gives exactly the stored profile', () => {
  const profile = FT.trainer.rebuild(raws, { settings: { macros: ['th'], accents: true } }).profile();
  const actual = snapshot(profile);
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(snapshotFile, JSON.stringify(actual, null, 2) + '\n');
  const expected = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  if (actual.sha256 !== expected.sha256) fs.writeFileSync(path.join(dir, 'golden-profile.actual.json'), JSON.stringify(profile, null, 1));
  assert.deepEqual(actual, expected);
});
