'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: progress is judged at matched effort and accuracy. The same
// speed at lower effort counts as progress, like more speed at the same effort.

const FT = load();
const h = (wpm, effort, faa = 0.99, type = 'relaxed') => ({ type, wpm, effort, faa, words: 200 });

test('compares speed with recent sessions at the same effort', () => {
  const hist = [h(50, 2), h(52, 2), h(51, 2), h(60, 4)];
  const c = plain(FT.progress.compare(hist, h(55, 2)));
  assert.equal(c.kind, 'same-effort');
  assert.equal(c.baselineWpm, 51);
  assert.equal(c.deltaWpm, 4);
});

test('the same speed at lower effort is reported as progress', () => {
  const hist = [h(54, 3), h(55, 3), h(53, 3)];
  const c = plain(FT.progress.compare(hist, h(54, 2)));
  assert.equal(c.kind, 'lower-effort');
  assert.ok(c.message.includes('less effort'));
});

test('sessions with clearly lower accuracy are not used as a baseline', () => {
  const hist = [h(70, 2, 0.95), h(50, 2), h(50, 2)];
  assert.equal(FT.progress.compare(hist, h(52, 2)).baselineWpm, 50);
});

test('no comparison without enough comparable sessions or an effort rating', () => {
  assert.equal(FT.progress.compare([h(50, 2)], h(52, 2)), null);
  assert.equal(FT.progress.compare([h(50, 2), h(50, 2)], h(52, null)), null);
  assert.equal(FT.progress.compare([h(50, 2, 0.99, 'bursts'), h(50, 2, 0.99, 'bursts')], h(52, 2)), null);
});

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

test('the timeline gives per-word and running speed and marks errors', () => {
  // "abcd " = 5 chars; at 100 ms per key a word takes 0.5 s -> 5/5 / (0.5/60) = 120 WPM
  const words = typedWords([['abcd', 'abcd ', 100], ['efgh', 'efgh ', 200], ['ijkl', 'ixjkl<<jkl ', 100]]);
  const tl = plain(FT.progress.timeline(words));
  assert.equal(tl.length, 3);
  assert.equal(tl[0].word, 'abcd');
  assert.equal(Math.round(tl[1].burst), 60);
  assert.equal(tl[0].error, false);
  assert.equal(tl[2].error, true);
  // running WPM after word 2: 10 correct chars in 0.4 s + 1.0 s = 1.4 s ... measured from the first keystroke
  assert.ok(tl[1].running > 60 && tl[1].running < 120);
});

test('the first word is timed from its first keystroke', () => {
  const words = typedWords([['abcd', 'abcd ', 100]]);
  const tl = FT.progress.timeline(words);
  assert.equal(Math.round(tl[0].burst), 150); // 5 chars over 0.4 s between first and last keydown
});
