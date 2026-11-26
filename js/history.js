// History: one compact entry per processed exercise, derived from its raw
// record. The progress views, the burst target and the exercise log read
// these entries; their schema is defined here only.
(function (FT) {
  'use strict';
  var MIN_WORDS = 50;

  // measured: what processing found (see trainer.process).
  function entry(raw, measured) {
    var m = measured, landings = m.keyStats.land, tags = FT.conditions.cleanTags(raw.tags);
    return {
      id: raw.id, type: raw.type, run: raw.run || undefined, tags: tags.length ? tags : undefined,
      startedAt: raw.startedAt, durationMs: raw.durationMs, plannedMs: raw.planMs || undefined,
      benchmarkSet: raw.set || undefined, effort: raw.effort,
      words: m.metrics.words, wpm: m.metrics.wpm,
      firstAttemptAccuracy: m.metrics.firstAttemptAccuracy, randomFirstAttemptAccuracy: m.random.firstAttemptAccuracy,
      hesitationRate: m.hesitationRate, rhythmCv: m.rhythmCv, rollover: m.rollover, wordStartMs: m.wordStartMs,
      commonPairMs: m.commonPairs.ms, commonPairIntervals: m.commonPairs.n,
      frontier: m.frontier, vocabularyDecision: m.vocabularyDecision || undefined, burstRounds: m.burstRounds || undefined,
      keyPresses: m.keyStats.keys, wrongPressLandings: Object.keys(landings).length ? landings : undefined,
    };
  }

  // Long enough, and timed, to compare with other exercises of its type.
  function isComparable(h) { return h.wpm != null && h.words >= MIN_WORDS; }
  function isComparableRelaxed(h) { return h.type === 'relaxed' && isComparable(h); }

  // Whether an exercise of a daily training was done on that local day.
  function trainedOn(history, day) {
    return history.some(function (h) { return h.run && FT.days.number(h.startedAt) === day; });
  }

  FT.history = { trainedOn: trainedOn, entry: entry, isComparable: isComparable, isComparableRelaxed: isComparableRelaxed };
})(globalThis.FT);
