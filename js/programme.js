// Training programmes: an ordered list of exercises with durations. The runner
// walks the enabled steps, supports skip / repeat / finish early, and can be
// saved and resumed on the same day.
(function (FT) {
  'use strict';
  var DEFAULT = { name: 'Daily training', steps: [
    { type: 'warmup', minutes: 2, enabled: true },
    { type: 'relaxed', minutes: 5, enabled: true },
    { type: 'bursts', minutes: 3, enabled: true },
    { type: 'prose', minutes: 7, enabled: true },
    { type: 'targeted', minutes: 3, enabled: true },
  ] };

  function totalMinutes(def) {
    return def.steps.reduce(function (a, s) { return a + (s.enabled ? s.minutes : 0); }, 0);
  }

  function runner(def, opts, state) {
    var st = state || { def: JSON.parse(JSON.stringify(def)), day: opts.day, index: -1, results: [], finished: false };
    function nextEnabled(from) {
      for (var i = from; i < st.def.steps.length; i++) if (st.def.steps[i].enabled) return i;
      return -1;
    }
    if (st.index === -1) st.index = nextEnabled(0);
    var api = {
      current: function () { return st.finished || st.index < 0 ? null : Object.assign({ index: st.index }, st.def.steps[st.index]); },
      complete: function (result) {
        var c = api.current();
        if (!c) return;
        st.results.push(Object.assign({ type: c.type, index: c.index }, result));
        st.lastIndex = c.index;
        st.index = nextEnabled(c.index + 1);
        if (st.index < 0) st.finished = true;
      },
      skip: function () {
        var c = api.current();
        if (!c) return;
        st.results.push({ type: c.type, index: c.index, skipped: true });
        st.index = nextEnabled(c.index + 1);
        if (st.index < 0) st.finished = true;
      },
      repeat: function () {
        if (st.lastIndex == null) return;
        st.index = st.lastIndex; st.finished = false;
      },
      finishEarly: function () { st.finished = true; },
      done: function () { return st.finished; },
      results: function () { return st.results; },
      definition: function () { return st.def; },
      upcoming: function () {
        var out = [];
        for (var i = st.index; i >= 0 && i < st.def.steps.length; i++) if (st.def.steps[i].enabled) out.push(st.def.steps[i]);
        return st.finished ? [] : out;
      },
      toJSON: function () { return st; },
    };
    return api;
  }

  function resume(state, day) {
    if (!state || state.finished || state.day !== day) return null;
    return runner(state.def, { day: day }, state);
  }

  FT.programme = { DEFAULT: DEFAULT, runner: runner, resume: resume, totalMinutes: totalMinutes };
})(globalThis.FT);
