// A finished exercise, free of the DOM: its raw record from what the typing
// screen saw, then (once rated) its processing, saving and the place in the
// book and the daily training it moves on.
(function (FT) {
  'use strict';
  var U = FT.ui, app = U.app;
  var MIN_WORDS = 10;

  // Time spent paused between a and b (performance clock).
  function pausedWithin(pauses, a, b) {
    return pauses.reduce(function (sum, p) { return sum + Math.max(0, Math.min(b, p[1]) - Math.max(a, p[0])); }, 0);
  }
  // From the first key to the end of the last word, without the pauses.
  function typingMs(words, firstKeyAt, pauses) {
    if (!words.length) return 0;
    var end = words[words.length - 1].tEnd;
    return end - firstKeyAt - pausedWithin(pauses, firstKeyAt, end);
  }
  function tooShort(typed) {
    return (typed.words.length < MIN_WORDS && !typed.textFinished) || !!(typed.rounds && !typed.rounds.length);
  }
  // An exercise in the same sitting as the previous one takes its conditions.
  function sameSittingTags(startedAt) {
    var sitting = FT.conditions.sittingTags(app.trainer.history(), startedAt);
    return sitting.ask ? undefined : sitting.tags;
  }

  // typed: { type, startedAt, endedAt (wall clock), words (committed), keys,
  // firstKeyAt, pauses, opts, text, rounds, textFinished }. Returns the exercise to rate and save,
  // or null when it was too short to analyse.
  function recordExercise(typed) {
    if (tooShort(typed)) return null;
    var opts = typed.opts;
    var raw = app.trainer.record({ type: typed.type, startedAt: typed.startedAt, endedAt: typed.endedAt, durationMs: typingMs(typed.words, typed.firstKeyAt, typed.pauses),
      words: typed.words, keys: typed.keys, text: typed.text, rounds: typed.rounds, run: opts.run, tags: sameSittingTags(typed.startedAt),
      set: opts.bench ? app.bench.set : null, planMs: opts.bench ? opts.minutes * 60000 : null });
    return { type: typed.type, raw: raw, opts: opts };
  }

  // Processes and saves an exercise with its effort rating (info.effort);
  // returns its summary.
  function saveExercise(info) {
    var raw = info.raw;
    raw.effort = info.effort == null ? null : info.effort;
    var summary = app.trainer.process(raw);
    var writes = [app.store.saveSession(raw).then(U.saveProfile).then(function () { return app.store.clearDraft(); })];
    var text = info.opts.text;
    if (raw.text && text) {
      var place = FT.books.placeAfter(text, raw.text.from, raw.words);
      text.pos = place != null ? place : raw.text.to;
      summary.textProgress = { title: text.title, pos: text.pos, total: text.words.length };
      writes.push(app.store.saveText(text));
    }
    Promise.all(writes).catch(U.storageError);
    if (info.opts.programme && app.run) {
      var m = summary.metrics;
      app.run.complete({ ms: summary.durationMs, wpm: m.wpm, faa: m.firstAttemptAccuracy, effort: info.effort,
        note: summary.rounds ? 'target ' + Math.round(app.trainer.bursts.target()) + ' WPM'
          : summary.textProgress ? FT.fmt.textProgress(summary.textProgress, summary.textProgress.pos) : '' });
      U.saveRun();
    }
    return summary;
  }

  // What a reload needs to ask for the rating again: the recorded exercise and
  // the few screen options that shape what follows.
  function draftOf(info) {
    var o = info.opts;
    return { raw: info.raw, ui: { programme: !!o.programme, run: o.run || null, minutes: o.minutes || null,
      pinned: o.pinned || null, textId: o.text ? o.text.id : null } };
  }
  function infoFromDraft(draft, text) {
    var ui = draft.ui;
    var opts = { programme: ui.programme, run: ui.run, minutes: ui.minutes, pinned: ui.pinned };
    if (text) opts.text = text;
    return { type: draft.raw.type, raw: draft.raw, opts: opts };
  }

  Object.assign(U, { recordExercise: recordExercise, saveExercise: saveExercise, draftOf: draftOf, infoFromDraft: infoFromDraft });
})(globalThis.FT);
