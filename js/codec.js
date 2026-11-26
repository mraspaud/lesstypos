// Compact storage of raw sessions.
// Timestamps are kept at 0.01 ms (design choice: browsers already coarsen
// performance.now() to 0.1 ms or 1 ms), which makes the encoding exact.
// An encoded session (enc: 1) stores, instead of per-event objects:
//   keys:  { codes: [...], ev: [code * 2 + (keyup ? 1 : 0), Δsteps, ...] }
//   words: { target, meta, c: typed characters ('\b' = backspace),
//            t: [Δsteps...], g: [Δgroup or null...], a: [auto entry indices] }
// Δsteps run across the whole session in 0.01 ms steps (a session saved
// before timestamps were rounded is rounded on encoding). Anything with an
// unexpected shape is stored as it is.
(function (FT) {
  'use strict';
  var STEP = 100; // steps per millisecond

  function roundTime(t) { return t == null ? t : Math.round(t * STEP) / STEP; }
  function withRoundedTime(e) { return Object.assign({}, e, { t: roundTime(e.t) }); }

  var BACK = '\b';
  // Difference from the previous value of `field` on a running clock.
  function delta(clock, field, value) { var d = value - clock[field]; clock[field] = value; return d; }
  function steps(t) { return Math.round(t * STEP); }
  function onlyKeys(o, allowed) { return Object.keys(o).every(function (k) { return allowed.indexOf(k) >= 0; }); }
  function plainEntry(e) {
    if (!Number.isFinite(e.t)) return false;
    if (e.k === 'b') return onlyKeys(e, ['k', 't']);
    return e.k === 'c' && onlyKeys(e, ['k', 'ch', 't', 'g', 'auto']) && typeof e.ch === 'string' &&
      Array.from(e.ch).length === 1 && e.ch !== BACK && (e.auto === undefined || e.auto === true) &&
      (e.g === undefined || Number.isFinite(e.g));
  }

  function encodeKeys(keys) {
    var ok = Array.isArray(keys) && keys.every(function (e) { return keyEvent(e) && onlyKeys(e, ['k', 'c', 't']); });
    if (!ok) return keys;
    var codes = [], index = Object.create(null), ev = [], clock = { t: 0 };
    keys.forEach(function (e) {
      if (index[e.c] === undefined) { index[e.c] = codes.length; codes.push(e.c); }
      ev.push(index[e.c] * 2 + (e.k === 'u' ? 1 : 0), delta(clock, 't', steps(e.t)));
    });
    return { codes: codes, ev: ev };
  }
  function decodeKeys(enc) {
    if (Array.isArray(enc)) return enc;
    var out = [], t = 0;
    for (var i = 0; i < enc.ev.length; i += 2) {
      t += enc.ev[i + 1];
      out.push({ k: enc.ev[i] % 2 ? 'u' : 'd', c: enc.codes[enc.ev[i] >> 1], t: t / STEP });
    }
    return out;
  }

  // clock: { t, g } carried across the words of a session.
  function encodeWord(w, clock) {
    if (!onlyKeys(w, ['target', 'stream', 'meta']) || !Array.isArray(w.stream) || !w.stream.every(plainEntry)) return w;
    var saved = { t: clock.t, g: clock.g };
    var c = '', ts = [], gs = [], auto = [];
    w.stream.forEach(function (e, i) {
      ts.push(delta(clock, 't', steps(e.t)));
      if (e.k === 'b') { c += BACK; return; }
      c += e.ch;
      gs.push(e.g === undefined ? null : delta(clock, 'g', e.g));
      if (e.auto) auto.push(i);
    });
    if (Array.from(c).length !== w.stream.length) { clock.t = saved.t; clock.g = saved.g; return w; } // e.g. lone surrogate halves
    var out = { target: w.target, meta: w.meta, c: c, t: ts, g: gs };
    if (auto.length) out.a = auto;
    return out;
  }
  function decodeWord(w, clock) {
    if (w.c === undefined) return w;
    var chars = Array.from(w.c), stream = [], gi = 0, auto = {};
    (w.a || []).forEach(function (i) { auto[i] = true; });
    chars.forEach(function (ch, i) {
      clock.t += w.t[i];
      var t = clock.t / STEP;
      if (ch === BACK) { stream.push({ k: 'b', t: t }); return; }
      var e = { k: 'c', ch: ch, t: t }, dg = w.g[gi++];
      if (dg !== null) { clock.g += dg; e.g = clock.g; }
      if (auto[i]) e.auto = true;
      stream.push(e);
    });
    return { target: w.target, stream: stream, meta: w.meta };
  }

  function encodeSession(s) {
    if (s.enc) return s;
    var clock = { t: 0, g: 0 }, out = Object.assign({}, s, { enc: 1 });
    if (s.words) out.words = s.words.map(function (w) { return encodeWord(w, clock); });
    if (s.keys) out.keys = encodeKeys(s.keys);
    return out;
  }
  function decodeSession(s) {
    if (!s || !s.enc) return s;
    var clock = { t: 0, g: 0 }, out = Object.assign({}, s);
    delete out.enc;
    if (s.words) out.words = s.words.map(function (w) { return decodeWord(w, clock); });
    if (s.keys) out.keys = decodeKeys(s.keys);
    return out;
  }

  // Whether an encoded session is whole (array lengths and indices agree).
  function isInt(x) { return Number.isInteger(x); }
  function validWord(w) {
    if (!w || typeof w.target !== 'string') return false;
    if (w.c === undefined) return Array.isArray(w.stream) && w.stream.every(streamEntry);
    if (typeof w.c !== 'string' || !Array.isArray(w.t) || !Array.isArray(w.g)) return false;
    var chars = Array.from(w.c), letters = chars.filter(function (ch) { return ch !== BACK; }).length;
    return w.t.length === chars.length && w.t.every(isInt) && w.g.length === letters &&
      w.g.every(function (x) { return x === null || isInt(x); }) &&
      (w.a === undefined || (Array.isArray(w.a) && w.a.every(function (i) { return isInt(i) && i >= 0 && i < chars.length; })));
  }
  function keyEvent(e) { return e && (e.k === 'd' || e.k === 'u') && typeof e.c === 'string' && Number.isFinite(e.t); }
  function streamEntry(e) {
    return e && Number.isFinite(e.t) && (e.k === 'b' || (e.k === 'c' && typeof e.ch === 'string'));
  }
  function validKeys(k) {
    if (k === undefined) return true;
    if (Array.isArray(k)) return k.every(keyEvent);
    if (!k || !Array.isArray(k.codes) || !Array.isArray(k.ev) || k.ev.length % 2) return false;
    return k.ev.every(function (x, i) { return isInt(x) && (i % 2 || (x >= 0 && x >> 1 < k.codes.length)); });
  }
  function validTags(tags) { return tags == null || (Array.isArray(tags) && tags.every(FT.conditions.isTag)); }
  var EXERCISE_TYPES = ['warmup', 'relaxed', 'bursts', 'prose', 'targeted', 'benchmark'];
  // Whether a session, encoded or plain, is whole enough to store and replay.
  function validSession(s) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !Number.isFinite(s.startedAt) || EXERCISE_TYPES.indexOf(s.type) < 0) return false;
    return Array.isArray(s.words) && s.words.every(validWord) && validKeys(s.keys) && validTags(s.tags);
  }

  FT.codec = { validSession: validSession, roundTime: roundTime, withRoundedTime: withRoundedTime, encodeSession: encodeSession, decodeSession: decodeSession };
})(globalThis.FT);
