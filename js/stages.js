// Consolidation stages of trained contexts (design choice, in the spirit of
// spaced repetition): weak -> improving -> consolidating (intervals growing
// in sessions) -> mastered, with retention checks; failures send a context
// back. The stage sets how much practice a context gets.
(function (FT) {
  'use strict';

  // obs: { flagged, suspect, localN, localWords, session }
  var STAGE_CFG = { reviewN: 10, reviewWords: 3, masteredInterval: 8 };
  function next(stage, obs, cfg) {
    var c = Object.assign({}, STAGE_CFG, cfg && cfg.stages);
    var name = stage ? stage.name : null;
    if (obs.flagged) {
      if (name === 'weak') return stage;
      var out = { name: 'weak' };
      if (name === 'consolidating' || name === 'mastered' || (stage && stage.regressed)) out.regressed = true;
      return out;
    }
    if (!stage) return null;
    var reviewed = obs.localN >= c.reviewN && obs.localWords >= c.reviewWords;
    if (name === 'weak') {
      if (obs.suspect) return stage;
      var imp = { name: 'improving' };
      if (stage.regressed) imp.regressed = true;
      return imp;
    }
    if (name === 'improving') {
      if (!reviewed || obs.suspect) return stage;
      return { name: 'consolidating', interval: 1, due: obs.session + 1 };
    }
    // consolidating / mastered
    if (obs.session < stage.due || !reviewed) return stage;
    if (obs.suspect) return { name: 'improving', regressed: true };
    var interval = stage.interval * 2;
    return { name: interval >= c.masteredInterval ? 'mastered' : 'consolidating', interval: interval, due: obs.session + interval };
  }

  var DEMAND = { weak: 1, improving: 0.6, consolidating: 0.3, mastered: 0.15 };
  function demand(stage, session) {
    if (!stage) return 0;
    if ((stage.name === 'consolidating' || stage.name === 'mastered') && session < stage.due) return 0;
    return DEMAND[stage.name] || 0;
  }

  // What a session showed of a context: its keystrokes and distinct words.
  function observedIn(c, session) {
    var seen = { count: 0, distinctWords: 0 };
    for (var i = 0; i < c.buckets.length; i++) {
      if (c.buckets[i].session === session) { seen.count += c.buckets[i].count; seen.distinctWords += c.buckets[i].distinctWords; }
    }
    return seen;
  }

  // Updates the stages after a training session, using the overall
  // judgement (evaluation, FT.judgement) plus this session's own
  // observations of each context. Returns the changes.
  function endSession(state, evaluation, meta, cfg) {
    var changes = [];
    Object.keys(state.contexts).forEach(function (k) {
      var c = state.contexts[k], j = evaluation.get(k);
      if (!j) return;
      var seen = observedIn(c, meta.session);
      if (!c.stage && !(j.weak || j.hesitant)) return;
      var usable = !j.insufficient && !j.redundant;
      var suspect = usable && (
        (j.pWorse > 0.8 && j.errorRate - j.parentErrorRate >= cfg.minErrAbs / 2) ||
        (j.pSlower > 0.8 && j.latRel >= 1 + (cfg.minLatRel - 1) / 2));
      var nx = next(c.stage, { flagged: j.weak || j.hesitant, suspect: suspect,
        localN: seen.count, localWords: seen.distinctWords, session: meta.session }, cfg);
      var from = c.stage ? c.stage.name : null, to = nx ? nx.name : null;
      if (from !== to) changes.push({ key: k, from: from, to: to, reason: j.state });
      c.stage = nx;
    });
    return changes;
  }

  // Contexts to practise now, by priority = demand(stage) x (1 + excess cost)
  // x frequency weight. when: { session, freq }.
  function trainingTargets(state, evaluation, when) {
    var freq = when.freq || function () { return 1; };
    var out = [];
    Object.keys(state.contexts).forEach(function (k) {
      var c = state.contexts[k];
      var d = demand(c.stage, when.session);
      if (!d) return;
      var j = evaluation.get(k);
      var excess = Math.max(0, j.errorRate / j.parentErrorRate - 1, j.latRel - 1);
      out.push({ key: k, stage: c.stage.name, due: c.stage.name === 'consolidating' || c.stage.name === 'mastered',
        state: j.state, priority: d * (1 + excess) * freq(k), excess: excess });
    });
    out.sort(function (a, b) { return b.priority - a.priority; });
    return out;
  }

  FT.stages = { next: next, demand: demand, endSession: endSession, trainingTargets: trainingTargets };
})(globalThis.FT);
