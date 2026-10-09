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
    mask: function (s) {
      s = String(s || '');
      return new Array(s.length + 1).join('*');
    }
  };
}());
