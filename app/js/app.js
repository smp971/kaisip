/* Wiring. ES5. */
(function () {
  'use strict';
  Log.i('app', 'KaiSIP ' + KAISIP_VERSION + ' log=' + Log.fileName());
  Log.i('env', navigator.userAgent);

  Sip.on('state', function () { UI.refreshStatus(); });
  UI.init();

  Sip.start();            /* connects, or sets state "unconfigured" when the account is missing */
  if (!Config.isComplete()) { UI.openLogin(); }

  document.addEventListener('visibilitychange', function () {
    Log.i('app', 'visibility hidden=' + document.hidden);
    if (document.hidden) { Log.flush(); }
  });
  window.addEventListener('beforeunload', function () { Log.flush(); });
}());
