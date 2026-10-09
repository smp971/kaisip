/* Small pure helpers. ES5. */
var Util = (function () {
  'use strict';
  return {
    /* Keep only characters a dialled number may contain. */
    filterNumber: function (s) {
      return String(s === undefined || s === null ? '' : s).replace(/[^0-9*#+]/g, '');
    },
    /* seconds -> "mm:ss" */
    fmtDuration: function (sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    /* in-call volume steps (1 = 100%); above 1 needs the Web Audio bridge */
    VOLUME_STEPS: [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 3],
    /* move one step up (+1) or down (-1) from the nearest step to v */
    stepVolume: function (v, dir) {
      var steps = this.VOLUME_STEPS, best = 0, i;
      for (i = 1; i < steps.length; i++) {
        if (Math.abs(steps[i] - v) < Math.abs(steps[best] - v)) { best = i; }
      }
      var next = Math.max(0, Math.min(steps.length - 1, best + (dir > 0 ? 1 : -1)));
      return steps[next];
    },
    mask: function (s) {
      s = String(s || '');
      return new Array(s.length + 1).join('*');
    }
  };
}());
