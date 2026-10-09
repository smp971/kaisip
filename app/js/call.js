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

  function mediaOptions() {
    return {
      mediaConstraints: { audio: true, video: false },
      pcConfig: pcConfig(),
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      rtcAnswerConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false }
    };
  }

  function sipUri(number) {
    return 'sip:' + encodeURIComponent(number) + '@' + Config.get().domain;
  }

  function setState(st) {
    if (!current || current.state === st) { return; }
    current.state = st;
    Log.i('call', 'state=' + st + ' dir=' + current.dir);
    emit('change', current);
  }

  function lockCpu() {
    try { if (!wakeLock && navigator.requestWakeLock) { wakeLock = navigator.requestWakeLock('cpu'); } }
    catch (e) { Log.w('call', 'wake lock failed: ' + e); }
  }
  function unlockCpu() {
    try { if (wakeLock) { wakeLock.unlock(); } } catch (e) {}
    wakeLock = null;
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
    Sound.stopAll();
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
    Log.i('call', 'finished result=' + result + ' cause=' + cause + (code ? ' code=' + code : '') + ' dur=' + dur + 's');
    CallLog.add({ dir: c.dir, number: c.number, name: c.name, result: result, duration: dur });
    c.message = message;
    c.state = 'ended';
    emit('ended', c);
    if (cleanupTimer) { clearTimeout(cleanupTimer); }
    cleanupTimer = setTimeout(function () { if (current === c) { current = null; emit('cleared', null); } }, 1800);
  }

  function attach(session, dir, number, name) {
    if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null; }
    current = {
      dir: dir, number: number, name: name || '', session: session,
      state: dir === 'out' ? 'calling' : 'incoming', t0: Date.now(), answeredAt: 0, muted: false,
      ended: false, rejected: false, message: ''
    };
    Log.i('call', 'new ' + dir + ' call ' + number);
    lockCpu();

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
        if (hasSdp) { Sound.stopRingback(); } else { Sound.startRingback(); }
      }
    });
    session.on('accepted', function () {
      if (!current || current.session !== session) { return; }
      Sound.stopRingback(); Sound.stopRingtone();
      current.answeredAt = Date.now();
      setState('incall');
      startTick();
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
        attach(s, 'in', num, nm);
        Sound.startRingtone(Config.get().ringVolume);
      } else {
        var out = pendingOut || { number: '?' };
        pendingOut = null;
        attach(s, 'out', out.number, '');
      }
    });
  }

  return {
    bindUA: bindUA,
    current: function () { return current; },
    inCall: function () { return !!(current && !current.ended); },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    dial: function (rawNumber) {
      var number = Util.filterNumber(rawNumber);
      if (!number) { return 'Număr invalid'; }
      if (current && !current.ended) { return 'Ești deja într-un apel'; }
      if (Sip.state().state !== 'registered') { return 'Nu ești înregistrat'; }
      var ua = Sip.ua();
      if (!ua) { return 'Conexiune indisponibilă'; }
      pendingOut = { number: number };
      try {
        ua.call(sipUri(number), mediaOptions());
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

    dtmf: function (tone) {
      if (!current || current.state !== 'incall' || !/^[0-9*#]$/.test(tone)) { return; }
      try {
        current.session.sendDTMF(tone, { transportType: 'RFC2833' });
      } catch (e) {
        Log.w('call', 'RFC2833 DTMF failed (' + e + '), trying INFO');
        try { current.session.sendDTMF(tone, { transportType: 'INFO' }); }
        catch (e2) { Log.e('call', 'DTMF failed: ' + e2); }
      }
    },

    _sipUri: sipUri
  };
}());
