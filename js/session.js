// Typing session: target words, typed text and the full timestamped input
// stream per word (backspaces included). Space or Enter commits the current
// word; a word's separator is a space, or Enter at the end of a paragraph.
(function (FT) {
  'use strict';

  var REACH = 5, PARAGRAPH = '\n';
  function isSeparator(ch) { return ch === ' ' || ch === PARAGRAPH; }
  function separatorOf(w) { return (w.meta && w.meta.sep) || ' '; }
  function targetOf(w) { return w.target + separatorOf(w); }
  // How a committed word was ended: 'ok' by its own separator (or one the
  // app added at the end of a text), 'bad' by the other one; null while open.
  function separatorStatus(w) {
    if (!w.committed) return null;
    var last = w.stream[w.stream.length - 1];
    return last.auto || last.ch === separatorOf(w) ? 'ok' : 'bad';
  }
  function isOtherSeparator(w, ch) { return isSeparator(ch) && ch !== separatorOf(w); }
  // Whether the separator just typed ends the word (user decisions): it does
  // once the word has all its letters, or all its key presses (a multi-letter
  // key is one, also when its letters are typed one by one), right or wrong;
  // and it does after a start that is already wrong, since the typist has
  // moved on. After a correct start it is a typo in place.
  function endsAtSeparator(w, macros, equivalence) {
    var before = Array.from(w.typed).slice(0, -1).join('');
    if (!equivalence.isPrefix(before, w.target)) return true;
    return hasAllLetters(w) || hasAllPresses(w, macros);
  }
  function hasAllLetters(w) { return Array.from(w.typed).length - 1 >= Array.from(w.target).length; }
  function hasAllPresses(w, macros) {
    if (!macros || !macros.length) return false;
    var flags = FT.align.flagStream(w.stream), ids = FT.presses.ids(w.stream, macros, Infinity), typed = {};
    for (var i = 0; i < w.stream.length - 1; i++) if (flags[i] && ids[i] != null) typed[ids[i]] = true;
    var target = FT.presses.ofTarget(w.target, macros);
    return Object.keys(typed).length >= (target.length ? target[target.length - 1] + 1 : 0);
  }

  // opts: { reach, equivalence (FT.text.equivalence), macros, stopOnError
  // (after a wrong key, nothing more is taken until it is corrected, and a
  // word never ends with the other separator) }.
  function create(targets, opts) {
    var reach = (opts && opts.reach) || REACH;
    var equivalence = (opts && opts.equivalence) || FT.text.equivalence();
    var macros = (opts && opts.macros) || [];
    var stopOnError = !!(opts && opts.stopOnError);
    var words = [];
    function errorWithin(from) {
      for (var i = from; i >= 0 && i > from - reach; i--) {
        if (!equivalence.sameStr(words[i].typed, targetOf(words[i]))) return true;
      }
      return false;
    }
    var wordIndex = 0;
    var group = 0;
    var listeners = [];

    function add(list) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var obj = typeof it === 'object' && it !== null;
        var meta = obj ? { source: it.source || null } : null;
        if (obj && it.target) meta.target = it.target;
        if (obj && it.sep === PARAGRAPH) meta.sep = PARAGRAPH;
        words.push({ target: obj ? it.word : it, typed: '', stream: [], committed: false, meta: meta });
      }
    }
    add(targets || []);

    function current() { return words[wordIndex]; }

    function commit() {
      var w = current();
      w.committed = true;
      w.tEnd = w.stream[w.stream.length - 1].t;
      var i = wordIndex;
      wordIndex++;
      for (var k = 0; k < listeners.length; k++) listeners[k](w, i);
    }

    function input(ev) {
      var w = current();
      if (!w) return;
      if (ev.kind === 'back') {
        if (w.typed.length === 0) {
          // Return into the previous word only if it, or one of the few words
          // before it, still contains an error (so an error can be reached and
          // fixed, but correct text is not reopened for nothing).
          var prev = words[wordIndex - 1];
          if (!prev || !errorWithin(wordIndex - 1)) return false;
          wordIndex--;
          prev.committed = false;
          w = prev;
        }
        w.typed = Array.from(w.typed).slice(0, -1).join('');
        w.stream.push({ k: 'b', t: ev.t });
        return true;
      }
      if (ev.kind !== 'text') return;
      if (stopOnError && w && !equivalence.isPrefix(w.typed, targetOf(w))) return;
      var chars = Array.from(ev.data);
      var g = ++group;
      for (var j = 0; j < chars.length; j++) {
        var ch = chars[j];
        w = current();
        if (!w) return;
        if (isSeparator(ch) && w.typed.length === 0) continue;
        if (stopOnError && isOtherSeparator(w, ch)) return;
        if (w.stream.length === 0) w.tStart = ev.t;
        w.typed += ch;
        var entry = { k: 'c', ch: ch, t: ev.t, g: g };
        if (ev.auto) entry.auto = true; // inserted by the app (end of a text), not typed
        w.stream.push(entry);
        if (isSeparator(ch) && endsAtSeparator(w, macros, equivalence)) commit();
      }
    }

    return {
      input: input,
      append: add,
      onCommit: function (fn) { listeners.push(fn); },
      state: function () { return { wordIndex: wordIndex, words: words }; },
      current: current,
    };
  }

  FT.session = { create: create, targetOf: targetOf, separatorOf: separatorOf, separatorStatus: separatorStatus, PARAGRAPH: PARAGRAPH };
})(globalThis.FT);
