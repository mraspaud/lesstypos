'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// Functionality: raw sessions are stored compactly and decode to exactly the
// same session. Times are already at 0.01 ms (trainer.finish).

const FT = load();
const { encodeSession, decodeSession } = FT.codec;
const r2 = (t) => Math.round(t * 100) / 100;

function session(words, keys, extra = {}) {
  return Object.assign({ id: 'x1', schema: 1, type: 'relaxed', lang: 'en', startedAt: 5, day: 0, durationMs: 1000, effort: 2,
    macros: ['th'], accents: true, run: null, set: null, planMs: null, words, keys }, extra);
}

// A realistic session from a typing script ('<' = backspace).
function realistic(nWords = 200) {
  const rng = FT.rng(7), words = [], keys = [];
  let t = 1000, g = 0;
  for (let i = 0; i < nWords; i++) {
    const target = ['the', 'people', 'other', 'which', 'about'][i % 5];
    const typed = i % 9 === 0 ? target.slice(0, 2) + 'x<' + target.slice(2) + ' ' : target + ' ';
    const stream = [];
    for (const ch of typed) {
      t = r2(t + 80 + rng() * 120);
      const code = ch === '<' ? 'Backspace' : ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase();
      keys.push({ k: 'd', c: code, t }, { k: 'u', c: code, t: r2(t + 60 + rng() * 40) });
      stream.push(ch === '<' ? { k: 'b', t } : { k: 'c', ch, t, g: g++ });
    }
    words.push({ target, stream, meta: { source: i % 5 ? 'frontier' : 'random' } });
  }
  return session(words, keys);
}

const roundTrip = (s) => plain(decodeSession(plain(encodeSession(s))));

test('a realistic session decodes to exactly the same session, at a third of the size or less', () => {
  const s = realistic();
  const enc = plain(encodeSession(s));
  assert.equal(enc.enc, 1);
  assert.deepEqual(plain(decodeSession(enc)), plain(s));
  assert.ok(JSON.stringify(enc).length * 3 <= JSON.stringify(s).length, JSON.stringify(enc).length + ' vs ' + JSON.stringify(s).length);
});

test('corrections typed into an earlier word (times going back) survive', () => {
  const w1 = { target: 'ab', stream: [{ k: 'c', ch: 'a', t: 10, g: 0 }, { k: 'c', ch: 'x', t: 20, g: 1 }, { k: 'b', t: 900.5 }, { k: 'c', ch: 'b', t: 901.25, g: 5 }], meta: null };
  const w2 = { target: 'cd', stream: [{ k: 'c', ch: 'c', t: 300, g: 2 }, { k: 'c', ch: 'd', t: 400, g: 3 }], meta: { source: 'target' } };
  const s = session([w1, w2], []);
  assert.deepEqual(roundTrip(s), plain(s));
});

test('a multi-letter input event, entries without a group, auto spaces and astral characters survive', () => {
  const st = [{ k: 'c', ch: 't', t: 1, g: 4 }, { k: 'c', ch: 'h', t: 1, g: 4 }, { k: 'c', ch: 'e', t: 2.5 },
    { k: 'c', ch: '😀', t: 3, g: 6 }, { k: 'c', ch: ' ', t: 3, g: 6, auto: true }];
  const s = session([{ target: 'the😀', stream: st, meta: null }], [{ k: 'd', c: 'KeyT', t: 0.99 }]);
  assert.deepEqual(roundTrip(s), plain(s));
});

test('other session fields pass through; sessions without keys or with unknown fields stay intact', () => {
  const s = session([{ target: 'a', stream: [{ k: 'c', ch: 'a', t: 1, g: 0 }], meta: null }], [], { rounds: [{ start: 1, end: 2 }], text: { id: 't', from: 0, to: 1 } });
  delete s.keys;
  assert.deepEqual(roundTrip(s), plain(s));
  const odd = session([{ target: 'a', stream: [{ k: 'c', ch: 'a', t: 1, g: 0, extra: 7 }], meta: null }], []);
  assert.deepEqual(roundTrip(odd), plain(odd));
});

