/* Last 20 calls, kept in localStorage. ES5.
   entry: { ts, dir: 'in'|'out', number, name, result: 'answered'|'missed'|'rejected'|'failed', duration } */
var CallLog = (function () {
  'use strict';
  var KEY = 'kaisip.calllog';
  var MAX = 20;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  return {
    max: MAX,
    list: function () { return load(); },
    add: function (entry) {
      var list = load();
      list.unshift({
        ts: entry.ts || Date.now(),
        dir: entry.dir === 'in' ? 'in' : 'out',
        number: String(entry.number || ''),
        name: String(entry.name || ''),
        result: entry.result || 'failed',
        duration: Math.max(0, Math.floor(entry.duration || 0))
      });
      if (list.length > MAX) { list = list.slice(0, MAX); }
      save(list);
      return list.length;
    },
    clear: function () { save([]); },
    /* one-line label for the log screen */
    label: function (e) {
      var arrow = e.dir === 'in' ? (e.result === 'missed' ? '! ' : '< ') : '> ';
      var who = e.name ? e.name : (e.number || '?');
      var d = new Date(e.ts);
      function p(n) { return ('0' + n).slice(-2); }
      return arrow + who + '  ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
  };
}());
