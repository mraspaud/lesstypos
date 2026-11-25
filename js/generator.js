// Word generator.
// Each slot is one of:
//   random      ~20%: unbiased sample from the difficulty distribution, drawn
//                     from its own RNG stream so targeting never changes it;
//   target      ~30%: a carrier word (or word pair) for a context in training;
//   maintenance ~10%: a carrier for a due consolidation/retention review;
//   frontier    rest: difficulty distribution with recency avoidance.
// Difficulty distribution (design choice): 90% uniform over ranks [0, R),
// 10% look-ahead over [R, 1.5R), R = continuous frontier rank.
(function (FT) {
  'use strict';
  var DEFAULT_SHARES = { random: 0.2, target: 0.3, maintenance: 0.1 };

  function create(opts) {
    var corpus = opts.corpus;
    var seed = opts.seed || 1;
    var slotRng = FT.rng(seed), randRng = FT.rng(seed * 7919 + 1), pickRng = FT.rng(seed * 104729 + 3);
    var shares = Object.assign({}, DEFAULT_SHARES, opts.shares);
    var recent = [];
    var carriers = {};

    function rankSample(rng, R) {
      var max = corpus.size;
      var r = rng() < 0.9 ? rng() * R : R + rng() * 0.5 * R;
      return Math.min(Math.floor(r), max - 1);
    }
    function last() { return recent.length ? recent[recent.length - 1] : null; }
    function remember(w) { recent.push(w); if (recent.length > 30) recent.shift(); }

    function randomWord(R) {
      var a = corpus.words[rankSample(randRng, R)];
      var b = corpus.words[rankSample(randRng, R)];
      return a === last() ? b : a;
    }
    function frontierWord(R) {
      var w;
      for (var i = 0; i < 8; i++) {
        w = corpus.words[rankSample(pickRng, R)];
        if (recent.indexOf(w) < 0) break;
      }
      if (w === last()) w = corpus.words[rankSample(pickRng, R)];
      return w;
    }
    function pickCarrier(key, idxs, R) {
      var limit = Math.max(1.5 * R, 3000);
      var used = carriers[key] || (carriers[key] = []);
      var cands = idxs.filter(function (i) {
        var w = corpus.words[i];
        return i < limit && w !== last() && used.indexOf(w) < 0;
      });
      if (!cands.length) cands = idxs.filter(function (i) { return corpus.words[i] !== last(); });
      if (!cands.length) return null;
      var total = 0, ws = cands.map(function (i) { var x = 1 / Math.sqrt(i + 1); total += x; return x; });
      var r = pickRng() * total;
      for (var j = 0; j < cands.length; j++) { r -= ws[j]; if (r <= 0) break; }
      var w = corpus.words[cands[Math.min(j, cands.length - 1)]];
      used.push(w); if (used.length > 4) used.shift();
      return w;
    }
    function chooseTarget(list) {
      var total = 0;
      list.forEach(function (t) { total += t.priority; });
      var r = pickRng() * total;
      for (var i = 0; i < list.length; i++) { r -= list[i].priority; if (r <= 0) return list[i]; }
      return list[list.length - 1];
    }
    // Words for one target context (one word, or a pair across a word boundary).
    function carrierFor(t, R) {
      var sp = corpus.split(t.key);
      if (sp) {
        var a = pickCarrier(t.key + '|L', corpus.containing(sp[0]), R);
        if (!a) return null;
        recent.push(a);
        var b = pickCarrier(t.key + '|R', corpus.containing(sp[1]), R);
        recent.pop();
        return b ? [a, b] : null;
      }
      var w = pickCarrier(t.key, corpus.containing(t.key), R);
      return w ? [w] : null;
    }

    function next(n, ctx) {
      var R = Math.max(ctx.frontier || 200, 10);
      var targets = (ctx.targets || []).slice(0, 10);
      var training = targets.filter(function (t) { return !t.due; });
      var maint = targets.filter(function (t) { return t.due; });
      var out = [];
      while (out.length < n) {
        var r = slotRng();
        var source = 'frontier', words = null, tgt = null;
        if (r < shares.random) {
          source = 'random'; words = [randomWord(R)];
        } else if (r < shares.random + shares.target && training.length) {
          tgt = chooseTarget(training); words = carrierFor(tgt, R); source = 'target';
        } else if (r < shares.random + shares.target + shares.maintenance && maint.length) {
          tgt = chooseTarget(maint); words = carrierFor(tgt, R); source = 'maintenance';
        }
        if (!words) { source = 'frontier'; tgt = null; words = [frontierWord(R)]; }
        for (var i = 0; i < words.length; i++) {
          var item = { word: words[i], source: source };
          if (tgt) item.target = tgt.key;
          out.push(item);
          remember(words[i]);
        }
      }
      return out;
    }

    return { next: next };
  }

  FT.generator = { create: create };
})(globalThis.FT);
