/* Buffered logger. One file per run in sip-logs/ on the SD card. ES5. */
var Log = (function () {
  'use strict';
  var d = new Date();
  function p(n) { return ('0' + n).slice(-2); }
  var fname = 'sip-logs/run-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.txt';
  var full = '';        /* everything logged this run */
  var pending = '';     /* not yet written */
  var created = false, busy = false, timer = null, failures = 0, mode = 'unknown';
  var onLine = null;

  function storage() {
    try { return navigator.getDeviceStorage ? navigator.getDeviceStorage('sdcard') : null; }
    catch (e) { return null; }
  }

  function finish(ok, text) {
    busy = false;
    if (ok) { failures = 0; }
    else { failures++; pending = text + pending; }
    if (pending && failures < 3) { schedule(1500); }
  }

  function flush() {
    timer = null;
    if (busy || !pending) { return; }
    var ds = storage();
    if (!ds) { return; }
    var text = pending;
    pending = '';
    busy = true;
    var req;
    try {
      if (!created) {
        mode = 'addNamed';
        req = ds.addNamed(new Blob([text], { type: 'text/plain' }), fname);
        req.onsuccess = function () { created = true; finish(true, text); };
        req.onerror = function () { finish(false, text); };
      } else if (ds.appendNamed) {
        mode = 'appendNamed';
        req = ds.appendNamed(new Blob([text], { type: 'text/plain' }), fname);
        req.onsuccess = function () { finish(true, text); };
        req.onerror = function () { finish(false, text); };
      } else {
        mode = 'rewrite';
        var del = ds['delete'](fname);
        var add = function () {
          var r2 = ds.addNamed(new Blob([full], { type: 'text/plain' }), fname);
          r2.onsuccess = function () { finish(true, text); };
          r2.onerror = function () { finish(false, text); };
        };
        del.onsuccess = add;
        del.onerror = add;
      }
    } catch (e) {
      finish(false, text);
    }
  }

  function schedule(ms) {
    if (timer === null) { timer = setTimeout(flush, ms || 3000); }
  }

  function write(level, tag, msg) {
    var t = new Date();
    var line = p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds()) +
      ' ' + level + ' ' + tag + ' ' + msg;
    full += line + '\n';
    pending += line + '\n';
    try { console.log('KAISIP ' + line); } catch (e) {}
    if (onLine) { try { onLine(line); } catch (e2) {} }
    schedule(3000);
  }

  return {
    i: function (tag, msg) { write('I', tag, msg); },
    w: function (tag, msg) { write('W', tag, msg); },
    e: function (tag, msg) { write('E', tag, msg); },
    flush: function () { if (timer !== null) { clearTimeout(timer); timer = null; } flush(); },
    onLine: function (fn) { onLine = fn; },
    fileName: function () { return fname; },
    mode: function () { return mode; }
  };
}());
