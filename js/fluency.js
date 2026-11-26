// Fluency index (experimental; design choice, our own synthesis): the relaxed
// speed that the current sequence statistics predict on a fixed reference
// text, so that speed compares over time while the training keeps changing
// what is typed.
// - Keystroke-level prediction, in the spirit of Card, Moran & Newell (1980):
//   the time of a text is the sum of the times of its keystrokes.
// - A keystroke's time depends on the letters before it (Gentner 1983;
//   Salthouse 1986): its longest context with enough timed keystrokes
//   (FT.model.timedContext) gives its time ratio to a session's centre.
// - An error costs extra keystrokes, the slip and its backspace, as in the
//   keystrokes-per-character measure of Soukoreff & MacKenzie (2003).
// - The scale, in ms per keystroke at ratio 1 for each population (within
//   words and word-initial), comes from recent relaxed practice: variant A,
//   predicted speed, from all of it; variant B, effortless speed, only from
//   exercises rated effort 1-2.
// Not validated: each benchmark is compared with the prediction made before it
// (FT.progress.fluencyCheck), and that error is all the index can claim.
(function (FT) {
  'use strict';
  // Design choices: the reference's size and seed (its draw is frozen).
  var REFERENCE_WORDS = 1000, REFERENCE_SEED = 20261126;

  // The keystrokes of a text of words, each followed by a space: the context
  // key the model judges (up to MAX_ORDER characters ending at it) and
  // whether it starts a word.
  function referenceOf(words) {
    var text = words.join(' ') + ' ', order = FT.evidence.MAX_ORDER, keystrokes = [];
    for (var i = 0; i < text.length; i++) {
      keystrokes.push({ key: text.slice(Math.max(0, i - order + 1), i + 1), initial: i === 0 || text[i - 1] === ' ' });
    }
    return { words: words, keystrokes: keystrokes };
  }

  // The reference text of a corpus: drawn once, seeded, as the benchmark
  // draws its words (FT.exercises.benchmarkSampler).
  var references = new Map();
  function reference(corpus) {
    if (!references.has(corpus)) {
      var words = FT.exercises.benchmarkSampler(corpus, FT.rng(REFERENCE_SEED))(REFERENCE_WORDS);
      references.set(corpus, referenceOf(words));
    }
    return references.get(corpus);
  }

  FT.fluency = { reference: reference, referenceOf: referenceOf, REFERENCE_WORDS: REFERENCE_WORDS };
})(globalThis.FT);
