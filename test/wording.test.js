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
