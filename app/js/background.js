/* Background modes (Config.background):
     off : nothing special; the app is alive only while open (and during calls)
     on  : permanent CPU wake lock, so the connection and the registration stay alive with the screen off (costs battery)
   ES5. */
var Background = (function () {
  'use strict';
  var lock = null;

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

  return {
    apply: apply,
    active: function () { return !!lock; },
    bringToFront: bringToFront
  };
}());
