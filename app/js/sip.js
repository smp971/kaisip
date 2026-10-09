/* SIP over WebSocket via JsSIP: connection, registration, keep-alive, recovery. ES5.
   States: unconfigured | connecting | registered | offline | authfail | error */
var Sip = (function () {
  'use strict';
  var KEEPALIVE_MS = 20000;
  var REGISTER_EXPIRES = 120;

  var ua = null, socket = null, keepTimer = null, stopping = false;
  var state = 'idle', detail = '';
  var handlers = {};

  function emit(ev, data) {
    var list = handlers[ev] || [], i;
    for (i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { Log.e('sip', 'handler ' + ev + ': ' + e); }
    }
  }

  function setState(s, d) {
    d = d || '';
    if (s === state && d === detail) { return; }
    state = s;
    detail = d;
    Log.i('sip', 'state=' + s + (d ? ' (' + d + ')' : ''));
    emit('state', { state: s, detail: d });
  }

  function stopKeepalive() {
    if (keepTimer !== null) { clearInterval(keepTimer); keepTimer = null; }
  }

  /* RFC 5626 style CRLF CRLF ping so the server's idle timer is reset */
  function startKeepalive() {
    stopKeepalive();
    keepTimer = setInterval(function () {
      try {
        if (socket && socket.isConnected && socket.isConnected()) { socket.send('\r\n\r\n'); }
      } catch (e) { Log.w('sip', 'keepalive failed: ' + e); }
    }, KEEPALIVE_MS);
  }

  function start() {
    stop();
    var c = Config.get();
    if (!Config.isComplete()) { setState('unconfigured'); return; }
    if (typeof JsSIP === 'undefined') { setState('error', 'JsSIP lipsește'); return; }
    stopping = false;
    try {
      socket = new JsSIP.WebSocketInterface(c.wssUrl);
      ua = new JsSIP.UA({
        sockets: [socket],
        uri: 'sip:' + c.extension + '@' + c.domain,
        authorization_user: c.extension,
        password: c.password,
        register: true,
        register_expires: REGISTER_EXPIRES,
        session_timers: false,
        connection_recovery_min_interval: 2,
        connection_recovery_max_interval: 30,
        user_agent: 'KaiSIP/' + (window.KAISIP_VERSION || '0')
      });
    } catch (e) {
      Log.e('sip', 'UA create failed: ' + e);
      setState('error', String(e));
      return;
    }

    ua.on('connected', function () {
      Log.i('sip', 'websocket connected');
      startKeepalive();
      if (state !== 'registered') { setState('connecting', 'se înregistrează'); }
    });
    ua.on('disconnected', function (e) {
      Log.w('sip', 'websocket disconnected code=' + (e && e.code) + ' reason=' + (e && e.reason));
      stopKeepalive();
      if (!stopping) { setState('offline', 'conexiune pierdută'); }
    });
    ua.on('registered', function () { setState('registered'); });
    ua.on('unregistered', function () {
      if (!stopping && state === 'registered') { setState('offline', 'neînregistrat'); }
    });
    ua.on('registrationFailed', function (e) {
      var code = e && e.response && e.response.status_code;
      Log.w('sip', 'registration failed code=' + code + ' cause=' + (e && e.cause));
      var st = code ? Errors.registrationState(code) : 'offline';
      setState(st, code ? Errors.sip(code) : String((e && e.cause) || 'înregistrare eșuată'));
    });

    setState('connecting', 'se conectează');
    ua.start();
  }

  function stop() {
    stopping = true;
    stopKeepalive();
    if (ua) {
      try { ua.stop(); } catch (e) { Log.w('sip', 'stop: ' + e); }
    }
    ua = null;
    socket = null;
  }

  function restart() { Log.i('sip', 'restart'); start(); }

  window.addEventListener('online', function () {
    Log.i('sip', 'browser online');
    if (state === 'offline' && Config.isComplete()) { restart(); }
  });
  window.addEventListener('offline', function () {
    Log.w('sip', 'browser offline');
    if (state === 'registered' || state === 'connecting') { setState('offline', Errors.text('network')); }
  });

  return {
    start: start,
    stop: stop,
    restart: restart,
    state: function () { return { state: state, detail: detail }; },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
  };
}());
