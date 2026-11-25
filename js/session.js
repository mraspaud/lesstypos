// Typing session: target words, typed text and the full timestamped input
// stream per word (backspaces included). Space commits the current word.
(function (FT) {
  'use strict';

  function create(targets) {
    var words = [];
    var wordIndex = 0;
    var group = 0;
    var listeners = [];

    function add(list) {
      for (var i = 0; i < list.length; i++) {
        words.push({ target: list[i], typed: '', stream: [], committed: false, meta: null });
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
        if (w.typed.length === 0) return;
        w.typed = w.typed.slice(0, -1);
        w.stream.push({ k: 'b', t: ev.t });
        return;
      }
      if (ev.kind !== 'text') return;
      var chars = Array.from(ev.data);
      var g = ++group;
      for (var j = 0; j < chars.length; j++) {
        var ch = chars[j];
        w = current();
        if (!w) return;
        if (ch === ' ' && w.typed.length === 0) continue;
        if (w.stream.length === 0) w.tStart = ev.t;
        w.typed += ch;
        w.stream.push({ k: 'c', ch: ch, t: ev.t, g: g });
        if (ch === ' ') commit();
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

  FT.session = { create: create };
})(globalThis.FT);
