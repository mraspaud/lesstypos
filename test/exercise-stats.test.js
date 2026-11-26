'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const FT = load();

// Functionality: a per-word timeline of the exercise (like Monkeytype's
// result chart): speed of each word, running average speed, and the words
// whose first attempt had an error.
function typedWords(script) {
  const s = FT.session.create(script.map((x) => x[0]));
  let t = 0;
  for (const [, typed, dt] of script) for (const ch of typed) {
    t += dt;
    s.input(ch === '<' ? { kind: 'back', t } : { kind: 'text', data: ch, t });
  }
  return s.state().words.filter((w) => w.committed);
}
const timeline = (words) => FT.exerciseStats.timeline(words, FT.align.analyzeWords(words));

test('the timeline gives per-word and running speed and marks errors', () => {
  // "abcd " = 5 chars; at 100 ms per key a word takes 0.5 s -> 5/5 / (0.5/60) = 120 WPM
  const words = typedWords([['abcd', 'abcd ', 100], ['efgh', 'efgh ', 200], ['ijkl', 'ixjkl<<jkl ', 100]]);
  const tl = plain(timeline(words));
  assert.equal(tl.length, 3);
  assert.equal(tl[0].word, 'abcd');
  assert.equal(Math.round(tl[1].burst), 60);
  assert.equal(tl[0].error, false);
  assert.equal(tl[2].error, true);
  // running WPM after word 2: 10 correct chars in 0.4 s + 1.0 s = 1.4 s ... measured from the first keystroke
  assert.ok(tl[1].running > 60 && tl[1].running < 120);
});

test('the first word is timed from its first keystroke, over the characters after it', () => {
  const words = typedWords([['abcd', 'abcd ', 100]]);
  const tl = timeline(words);
  assert.equal(Math.round(tl[0].burst), 120); // 4 keystrokes after the first, in 0.4 s
});

test('the running speed starts after the first keystroke too', () => {
  const tl = timeline(typedWords([['abcd', 'abcd ', 100]]));
  assert.equal(Math.round(tl[0].running), Math.round(tl[0].burst));
});

// Functionality: per-key error statistics for the heatmap. A multi-letter key
// (th) is one press; where wrong presses land is counted too.
// Words as typed: [target, typed], where [..] in typed is one multi-character input event.
function wordsWithPresses(pairs) {
  return pairs.map(([p, typed]) => {
    const stream = [];
    let g = 0, t = 0;
    for (const part of (typed + ' ').match(/\[[^\]]+\]|./g)) {
      g++; t += 100;
      if (part === '<') { stream.push({ k: 'b', t }); continue; }
      for (const ch of part.replace(/^\[|\]$/g, '')) stream.push({ k: 'c', ch, t, g });
    }
    return { target: p, stream };
  });
}
const keyStats = (words, macros, analysisOpts) => FT.exerciseStats.keyStats(words, FT.align.analyzeWords(words, analysisOpts), { macros });

test('key statistics count presses, with multi-letter keys as one press', () => {
  const ks = plain(keyStats(wordsWithPresses([['the', 'the'], ['then', 'tgen'], ['art', 'art']]), ['th']));
  assert.deepEqual(ks.keys.th, [2, 1]);       // two presses of the th key, one wrong first attempt
  assert.deepEqual(ks.keys.t, [1, 0]);        // the t in "art" is a plain t press
  assert.deepEqual(ks.keys.e, [2, 0]);
  assert.deepEqual(ks.keys[' '], [3, 0]);
  assert.deepEqual(ks.land, { g: 1 });         // the wrong press landed on g
});

test('without declared multi-letter keys every character is its own press', () => {
  const ks = plain(keyStats(wordsWithPresses([['the', 'thx<e']]), []));
  assert.deepEqual(ks.keys.t, [1, 0]);
  assert.deepEqual(ks.keys.e, [1, 1]);
  assert.deepEqual(ks.land, { x: 1 });
});

test('a wrong press of a multi-letter key lands on that key', () => {
  const ks = plain(keyStats(wordsWithPresses([['to', '[th]<<to']]), ['th']));
  assert.deepEqual(ks.land, { th: 1 });
});

test('multi-letter keys match regardless of capitals', () => {
  const ks = plain(keyStats(wordsWithPresses([['The', 'The']]), ['th']));
  assert.deepEqual(ks.keys.th, [1, 0]);
});

test('a missed multi-letter press counts as one full error on its key', () => {
  assert.deepEqual(plain(keyStats(wordsWithPresses([['the', 'xe']]), ['th'], { macros: ['th'] }).keys.th), [1, 1]);
});
