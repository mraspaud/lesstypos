// Local calendar days: the day of an exercise, the per-day grouping of
// progress and the chart's day ticks all follow the typist's own calendar.
(function (FT) {
  'use strict';
  var DAY_MS = 864e5;

  // Days since 1 January 1970 in local time.
  function number(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / DAY_MS); }
  // The local date as YYYY-MM-DD, which sorts by date.
  function key(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Calendar days from t0 to t1: the next local day is 1, even under 24 hours later.
  function between(t0, t1) {
    var a = new Date(t0), b = new Date(t1);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
  }
  // The first local midnight at or after t.
  function midnightFrom(t) {
    var d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (d.getHours() || d.getMinutes() || d.getSeconds() ? 1 : 0)).getTime();
  }
  // The same local time n calendar days later.
  function add(t, n) {
    var d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
  }

  FT.days = { MS: DAY_MS, number: number, key: key, between: between, midnightFrom: midnightFrom, add: add };
})(globalThis.FT);
