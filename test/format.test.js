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

// Functionality: summaries and the focus list say in one line what changed
// and why a sequence is trained.
test('one sentence on the vocabulary decision', () => {
  assert.equal(FT.fmt.vocabSentence({ action: 'advance', reasons: ['accuracy 99.7% over 180 words'] }, 1650),
    'Vocabulary grows to the 1,650 most common words: accuracy 99.7% over 180 words.');
  assert.equal(FT.fmt.vocabSentence({ action: 'hold', reasons: ['effort 4 of 5'] }, 900), 'Vocabulary stays at the 900 most common words: effort 4 of 5.');
  assert.equal(FT.fmt.vocabSentence(null, 900), '');
});

test('a focus reason names the comparison', () => {
  assert.equal(FT.fmt.focusReason({ hesitant: true, latRel: 1.62, parent: 'ea' }), 'slower: ×1.6 against <span class="seq">ea</span> elsewhere');
  assert.equal(FT.fmt.focusReason({ weak: true, errorRate: 0.04, parentErrorRate: 0.012, parent: 'n' }), 'more errors: 4.0% against 1.2% for <span class="seq">n</span> elsewhere');
  assert.equal(FT.fmt.focusReason({ hesitant: true, latRel: 1.3, parent: null }), 'slower: ×1.3 against all your typing');
  assert.equal(FT.fmt.focusReason({ latRel: 1.04, parent: 'a' }, 'improving'), 'improving: ×1.0 against <span class="seq">a</span> now');
});
