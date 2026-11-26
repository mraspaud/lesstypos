// The key log: keydowns and keyups (FT.input), apart from the characters
// typed. Rollover, how long keys are held, and keys the keyboard sends late.
(function (FT) {
  'use strict';

  // Key events in time order; equal times keep the logged order (a synthetic
  // tap logs its keydown and keyup at the same instant).
  function byTime(ev) { return ev.sort(function (a, b) { return a.t - b.t; }); }

  // Rollover ratio (Dhakal et al. 2018): share of keydowns made while another
  // (non-modifier) key is still held. keys: [{k:'d'|'u', c: code, t}].
  var MODIFIERS = /^(Shift|Control|Alt|Meta|CapsLock|OS)/;
  // opts.exclude: key codes left out (keys sent late as synthetic taps, whose
  // key-up times are the keyboard's, not the finger's; design choice).
  function rollover(keys, opts) {
    var held = {}, nHeld = 0, total = 0, rolled = 0, skip = {};
    ((opts && opts.exclude) || []).forEach(function (c) { skip[c] = true; });
    var ev = byTime((keys || []).slice());
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (MODIFIERS.test(e.c) || skip[e.c]) continue;
      if (e.k === 'd') {
        total++;
        if (nHeld > 0) rolled++;
        if (!held[e.c]) { held[e.c] = true; nHeld++; }
      } else if (held[e.c]) { delete held[e.c]; nHeld--; }
    }
    return total ? rolled / total : null;
  }

  // Keys the keyboard sends late (see the header of test/keyevents.test.js):
  // a tap-hold key not settled on press arrives as a synthetic tap at the
  // firmware's decision time, its keyup within a millisecond of its keydown.
  // Design choice: >= LATE_MIN_N single-key presses, >= LATE_SHARE of them held
  // < INSTANT_MS, and at least one key with >= LATE_MIN_N presses whose median
  // hold is >= HOLD_INFO_MS (otherwise the input carries no hold information).
  // keys: [{k, c, t}]; words carry streams; opts: { macros, equivalence }, as
  // for FT.align.analyzeWord.
  var MATCH_MS = 5, INSTANT_MS = 3, LATE_MIN_N = 10, LATE_SHARE = 0.8, HOLD_INFO_MS = 20;
  // Each press that typed characters, in time order: its (canonical, as the
  // model sees it) first character and whether it typed only that character.
  function typedChars(words, opts) {
    var macros = opts && opts.macros, canon = (opts && opts.equivalence || FT.text.equivalence()).canon, chars = [];
    (words || []).forEach(function (w) {
      var ids = FT.presses.ids(w.stream, macros), size = {};
      ids.forEach(function (p) { if (p != null) size[p] = (size[p] || 0) + 1; });
      w.stream.forEach(function (e, i) {
        if (e.k !== 'c' || e.auto || (i > 0 && ids[i] === ids[i - 1])) return; // one entry per press
        chars.push({ ch: canon(e.ch), t: e.t, single: size[ids[i]] === 1 });
      });
    });
    return chars.sort(function (a, b) { return a.t - b.t; });
  }

  // Every completed key press (keydown to keyup, modifiers left out), with the
  // character it produced: the earliest unclaimed one within MATCH_MS.
  function keyHolds(keys, chars) {
    var ev = byTime((keys || []).filter(function (e) { return !MODIFIERS.test(e.c); }));
    var j = 0, down = {}, out = [];
    ev.forEach(function (e) {
      if (e.k === 'd') {
        while (j < chars.length && chars[j].t < e.t - MATCH_MS) j++;
        down[e.c] = { t: e.t, m: j < chars.length && chars[j].t <= e.t + MATCH_MS ? chars[j++] : null };
      } else if (down[e.c]) {
        out.push({ code: e.c, hold: e.t - down[e.c].t, ch: down[e.c].m });
        delete down[e.c];
      }
    });
    return out;
  }

  function lateKeys(keys, words, opts) {
    var presses = keyHolds(keys, typedChars(words, opts)), holds = {}, codeOf = {}, times = {};
    presses.forEach(function (p) {
      if (!p.ch || !p.ch.single) return;
      var h = holds[p.ch.ch] || (holds[p.ch.ch] = { n: 0, instant: 0 });
      h.n++; if (p.hold < INSTANT_MS) h.instant++;
      (times[p.ch.ch] = times[p.ch.ch] || []).push(p.hold);
      codeOf[p.ch.ch] = p.code;
    });
    // Hold information: at least one well-observed key is held like a finger holds it.
    var info = Object.keys(holds).some(function (ch) { return holds[ch].n >= LATE_MIN_N && FT.stats.median(times[ch]) >= HOLD_INFO_MS; });
    // judged: keys with enough presses (and hold information) for a verdict
    var judged = !info ? [] : Object.keys(holds).filter(function (ch) { return holds[ch].n >= LATE_MIN_N; });
    var late = judged.filter(function (ch) { return holds[ch].instant / holds[ch].n >= LATE_SHARE; });
    return { chars: late, judged: judged, codes: late.map(function (ch) { return codeOf[ch]; }), holds: holds };
  }

  FT.keyevents = { rollover: rollover, lateKeys: lateKeys };
})(globalThis.FT);
