/* Call control on top of JsSIP RTCSession: outgoing, incoming, mute, DTMF, hang-up, call log.
   current = { dir:'out'|'in', number, name, session, state, t0, answeredAt, muted, ended }
   states: calling | ringing | incoming | incall | ended */
var Call = (function () {
  'use strict';
  var current = null;
  var handlers = {};
  var pendingOut = null;     /* number being dialled, until JsSIP announces the session */
  var tickTimer = null, wakeLock = null, cleanupTimer = null;

  function emit(ev, data) {
    var list = handlers[ev] || [], i;
    for (i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { Log.e('call', 'handler ' + ev + ': ' + e); }
    }
  }

  function pcConfig() {
    var c = Config.get(), ice = [];
    if (c.stun) { ice.push({ urls: c.stun }); }
    return { iceServers: ice };
  }

  function mediaOptions(extraHeaders) {
    var o = {
      mediaConstraints: { audio: true, video: false },
      pcConfig: pcConfig(),
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      rtcAnswerConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
    };
    if (extraHeaders) { o.extraHeaders = extraHeaders; }
    return o;
  }

  /* answer options for a PTT transmission: listen only, the microphone stays closed */
  function receiveOnlyOptions() {
    var o = {
      pcConfig: pcConfig(),
      rtcAnswerConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
    };
    try { o.mediaStream = new MediaStream(); }
    catch (e) {   /* no MediaStream constructor: an empty-input Web Audio destination carries only silence */
      var AC = window.AudioContext || window.webkitAudioContext;
      o.mediaStream = new AC().createMediaStreamDestination().stream;
    }
    return o;
  }

  function sipUri(number) {
    return 'sip:' + encodeURIComponent(number) + '@' + Config.get().domain;
  }

  /* true only when the browser can really send RFC 2833 events on this call */
  function hasRtpDtmf(session) {
    try {
      var pc = session.connection, senders = pc && pc.getSenders ? pc.getSenders() : [], i;
      for (i = 0; i < senders.length; i++) {
        if (senders[i].track && senders[i].track.kind === 'audio' && senders[i].dtmf) { return true; }
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  function setState(st) {
    if (!current || current.state === st) { return; }
    current.state = st;
    Log.i('call', 'state=' + st + ' dir=' + current.dir);
    emit('change', current);
  }

  var screenLock = null;
  function lockCpu() {
    try { if (!wakeLock && navigator.requestWakeLock) { wakeLock = navigator.requestWakeLock('cpu'); } }
    catch (e) { Log.w('call', 'wake lock failed: ' + e); }
  }
  function unlockCpu() {
    try { if (wakeLock) { wakeLock.unlock(); } } catch (e) {}
    wakeLock = null;
  }
  /* while an incoming call rings, try to light the screen so the call can be seen */
  function lockScreen() {
    try { if (!screenLock && navigator.requestWakeLock) { screenLock = navigator.requestWakeLock('screen'); } }
    catch (e) { Log.w('call', 'screen lock failed: ' + e); }
  }
  function unlockScreen() {
    try { if (screenLock) { screenLock.unlock(); } } catch (e) {}
    screenLock = null;
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(function () { emit('tick', current); }, 1000);
  }
  function stopTick() { if (tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; } }

  function hookPeerConnection(pc) {
    pc.addEventListener('addstream', function (ev) {
      Log.i('call', 'remote stream added');
      Sound.playRemote(ev.stream);
    });
    pc.addEventListener('track', function (ev) {
      if (ev.streams && ev.streams[0]) { Log.i('call', 'remote track added'); Sound.playRemote(ev.streams[0]); }
    });
    pc.addEventListener('iceconnectionstatechange', function () {
      Log.i('call', 'ice=' + pc.iceConnectionState);
    });
  }

  function finish(kind, cause, code) {
    if (!current || current.ended) { return; }
    var c = current;
    c.ended = true;
    stopTick();
    unlockCpu();
    unlockScreen();
    Sound.stopAll();
    Route.end();
    var dur = c.answeredAt ? Math.round((Date.now() - c.answeredAt) / 1000) : 0;
    var result;
    if (c.answeredAt) { result = 'answered'; }
    else if (c.dir === 'in') { result = c.rejected ? 'rejected' : 'missed'; }
    else { result = 'failed'; }
    var message = '';
    if (kind === 'failed') {
      message = code ? Errors.sip(code) : Errors.cause(cause);
    } else {
      message = 'Apel încheiat';
    }
    Log.i('call', 'finished' + (c.ptt ? ' (PTT)' : '') + ' result=' + result + ' cause=' + cause + (code ? ' code=' + code : '') + ' dur=' + dur + 's');
    if (!c.ptt) { CallLog.add({ dir: c.dir, number: c.number, name: c.name, result: result, duration: dur }); }
    c.message = message;
    c.state = 'ended';
    emit('ended', c);
    if (cleanupTimer) { clearTimeout(cleanupTimer); }
    cleanupTimer = setTimeout(function () { if (current === c) { current = null; emit('cleared', null); } }, 1800);
  }

  function attach(session, dir, number, name, ptt) {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
    var known = Contacts.findByNumber(number);
    current = {
      dir: dir, number: number, name: (known ? known.name : (name || '')), session: session,
      state: dir === 'out' ? 'calling' : 'incoming', t0: Date.now(), answeredAt: 0, muted: false,
      ended: false, rejected: false, message: '', dtmf: '', ptt: !!ptt
    };
    Log.i('call', 'new ' + dir + (ptt ? ' PTT' : '') + ' call ' + number);
    lockCpu();
    if (dir === 'out') { if (!ptt) { Route.begin(); } }
    else { lockScreen(); Background.bringToFront(); }

    var iceReady = false, readyFn = null, iceTimer = null;
    session.on('icecandidate', function (e) {
      /* do not wait for every candidate: go once we have a server-reflexive one, or after 1.5 s */
      if (iceReady) { return; }
      if (e.ready) { readyFn = e.ready; }
      if (e.candidate && /typ srflx/.test(e.candidate.candidate)) {
        iceReady = true;
        if (iceTimer) { clearTimeout(iceTimer); }
        e.ready();
      } else if (!e.candidate) {
        iceReady = true;
      } else if (!iceTimer) {
        iceTimer = setTimeout(function () {
          if (!iceReady && readyFn) { iceReady = true; Log.i('call', 'ICE wait timeout, sending now'); readyFn(); }
        }, 1500);
      }
    });
    session.on('peerconnection', function (e) { hookPeerConnection(e.peerconnection); });
    session.on('progress', function (e) {
      if (current && current.session === session && dir === 'out') {
        setState('ringing');
        var hasSdp = e.response && e.response.body;
        if (hasSdp) { Sound.stopRingback(); } else if (!current.ptt) { Sound.startRingback(); }
      }
    });
    session.on('accepted', function () {
      if (!current || current.session !== session) { return; }
      Sound.stopRingback(); Sound.stopRingtone();
      current.answeredAt = Date.now();
      setState('incall');
      startTick();
      if (current.ptt && current.dir === 'out') { Sound.beep(); }      /* the channel is open: speak */
    });
    session.on('confirmed', function () {
      if (!current || current.session !== session) { return; }
      if (!current.answeredAt) { current.answeredAt = Date.now(); setState('incall'); startTick(); }
      try {   /* in case the stream event was missed */
        var rs = session.connection && session.connection.getRemoteStreams ? session.connection.getRemoteStreams() : [];
        if (rs.length) { Sound.playRemote(rs[0]); }
      } catch (err) { Log.w('call', 'getRemoteStreams: ' + err); }
    });
    session.on('muted', function () { if (current) { current.muted = true; emit('change', current); } });
    session.on('unmuted', function () { if (current) { current.muted = false; emit('change', current); } });
    session.on('ended', function (e) { finish('ended', e && e.cause); });
    session.on('failed', function (e) {
      var code = e && e.message && e.message.status_code;
      finish('failed', e && e.cause, code);
    });

    emit('new', current);
    emit('change', current);
  }

  function bindUA(ua) {
    ua.on('newRTCSession', function (data) {
      var s = data.session;
      if (data.originator === 'remote') {
        if (current && !current.ended) {
          Log.w('call', 'busy: rejecting second incoming call');
          try { s.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch (e) {}
          return;
        }
        var ru = s.remote_identity;
        var num = ru && ru.uri ? decodeURIComponent(ru.uri.user || '') : '?';
        var nm = ru && ru.display_name ? ru.display_name : '';
        var pttHeader = null;
        try { pttHeader = data.request && data.request.getHeader ? data.request.getHeader(Ptt.HEADER) : null; } catch (eh) {}
        try { Log.i('call', 'incoming INVITE from ' + num + ' headers: ' + Object.keys((data.request && data.request.headers) || {}).join(',')); } catch (ek) {}
        if (Ptt.shouldAutoAnswer(pttHeader, num)) {
          attach(s, 'in', num, nm, true);
          Route.setSpeaker(true);                       /* a walkie-talkie is heard on the speaker */
          Sound.beep();
          try { s.answer(receiveOnlyOptions()); }
          catch (ea) { Log.e('call', 'PTT auto-answer failed: ' + ea); }
          return;
        }
        if (pttHeader) { Log.w('call', 'PTT header from ' + num + ' ignored: not in the PTT members list'); }
        attach(s, 'in', num, nm);
        Sound.startRingtone(Config.get().ringVolume);
      } else {
        var out = pendingOut || { number: '?' };
        pendingOut = null;
        attach(s, 'out', out.number, '', out.ptt);
      }
    });
  }

  return {
    bindUA: bindUA,
    current: function () { return current; },
    inCall: function () { return !!(current && !current.ended); },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    /* opts.ptt: a push-to-talk transmission (adds the X-KaiSIP-PTT header, no ringback, not in the call log) */
    dial: function (rawNumber, opts) {
      var ptt = !!(opts && opts.ptt);
      var number = Util.filterNumber(rawNumber);
      if (!number) { return 'Număr invalid'; }
      if (number === Config.get().extension) { return 'Acesta e numărul tău'; }
      if (current && !current.ended) { return 'Ești deja într-un apel'; }
      if (Sip.state().state !== 'registered') { return 'Nu ești înregistrat'; }
      var ua = Sip.ua();
      if (!ua) { return 'Conexiune indisponibilă'; }
      pendingOut = { number: number, ptt: ptt };
      try {
        ua.call(sipUri(number), mediaOptions(ptt ? [Ptt.HEADER + ': 1'] : null));
      } catch (e) {
        pendingOut = null;
        Log.e('call', 'dial failed: ' + e);
        return 'Apelul nu a pornit';
      }
      return '';
    },

    answer: function () {
      if (!current || current.dir !== 'in' || current.state !== 'incoming') { return; }
      Sound.stopRingtone();
      unlockScreen();
      Route.begin();
      try { current.session.answer(mediaOptions()); }
      catch (e) { Log.e('call', 'answer failed: ' + e); }
    },

    reject: function () {
      if (!current || current.dir !== 'in' || current.state !== 'incoming') { return; }
      current.rejected = true;
      try { current.session.terminate({ status_code: 603, reason_phrase: 'Decline' }); }
      catch (e) { Log.e('call', 'reject failed: ' + e); }
    },

    hangup: function () {
      if (!current || current.ended) { return; }
      try { current.session.terminate(); }
      catch (e) { Log.e('call', 'hangup failed: ' + e); finish('ended', 'Local'); }
    },

    toggleMute: function () {
      if (!current || current.state !== 'incall') { return; }
      try {
        if (current.muted) { current.session.unmute({ audio: true }); }
        else { current.session.mute({ audio: true }); }
      } catch (e) { Log.e('call', 'mute failed: ' + e); }
    },

    /* Gecko 48 has no RTCDTMFSender, and JsSIP then silently does nothing for RFC 2833.
       So: RTP DTMF only when a sender really exists, otherwise SIP INFO (needs dtmf_mode=info on the PBX endpoint). */
    dtmf: function (tone) {
      if (!current || current.state !== 'incall' || !/^[0-9*#]$/.test(tone)) { return; }
      var session = current.session;
      current.dtmf = (current.dtmf + tone).slice(-16);
      if (hasRtpDtmf(session)) {
        try {
          session.sendDTMF(tone, { transportType: 'RFC2833' });
          Log.i('call', 'dtmf ' + tone + ' via RFC2833');
        } catch (e) { Log.e('call', 'RFC2833 DTMF failed: ' + e); }
      } else {
        try {
          session.sendInfo('application/dtmf-relay', 'Signal=' + tone + '\r\nDuration=160', {
            eventHandlers: {
              succeeded: function (d) { Log.i('call', 'dtmf ' + tone + ' INFO accepted (' + (d && d.response && d.response.status_code) + ')'); },
              failed: function (d) {
                var code = d && d.response && d.response.status_code;
                Log.w('call', 'dtmf ' + tone + ' INFO rejected (' + code + ')');
                if (current) { current.dtmfError = code ? ('Server: ' + code) : 'fără răspuns'; emit('change', current); }
              }
            }
          });
          Log.i('call', 'dtmf ' + tone + ' sent via INFO');
        } catch (e2) { Log.e('call', 'INFO DTMF failed: ' + e2); }
      }
      emit('change', current);
    },

    /* in-call volume: dir = +1 / -1 along Util.VOLUME_STEPS */
    volume: function (dir) {
      var v = Sound.stepRemoteVolume(dir);
      Log.i('call', 'volume ' + Math.round(v * 100) + '%');
      if (current) { emit('change', current); }
      return v;
    },

    toggleRoute: function () {
      if (!current || current.ended) { return false; }
      var ok = Route.toggle();
      emit('change', current);
      return ok;
    },

    _sipUri: sipUri
  };
}());
