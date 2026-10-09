/* Background modes (Config.background):
     off : nothing special; the app is alive only while open (and during calls)
     low : "economic": no permanent wake lock. A system alarm wakes the phone every few minutes to
           verify the SIP connection; registration lasts 30 min; the server must keep idle sockets
           open (http.conf session_inactivity). Incoming calls wake the app through the network.
     on  : permanent CPU wake lock (measured: timers exact for 16 min, but costs battery)
   ES5. */
var Background = (function () {
  'use strict';
  var ALARM_MINUTES = 15;
  var lock = null, alarmId = null, alarmHold = null, holdTimer = null;

  function releaseHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    try { if (alarmHold) { alarmHold.unlock(); } } catch (e) {}
    alarmHold = null;
  }

  function cancelAlarm() {
    if (alarmId !== null) {
      try { navigator.mozAlarms.remove(alarmId); } catch (e) {}
      alarmId = null;
    }
  }

  function scheduleAlarm() {
    try {
      if (!navigator.mozAlarms) { Log.w('bg', 'no mozAlarms'); return; }
      cancelAlarm();
      var when = new Date(Date.now() + ALARM_MINUTES * 60000);
      var r = navigator.mozAlarms.add(when, 'ignoreTimezone', { kind: 'kaisip-ensure' });
      r.onsuccess = function () { alarmId = r.result; Log.i('bg', 'alarm #' + alarmId + ' set for ' + when.toISOString()); };
      r.onerror = function () { Log.w('bg', 'alarm add failed: ' + (r.error && r.error.name)); };
    } catch (e) { Log.w('bg', 'scheduleAlarm: ' + e); }
  }

  /* runs when the alarm fires (the system may start the app in the background for it) */
  function onAlarm() {
    Log.i('bg', 'alarm fired, mode=' + Config.get().background);
    if (Config.get().background !== 'low') { return; }
    try {   /* keep the CPU up only while we verify the connection */
      if (navigator.requestWakeLock && !alarmHold) { alarmHold = navigator.requestWakeLock('cpu'); }
    } catch (e) { Log.w('bg', 'hold failed: ' + e); }
    if (holdTimer) { clearTimeout(holdTimer); }
    holdTimer = setTimeout(releaseHold, 25000);
    Sip.ensure();
    scheduleAlarm();
  }

  function apply() {
    var mode = Config.get().background;
    Log.i('bg', 'apply mode=' + mode);
    if (mode === 'on' && !lock) {
      try {
        if (navigator.requestWakeLock) { lock = navigator.requestWakeLock('cpu'); Log.i('bg', 'wake lock acquired'); }
        else { Log.w('bg', 'no requestWakeLock'); }
      } catch (e) { Log.e('bg', 'wake lock failed: ' + e); }
    } else if (mode !== 'on' && lock) {
      try { lock.unlock(); } catch (e2) {}
      lock = null;
      Log.i('bg', 'wake lock released');
    }
    if (mode === 'low') { scheduleAlarm(); } else { cancelAlarm(); releaseHold(); }
  }

  /* bring the app to the foreground (incoming call while the app is hidden) */
  function bringToFront() {
    try {
      if (navigator.mozApps && navigator.mozApps.getSelf) {
        var req = navigator.mozApps.getSelf();
        req.onsuccess = function () { try { if (req.result) { req.result.launch(); } } catch (e) { Log.w('bg', 'launch failed: ' + e); } };
      }
    } catch (e3) { Log.w('bg', 'bringToFront: ' + e3); }
  }

  try {
    if (navigator.mozSetMessageHandler) { navigator.mozSetMessageHandler('alarm', onAlarm); }
  } catch (e4) { /* no alarm messages on this platform */ }

  return {
    apply: apply,
    active: function () { return !!lock; },
    bringToFront: bringToFront,
    ALARM_MINUTES: ALARM_MINUTES
  };
}());
