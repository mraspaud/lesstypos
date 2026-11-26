// Writes test/fixtures/golden-raws.json: synthetic raw exercises (no user
// data) covering every exercise type, corrections, multi-letter keys, keys
// sent late, swapped letters and a daily-training run. The golden test
// rebuilds a profile from them and compares it with a stored snapshot.
// Run: node tools/make_golden.js   (then: UPDATE_GOLDEN=1 node --test test/golden.test.js)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../test/helpers/load');

const FT = load();
const rng = FT.rng(20261126);
const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 5, 9);

// Types the words with a steady rhythm, the occasional slip, a corrected
// swap, the th key as one input event and space sent late (instant key-up).
function type(words, t0) {
  const s = FT.session.create(words.map((w) => w.word || w));
  const keys = [];
  let t = t0;
  const key = (code, hold) => { keys.push({ k: 'd', c: code, t }, { k: 'u', c: code, t: t + hold }); };
  const press = (ch) => {
    t += 90 + Math.round(rng() * 120);
    key(ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), ch === ' ' ? 0.5 : 70 + Math.round(rng() * 30));
    s.input({ kind: 'text', data: ch, t });
  };
  const back = () => { t += 150; key('Backspace', 60); s.input({ kind: 'back', t }); };
  for (const w of s.state().words) {
    const target = w.target;
    let i = 0;
    while (i < target.length) {
      const r = rng();
      if (target.slice(i, i + 2) === 'th') { t += 120; key('KeyT', 0.5); s.input({ kind: 'text', data: 'th', t }); i += 2; continue; }
      if (r < 0.02 && i + 1 < target.length && target[i] !== target[i + 1]) { press(target[i + 1]); press(target[i]); back(); back(); }
      else if (r < 0.04) { press('x'); if (rng() < 0.7) back(); else { i++; continue; } }
      press(target[i]); i++;
    }
    press(' ');
  }
  return { words: s.state().words.filter((w) => w.committed), keys, end: t };
}

const tr = FT.trainer.create({ seed: 77, settings: { macros: ['th'], accents: true } });
const raws = [];
let day = 0;
function exercise(type_, extra = {}) {
  const ex = tr.newExercise(Object.assign({ type: type_ }, extra));
  const start = T0 + day * DAY;
  const typed = type(ex.words.slice(0, extra.n || 60), 0);
  const res = tr.finish(Object.assign({ type: type_, startedAt: start, durationMs: typed.end, words: typed.words, keys: typed.keys,
    effort: 1 + Math.floor(rng() * 4) }, extra.finish || {}));
  raws.push(res.raw);
}
const text = { id: 'golden-text', title: 'Golden', pos: 0, words: ('It was the best of times, it was the worst of times, it was the age of wisdom, ' +
  'it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, ' +
  'it was the season of Darkness, it was the spring of hope, it was the winter of despair.').split(' ') };
for (day = 0; day < 4; day++) {
  const run = 'golden-run-' + day;
  exercise('warmup', { run, n: 40, finish: { run } });
  exercise('relaxed', { run, finish: { run } });
  exercise('targeted', { run, n: 50, finish: { run } });
  if (day === 2) exercise('prose', { text: Object.assign({}, text), n: 30, finish: { run, text: { id: text.id, from: 0 } } });
}
exercise('bursts', { n: 40, finish: { rounds: [{ start: 0, end: 15000 }, { start: 25000, end: 40000 }] } });
for (let i = 0; i < 3; i++) exercise('benchmark', { n: 40, finish: { set: 'golden-set', planMs: 60000, effort: null } });

const out = path.join(__dirname, '..', 'test', 'fixtures', 'golden-raws.json');
fs.writeFileSync(out, JSON.stringify(raws.map(FT.codec.encodeSession)));
console.log(out, raws.length, 'exercises', (fs.statSync(out).size / 1024).toFixed(0), 'KB');
