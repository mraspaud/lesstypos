// Statistical primitives.
(function (FT) {
  'use strict';

  // Lanczos approximation of log-gamma.
  var LG = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    var a = 0.99999999999980993, t = x + 7.5;
    for (var i = 0; i < 8; i++) a += LG[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Continued fraction for the incomplete beta (Lentz; Numerical Recipes betacf).
  function betacf(x, a, b) {
    var MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b) = CDF of Beta(a, b) at x.
  // Design choice: when both parameters exceed NORMAL_BETA_ABOVE, the normal
  // approximation with the beta's mean and variance replaces the continued
  // fraction (its error there is far below the 0.95 decision threshold, and
  // the continued fraction converges slowly for large parameters).
  var NORMAL_BETA_ABOVE = 500;
  function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (a > NORMAL_BETA_ABOVE && b > NORMAL_BETA_ABOVE) {
      var mean = a / (a + b), v = a * b / ((a + b) * (a + b) * (a + b + 1));
      return normCdf((x - mean) / Math.sqrt(v));
    }
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }

  // erfc with fractional error < 1.2e-7 everywhere (Numerical Recipes erfcc,
  // Chebyshev fit).
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function erf(x) { return 1 - erfc(x); }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  // Van Selst & Jolicoeur (1994) non-recursive procedure with moving criterion.
  // Criterion values by sample size: anchor points as used in CrumpLab's
  // implementation (1.458 at n=4 rising to 2.5 at n>=100). Design choice:
  // linear interpolation between the anchors. NOTE (open caveat): the anchors
  // are not re-verified against the original 1994 table.
  var VJ = [[4, 1.458], [5, 1.68], [6, 1.841], [7, 1.961], [8, 2.05], [9, 2.12],
    [10, 2.173], [11, 2.22], [12, 2.246], [13, 2.274], [14, 2.31], [15, 2.326],
    [20, 2.391], [25, 2.41], [30, 2.4305], [35, 2.45], [50, 2.48], [100, 2.5]];
  function vjCriterion(n) {
    if (n >= 100) return 2.5;
    for (var i = 1; i < VJ.length; i++) {
      if (n <= VJ[i][0]) {
        var a = VJ[i - 1], b = VJ[i];
        return a[1] + (b[1] - a[1]) * (n - a[0]) / (b[0] - a[0]);
      }
    }
    return 2.5;
  }
  function meanSd(v) {
    var m = 0; for (var i = 0; i < v.length; i++) m += v[i]; m /= v.length;
    var s = 0; for (i = 0; i < v.length; i++) s += (v[i] - m) * (v[i] - m);
    return [m, Math.sqrt(s / Math.max(v.length - 1, 1))];
  }
  // Design choice: one pass; the bounds come from the sample without its
  // largest value and apply to every value (low and high outliers alike).
  function vjTrim(values) {
    var n = values.length;
    if (n < 4) return values.slice();
    var maxI = 0;
    for (var i = 1; i < n; i++) if (values[i] > values[maxI]) maxI = i;
    var rest = values.filter(function (_, j) { return j !== maxI; });
    var ms = meanSd(rest), c = vjCriterion(n);
    var lo = ms[0] - c * ms[1], hi = ms[0] + c * ms[1];
    return values.filter(function (x) { return x >= lo && x <= hi; });
  }

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // Log of a duration in ms, floored at 1 microsecond (two keystrokes can share a timestamp).
  function logOf(ms) { return Math.log(Math.max(ms, 1e-3)); }
  function mean(a) {
    if (!a.length) return null;
    return a.reduce(function (s, x) { return s + x; }, 0) / a.length;
  }
  function meanLog(a) {
    if (!a.length) return null;
    return a.reduce(function (s, x) { return s + logOf(x); }, 0) / a.length;
  }

  // Evidence weight by age in days: the FSRS forgetting-curve shape
  // R(t,S) = (1 + f t / S)^-d with f = 19/81, d = 0.5 (FSRS-4.5), so R(S) = 0.9.
  // Using it as an evidence weight is a design choice.
  // P(X - Y > d) for independent X ~ Beta(a1, b1) and Y ~ Beta(a2, b2): the
  // CDF of X integrated over Y's distribution, in equal steps of y across
  // Y's mean +- BETA_GRID_SDS standard deviations (the mass outside is
  // negligible; design choice of the grid).
  var BETA_GRID_SDS = 8, BETA_GRID_STEPS = 400;
  function betaDifferenceAbove(a1, b1, a2, b2, d) {
    var n = a2 + b2, mean = a2 / n, sd = Math.sqrt(a2 * b2 / (n * n * (n + 1)));
    var lo = Math.max(0, mean - BETA_GRID_SDS * sd), hi = Math.min(1, mean + BETA_GRID_SDS * sd);
    var step = (hi - lo) / BETA_GRID_STEPS, p = 0, below = betaCdf(lo, a2, b2);
    for (var i = 1; i <= BETA_GRID_STEPS; i++) {
      var y = lo + i * step, cdf = betaCdf(y, a2, b2);
      p += (cdf - below) * (1 - betaCdf(y - step / 2 + d, a1, b1));
      below = cdf;
    }
    return p;
  }

  // P(X > r Y) for independent X ~ Beta(a1, b1) and Y ~ Beta(a2, b2), on the
  // same grid over Y.
  function betaRatioAbove(a1, b1, a2, b2, r) {
    var n = a2 + b2, mean = a2 / n, sd = Math.sqrt(a2 * b2 / (n * n * (n + 1)));
    var lo = Math.max(0, mean - BETA_GRID_SDS * sd), hi = Math.min(1, mean + BETA_GRID_SDS * sd);
    var step = (hi - lo) / BETA_GRID_STEPS, p = 0, below = betaCdf(lo, a2, b2);
    for (var i = 1; i <= BETA_GRID_STEPS; i++) {
      var y = lo + i * step, cdf = betaCdf(y, a2, b2);
      p += (cdf - below) * (1 - betaCdf(r * (y - step / 2), a1, b1));
      below = cdf;
    }
    return p;
  }

  function recencyWeight(ageDays, S) {
    return Math.pow(1 + (19 / 81) * Math.max(ageDays, 0) / S, -0.5);
  }

  FT.stats = { lgamma: lgamma, betaCdf: betaCdf, betaDifferenceAbove: betaDifferenceAbove, betaRatioAbove: betaRatioAbove, normCdf: normCdf, vjTrim: vjTrim,
    vjCriterion: vjCriterion, recencyWeight: recencyWeight, meanSd: meanSd, median: median, mean: mean, meanLog: meanLog, logOf: logOf };
})(globalThis.FT);