test('a session stored before compaction decodes as it is', () => {
  const s = realistic(3);
  assert.deepEqual(plain(decodeSession(plain(s))), plain(s));
});

// Review findings: odd shapes are kept as they are, never corrupted.
test('lone surrogate halves, non-finite times and prototype-named key codes survive', () => {
  const halves = session([{ target: 'x', stream: [{ k: 'c', ch: '\uD83D', t: 1, g: 0 }, { k: 'c', ch: '\uDE00', t: 2, g: 1 }, { k: 'b', t: 3 }], meta: null }], []);
  assert.deepEqual(roundTrip(halves), plain(halves));
  const nan = session([{ target: 'ab', stream: [{ k: 'c', ch: 'a', t: NaN, g: 0 }], meta: null }, { target: 'b', stream: [{ k: 'c', ch: 'b', t: 5, g: 1 }], meta: null }],
    [{ k: 'd', c: 'KeyA', t: Infinity }, { k: 'd', c: 'KeyB', t: 7 }]);
  const enc = encodeSession(nan), dec = decodeSession(enc);
  assert.ok(Number.isNaN(dec.words[0].stream[0].t));
  assert.equal(dec.words[1].stream[0].t, 5);
  assert.equal(dec.keys[0].t, Infinity);
  const proto = session([], [{ k: 'd', c: 'constructor', t: 1 }, { k: 'u', c: '__proto__', t: 2 }, { k: 'd', c: 'toString', t: 3 }]);
  assert.deepEqual(roundTrip(proto), plain(proto));
});

test('words with extra fields or no stream, and sessions without words, stay intact', () => {
  const s = session([{ target: 'a', stream: [{ k: 'c', ch: 'a', t: 1, g: 0 }], meta: null, tEnd: 9 }, { target: 'b', meta: null }], []);
  assert.deepEqual(roundTrip(s), plain(s));
  const bare = { id: 'z', startedAt: 1, type: 'relaxed' };
  assert.deepEqual(roundTrip(bare), bare);
});

test('a damaged encoded session is recognised', () => {
  const enc = plain(encodeSession(session([{ target: 'ab', stream: [{ k: 'c', ch: 'a', t: 1, g: 0 }, { k: 'c', ch: 'b', t: 2, g: 1 }], meta: null }], [{ k: 'd', c: 'KeyA', t: 1 }])));
  assert.equal(FT.codec.validSession(enc), true);
  const cut = plain(enc); cut.words[0].t.pop();
  assert.equal(FT.codec.validSession(cut), false);
  const badKeys = plain(enc); badKeys.keys.ev.push(9);
  assert.equal(FT.codec.validSession(badKeys), false);
  assert.equal(FT.codec.validSession({ id: 'plain', startedAt: 1, type: 'relaxed', words: [] }), true);
});

test('a session needs an id, a start time, a known type and its words to be valid', () => {
  const ok = { id: 's', startedAt: 1, type: 'relaxed', words: [] };
  assert.equal(FT.codec.validSession(ok), true);
  for (const bad of [{ startedAt: 1, type: 'relaxed', words: [] }, { id: 's', type: 'relaxed', words: [] },
    { id: 's', startedAt: 1, type: 'nope', words: [] }, { id: 's', startedAt: 1, type: 'relaxed' }]) {
    assert.equal(FT.codec.validSession(bad), false, JSON.stringify(bad));
  }
});

test('a session’s tags, when it has any, are a list of tags', () => {
  const withTags = (tags) => ({ id: 's', startedAt: 1, type: 'relaxed', words: [], tags });
  assert.equal(FT.codec.validSession(withTags(['home', 'wrist-rest'])), true);
  for (const bad of ['home', ['home', 5], ['Home'], ['two words'], { home: true }]) {
    assert.equal(FT.codec.validSession(withTags(bad)), false, JSON.stringify(bad));
  }
});
