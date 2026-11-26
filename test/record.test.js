'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');
const helpers = require('./helpers/typing');

// Functionality: a finished exercise becomes a raw record without the DOM:
// paused time does not count, exercises too short to analyse are not
// recorded, and saving one moves the place in its book.
const FT = load();
const START = Date.UTC(2026, 0, 5, 9);

function freshApp() {
  const app = FT.ui.app;
  app.settings = FT.settings.clean({});
  app.trainer = FT.trainer.create({ seed: 3 });
  app.store = FT.store.create({ adapter: FT.store.memoryAdapter() });
  app.run = null;
  return app;
}
// Types the words correctly, one key every 100 ms from t = 1000 (keystroke clock).
function typedWords(targets) {
  return helpers.typedWords(FT, targets.map((word) => ({ word, source: 'random' })), targets.join(' ') + ' ', { at: 1000 });
}
function typed(words, more) {
  return Object.assign({ type: 'relaxed', startedAt: START, words, keys: [], firstKeyAt: 1000, pauses: [], opts: {}, text: null, rounds: null, textFinished: false }, more);
}
const TWELVE = ['one', 'two', 'six', 'ten', 'red', 'sun', 'cup', 'map', 'hat', 'pen', 'box', 'jam'];

test('the duration runs from the first key to the last word, without the pauses', () => {
  freshApp();
  const words = typedWords(TWELVE);
  const end = words[words.length - 1].tEnd;
  const plain = FT.ui.recordExercise(typed(words));
  const paused = FT.ui.recordExercise(typed(words, { pauses: [[1500, 2500], [end + 100, end + 900]] }));
  assert.equal(plain.raw.durationMs, end - 1000);
  assert.equal(paused.raw.durationMs, end - 1000 - 1000);
});

test('the record keeps when the exercise ended on the wall clock, pauses included', () => {
  freshApp();
  const info = FT.ui.recordExercise(typed(typedWords(TWELVE), { endedAt: START + 600e3 }));
  assert.equal(info.raw.endedAt, START + 600e3);
});

test('fewer than 10 words are not recorded, unless they finished the text', () => {
  freshApp();
  const words = typedWords(TWELVE.slice(0, 9));
  assert.equal(FT.ui.recordExercise(typed(words)), null);
  assert.ok(FT.ui.recordExercise(typed(words, { textFinished: true })));
});

test('speed bursts with no finished round are not recorded', () => {
  freshApp();
  assert.equal(FT.ui.recordExercise(typed(typedWords(TWELVE), { type: 'bursts', rounds: [] })), null);
});

test('the recorded exercise keeps its type and options for the effort rating and summary', () => {
  freshApp();
  const opts = { minutes: 2, pinned: ['th'] };
  const info = FT.ui.recordExercise(typed(typedWords(TWELVE), { opts }));
  assert.equal(info.type, 'relaxed');
  assert.equal(info.opts, opts);
  assert.equal(info.raw.words.length, 12);
});

test('saving a prose exercise stores its rating and moves the place in the book', async () => {
  const app = freshApp();
  const book = { id: 'b', title: 'Book', pos: 0, words: TWELVE.concat(TWELVE) };
  const info = FT.ui.recordExercise(typed(typedWords(TWELVE), { type: 'prose', text: { id: 'b', from: 0 }, opts: { text: book } }));
  info.effort = 2;
  const summary = FT.ui.saveExercise(info);
  assert.equal(book.pos, 12);
  assert.deepEqual({ ...summary.textProgress }, { title: 'Book', pos: 12, total: 24 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await app.store.getSession(info.raw.id)).effort, 2);
  assert.equal((await app.store.getText('b')).pos, 12);
});
