'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptList, ROOT } = require('./helpers/load');

// Functionality: the app's own words name one thing one way. Accuracy is
// "accuracy (first try)" wherever it is shown, never "first-attempt accuracy".
const OLD_NAMES = /first-attempt (accuracy|error rate per key)|× first-attempt error/;

// The quoted strings of a script: the text it can show (comments left out).
function stringLiterals(source) {
  return source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
}

test('the app shows accuracy under one name, in every script', () => {
  for (const src of scriptList().filter((s) => s.startsWith('js/'))) {
    const shown = stringLiterals(fs.readFileSync(path.join(ROOT, src), 'utf8')).filter((s) => OLD_NAMES.test(s));
    assert.deepEqual(shown, [], src);
  }
});

test('the wording check finds an old name in a string but not in a comment', () => {
  assert.deepEqual(stringLiterals("// first-attempt accuracy\nvar s = 'Your first-attempt accuracy';").filter((s) => OLD_NAMES.test(s)), ["'Your first-attempt accuracy'"]);
});

// Functionality: numbers that are rules of the method (accuracy bands, the
// replication rule, minimum words, step lengths) are shown from the
// constants that apply them, never typed into the text.
const RULE_NUMBERS = /99\.5%|\b95%|\b2 sessions|\b10 words|\d × \d min|\b0\.5\b|\b30\b/;

test('the app shows the method’s numbers from its constants, in every view', () => {
  for (const src of scriptList().filter((s) => s.startsWith('js/ui/') || s === 'js/format.js')) {
    const shown = stringLiterals(fs.readFileSync(path.join(ROOT, src), 'utf8')).filter((s) => RULE_NUMBERS.test(s));
    assert.deepEqual(shown, [], src);
  }
});

test('the session types a backup may hold are the exercise types', () => {
  const FT = require('./helpers/load').load();
  for (const type of FT.exercises.TYPE_NAMES) assert.equal(FT.codec.validSession({ id: 's', startedAt: 1, type, words: [] }), true, type);
  assert.equal(FT.codec.validSession({ id: 's', startedAt: 1, type: 'unknown', words: [] }), false);
});
