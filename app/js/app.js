/* Wiring. ES5. */
(function () {
  'use strict';
  Log.i('app', 'KaiSIP ' + KAISIP_VERSION + ' log=' + Log.fileName());
  Log.i('env', navigator.userAgent);
  Log.i('app', 'earpiece routing available: ' + Route.supported() + ' | headphones: ' + Route.headphones());

  Sip.on('state', function () { UI.refreshStatus(); });
  Sip.on('ua', function (ua) { Call.bindUA(ua); Chat.bindUA(ua); });
  UI.init();

  Background.apply();     /* wake lock / alarm according to the saved mode */
  Sip.start();            /* connects, or sets state "unconfigured" when the account is missing */
  if (!Config.isComplete()) { UI.openLogin(); }

  document.addEventListener('visibilitychange', function () {
    Log.i('app', 'visibility hidden=' + document.hidden);
    if (document.hidden) { Log.flush(); }
  });
  window.addEventListener('beforeunload', function () { Log.flush(); });
}());
