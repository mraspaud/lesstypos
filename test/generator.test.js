'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: the word generator mixes vocabulary around a continuous
// difficulty frontier with words carrying contexts that need practice, while
// keeping an unbiased random sample that is tagged and never influenced by
// targeting.

const FT = load();
const LIST = ('the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part ' +
  'strong street stream strange struggle structure instruction abstract string strike stripe destroy district ' +
  'good third think three those though bad old cold hold word mind kind hand land find end send').split(' ');
const corpus = () => FT.corpus.fromList(LIST);

test('the corpus finds carrier words for within-word and boundary contexts', () => {
  const c = corpus();
  const str = plain(c.containing('str').map((i) => c.words[i]));
  assert.ok(str.includes('strong') && str.includes('abstract') && str.includes('destroy'));
  const initial = plain(c.containing(' th').map((i) => c.words[i]));
  assert.ok(initial.includes('the') && !initial.includes('other'));
  const final = plain(c.containing('nd ').map((i) => c.words[i]));
  assert.ok(final.includes('and') && final.includes('kind'));
});

test('without targets: about 20% unbiased random words, the rest frontier words', () => {
  const g = FT.generator.create({ corpus: corpus(), seed: 1 });
  const out = g.next(1000, { frontier: 100, targets: [] });
  const share = out.filter((w) => w.source === 'random').length / out.length;
  assert.ok(share > 0.15 && share < 0.25, String(share));
  assert.ok(out.every((w) => w.source === 'random' || w.source === 'frontier'));
});

test('the frontier controls vocabulary rank with a small look-ahead', () => {
  const c = corpus();
  const g = FT.generator.create({ corpus: c, seed: 2 });
  const out = g.next(2000, { frontier: 40, targets: [] });
  const ranks = out.map((w) => c.rankOf(w.word));
  const beyond = ranks.filter((r) => r >= 40).length / ranks.length;
  assert.ok(beyond > 0.03 && beyond < 0.2, String(beyond));
  assert.ok(Math.max(...ranks) < 60);
});

test('target contexts appear in varied carrier words', () => {
  const g = FT.generator.create({ corpus: corpus(), seed: 3 });
  const out = g.next(600, { frontier: 100, targets: [{ key: 'str', priority: 1, stage: 'weak' }] });
  const t = out.filter((w) => w.source === 'target');
  const share = t.length / out.length;
  assert.ok(share > 0.2 && share < 0.4, String(share));
  assert.ok(t.every((w) => w.word.includes('str') && w.target === 'str'));
  assert.ok(new Set(t.map((w) => w.word)).size >= 6);
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].word, out[i - 1].word);
});

test('a cross-word target produces a word pair forming the transition', () => {
  const g = FT.generator.create({ corpus: corpus(), seed: 4 });
  const out = g.next(300, { frontier: 100, targets: [{ key: 'd th', priority: 1, stage: 'weak' }] });
  let pairs = 0;
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i].target === 'd th' && out[i + 1].target === 'd th') {
      assert.ok(out[i].word.endsWith('d') && out[i + 1].word.startsWith('th'));
      pairs++; i++;
    }
  }
  assert.ok(pairs > 10);
});

test('due maintenance contexts are tagged as maintenance', () => {
  const g = FT.generator.create({ corpus: corpus(), seed: 5 });
  const out = g.next(500, { frontier: 100, targets: [{ key: 'old', priority: 0.2, stage: 'mastered', due: true }] });
  assert.ok(out.some((w) => w.source === 'maintenance' && w.word.includes('old')));
  assert.ok(!out.some((w) => w.source === 'target'));
});

test('the unbiased sample is identical with or without targeting', () => {
  const a = FT.generator.create({ corpus: corpus(), seed: 6 }).next(400, { frontier: 100, targets: [] });
  const b = FT.generator.create({ corpus: corpus(), seed: 6 }).next(400, { frontier: 100, targets: [{ key: 'str', priority: 1, stage: 'weak' }] });
  const ra = a.filter((w) => w.source === 'random').map((w) => w.word).slice(0, 50);
  const rb = b.filter((w) => w.source === 'random').map((w) => w.word).slice(0, 50);
  assert.deepEqual(plain(rb), plain(ra));
});

test('the bundled English list loads with ranks', () => {
  const c = FT.corpus.get('en');
  assert.ok(c.words.length >= 25000);
  assert.equal(c.words[0], 'the');
  assert.equal(c.rankOf('the'), 0);
});
