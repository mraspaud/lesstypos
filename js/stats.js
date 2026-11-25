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
  function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }

  // erf: Maclaurin series for |x| < 3, erfc continued fraction beyond.
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    if (x < 3) {
      var sum = x, term = x, x2 = x * x;
      for (var n = 1; n < 200; n++) {
        term *= -x2 / n;
        var add = term / (2 * n + 1);
        sum += add;
        if (Math.abs(add) < 1e-16 * Math.abs(sum)) break;
      }
      return s * (2 / Math.sqrt(Math.PI)) * sum;
    }
    // erfc continued fraction for large x
    var f = 0;
    for (var k = 60; k >= 1; k--) f = k / 2 / (x + f);
    var erfc = Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
    return s * (1 - erfc);
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  // Van Selst & Jolicoeur (1994) non-recursive procedure with moving criterion.
  // Criterion values by sample size: anchor points as used in CrumpLab's
  // implementation (1.458 at n=4 rising to 2.5 at n>=100), linearly
  // interpolated. NOTE: not re-verified against the original 1994 table.
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

  // Evidence weight by age in days: the FSRS forgetting-curve shape
  // R(t,S) = (1 + f t / S)^-d with f = 19/81, d = 0.5 (FSRS-4.5), so R(S) = 0.9.
  // Using it as an evidence weight is a design choice.
  function recencyWeight(ageDays, S) {
    return Math.pow(1 + (19 / 81) * Math.max(ageDays, 0) / S, -0.5);
  }

  FT.stats = { lgamma: lgamma, betaCdf: betaCdf, normCdf: normCdf, vjTrim: vjTrim,
    vjCriterion: vjCriterion, recencyWeight: recencyWeight, meanSd: meanSd };
})(globalThis.FT);
