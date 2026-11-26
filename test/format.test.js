'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

// Functionality: the Sequences page says which keys the keyboard sends late
// and what that means for their judgement.
const FT = load();

test('the late-key note lists the keys, space as ␣, and says what is still judged', () => {
  const html = FT.fmt.lateNote([' ', 'e', 'n', 'r']);
  assert.match(html, /␣/);
  assert.match(html, /<span class="seq">e<\/span>, <span class="seq">n<\/span> and <span class="seq">r<\/span>/);
  assert.match(html, /speed is not judged/);
  assert.match(html, /errors are/);
});

test('no late keys, no note', () => {
  assert.equal(FT.fmt.lateNote([]), '');
  assert.equal(FT.fmt.lateNote(undefined), '');
});

test('the storage line gives sessions and statistics sizes', () => {
  assert.equal(FT.fmt.storageLine({ sessions: 12, sessionBytes: 2.5 * 1048576, profileBytes: 400 * 1024 }),
    '12 exercises take 2.5 MB; statistics derived from them take 400 KB.');
  assert.equal(FT.fmt.storageLine({ sessions: 1, sessionBytes: 900, profileBytes: 0 }), '1 exercise takes 1 KB; statistics derived from them take 0 KB.');
});

// Functionality: one name per thing. A sequence's training stage and the
// model's judgement used the same words ("weak"); each now has its own label,
// and the Focus page explains them in one legend.
test('stages and judgements have distinct, plain labels', () => {
  assert.equal(FT.fmt.stageLabel('weak'), 'in training');
  assert.equal(FT.fmt.stageLabel('mastered'), 'mastered');
  assert.equal(FT.fmt.stateLabel('weak'), 'more errors');
  assert.equal(FT.fmt.stateLabel('hesitant'), 'slower');
  assert.equal(FT.fmt.stateLabel('emerging'), 'seen in 1 session');
  assert.match(FT.fmt.stagePill('weak'), /class="pill weak"[^>]*>in training</);
  assert.match(FT.fmt.statePill('hesitant'), />slower</);
  const legend = FT.fmt.statusLegend().toLowerCase();
  for (const w of ['in training', 'improving', 'consolidating', 'mastered', 'slower', 'more errors', 'seen in 1 session']) assert.ok(legend.includes(w), w);
});
