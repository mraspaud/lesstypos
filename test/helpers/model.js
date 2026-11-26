'use strict';
// Synthetic timing records and sessions for training the sequence model
// (FT.model) without the typing pipeline.

// A standard normal draw (Box–Muller).
function gauss(rng) {
  const u = rng() || 1e-12, v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// count words drawn from words, as timing records. rule(ctx, ch) → null or
// { log: mean log time ratio, p: error probability } for the keystroke of ch
// after the context ctx (up to three characters); otherwise 0 and 1%.
function syntheticRecords(FT, words, count, rule, seed) {
  const rng = FT.rng(seed);
  const records = [];
  let text = '';
  for (let i = 0; i < count; i++) {
    const w = words[Math.floor(rng() * words.length)] + ' ';
    Array.from(w).forEach((ch, pos) => {
      const ctx = text.slice(-3);
      const r = rule(ctx, ch) || {};
      const err = rng() < (r.p ?? 0.01) ? 1 : 0;
      const logRatio = (r.log ?? 0) + 0.25 * gauss(rng);
      records.push({ ch, ctx, err, clean: !err, logRatio, ratio: Math.exp(logRatio), word: w.trim(), wordInitial: pos === 0 });
      text += ch;
    });
  }
  return records;
}

// Ingests `sessions` sessions of synthetic records into model: session
// first + i on day dayOf(i), its records drawn with seed + i.
function trainSessions(FT, model, { words, count, rule = () => null, seed, sessions = 1, first = 1, dayOf = (i) => i, late }) {
  for (let i = 0; i < sessions; i++) {
    const opts = { session: first + i, day: dayOf(i) };
    if (late) opts.late = late;
    model.ingest(syntheticRecords(FT, words, count, rule, seed + i), opts);
  }
  return model;
}

module.exports = { gauss, syntheticRecords, trainSessions };
