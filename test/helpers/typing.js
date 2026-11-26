'use strict';
// One notation for what a typist does, shared by the tests.
// Each character is one key press; '<' is a backspace; '[th]' is one input
// event that produces several characters (a multi-letter key).
//   presses('t[he]<n') → ['t', '[he]', '<', 'n']

function presses(notation) {
  return notation.match(/\[[^\]]+\]|./gsu) || [];
}
const isBackspace = (press) => press === '<';
const textOf = (press) => (press.length > 1 && press[0] === '[' ? press.slice(1, -1) : press);

// A raw input stream, as the session records it: the i-th press at t0 + i·dt,
// each press its own input group.
function stream(notation, { t0 = 0, dt = 100 } = {}) {
  const out = [];
  presses(notation).forEach((press, i) => {
    const t = t0 + i * dt;
    if (isBackspace(press)) out.push({ k: 'b', t });
    else for (const ch of textOf(press)) out.push({ k: 'c', ch, t, g: i });
  });
  return out;
}

// A word as stored: its target and the stream typed for it.
const word = (target, notation, timing) => ({ target, stream: stream(notation, timing) });

// Types into a session (FT.session): the first press at `at`, each later one
// dt ms after the one before (dt may also be a list, one gap per press).
function typist(session, { at = 0, dt = 100 } = {}) {
  let last = null;
  const api = {
    type(notation, gaps = dt) {
      presses(notation).forEach((press, i) => {
        const t = last == null ? at : last + (Array.isArray(gaps) ? gaps[i] : gaps);
        session.input(isBackspace(press) ? { kind: 'back', t } : { kind: 'text', data: textOf(press), t });
        last = t;
      });
      return api;
    },
    // When the last press came.
    get t() { return last; },
  };
  return api;
}

// The committed words of a new session over targets, typed by script: one
// string, or [[typed, dt], ...] in order. opts: { at, session (its options) }.
function typedWords(FT, targets, script, { at = 0, session: sessionOpts } = {}) {
  const session = FT.session.create(targets, sessionOpts);
  const hands = typist(session, { at });
  for (const [typed, dt] of typeof script === 'string' ? [[script]] : script) hands.type(typed, dt);
  return session.state().words.filter((w) => w.committed);
}

// What a typist types for words typed correctly: each target and a space.
const correctly = (words) => words.map((w) => (typeof w === 'string' ? w : w.target) + ' ').join('');

// Types every target of a new session correctly: the first press at `at`
// (by default dt), then one every dt ms. Returns the committed words and
// when the last press came.
function typeCorrectly(FT, targets, { dt = 100, at = dt, session: sessionOpts } = {}) {
  const session = FT.session.create(targets, sessionOpts);
  const hands = typist(session, { at, dt }).type(correctly(session.state().words));
  return { words: session.state().words.filter((w) => w.committed), t: hands.t };
}

// The same text with a slip on every h after t: n typed, then corrected.
const slipOnTh = (text) => text.replace(/th/g, 'tn<h');

module.exports = { slipOnTh, presses, stream, word, typist, typedWords, correctly, typeCorrectly };
