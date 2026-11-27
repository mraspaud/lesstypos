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

  var counter = 0;
  function newId() { return 'run-' + Date.now().toString(36) + '-' + (++counter).toString(36); }

  function runner(def, opts, state) {
    var st = state || { id: newId(), def: JSON.parse(JSON.stringify(def)), day: opts.day, index: -1, results: [], finished: false };
    function nextEnabled(from) {
      for (var i = from; i < st.def.steps.length; i++) if (st.def.steps[i].enabled) return i;
      return -1;
    }
    if (st.index === -1) st.index = nextEnabled(0);
    var api = {
      id: function () { return st.id; },
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

  var STEP_TYPES = DEFAULT.steps.map(function (st) { return st.type; });
  var MIN_MINUTES = 0.5, MAX_MINUTES = 30;
  function cleanMinutes(m, fallback) {
    var n = Number(m);
    return isFinite(n) && n > 0 ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n)) : fallback;
  }
  // A definition from storage or a backup, reduced to known step types.
  function clean(def) {
    if (!def || typeof def !== 'object' || !Array.isArray(def.steps)) return null;
    return { name: typeof def.name === 'string' ? def.name : DEFAULT.name, steps: def.steps.filter(function (st) {
      return st && STEP_TYPES.indexOf(st.type) >= 0;
    }).map(function (st) {
      var fallback = DEFAULT.steps[STEP_TYPES.indexOf(st.type)].minutes;
      return { type: st.type, minutes: cleanMinutes(st.minutes, fallback), enabled: st.enabled !== false };
    }) };
  }
  // A saved run is kept only when it is whole and made of known steps; it is
  // returned cleaned like a definition.
  function cleanRun(run) {
    if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !Number.isInteger(run.day) || !Array.isArray(run.results)) return null;
    var def = clean(run.def);
    if (!def || def.steps.length !== run.def.steps.length) return null;
    if (!Number.isInteger(run.index) || run.index < -1 || run.index >= def.steps.length) return null;
    if (!run.results.every(function (r) { return r && STEP_TYPES.indexOf(r.type) >= 0; })) return null;
    return Object.assign({}, run, { def: def });
  }

  // What home offers first. Practice spread over days is learnt better per
  // hour than extra practice the same day (Baddeley & Longman 1978, typing;
  // consolidation over hours and sleep: Brashers-Krug et al. 1996, Walker et
  // al. 2002, smaller in Pan & Rickard 2015), so after the day's training it
  // offers relaxed reading. Design choice: the day is the calendar day.
  function homeDefault(o) {
    if (o.resumable) return 'resume';
    return o.trainedToday ? 'read' : 'train';
  }
  // Where each way to train sits on home (user decision): the one Enter
  // starts (homeDefault's, or choosing exercises when none is switched on),
  // a benchmark that is due beside it, and every other way under More, the
  // one swapped out of Enter first. o: whether there are steps, reading, a
  // chapter to go back to and a focus sequence; trainedToday, resumable,
  // benchmarkDue. Returns the ids home draws.
  function homeLayout(o) {
    var choice = homeDefault(o);
    var primary = !o.steps ? 'choose' : choice === 'read' && !o.reading ? 'train' : choice;
    var swappedOut = primary === 'read' ? 'again' : o.reading ? 'read' : null;
    var more = [swappedOut, o.chapterStart && 'chapterstart', 'start', !o.benchmarkDue && 'bench', o.target && 'one', o.resumable && 'restart'];
    return { primary: primary, shown: o.benchmarkDue ? ['bench'] : [], more: more.filter(Boolean) };
  }

  FT.programme = { MIN_MINUTES: MIN_MINUTES, MAX_MINUTES: MAX_MINUTES, homeDefault: homeDefault, homeLayout: homeLayout, DEFAULT: DEFAULT, STEP_TYPES: STEP_TYPES, runner: runner, resume: resume, totalMinutes: totalMinutes, clean: clean, cleanRun: cleanRun };
})(globalThis.FT);
