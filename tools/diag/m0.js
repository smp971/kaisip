/* M0 diagnostics: feature detection, audio-channel routing test, JsSIP load check.
   Keys: 1 tone on 'content' channel, 2 tone on 'telephony' channel, 3 channel manager info,
         4 JsSIP check, 5 mic + loopback tone check, 0 flush log, * clear screen. */
(function () {
  'use strict';
  var out = document.getElementById('out');
  var MAXLINES = 200;

  Log.onLine(function (line) {
    out.textContent += line + '\n';
    var lines = out.textContent.split('\n');
    if (lines.length > MAXLINES) { out.textContent = lines.slice(-MAXLINES).join('\n'); }
    window.scrollTo(0, document.body.scrollHeight);
  });

  Log.i('app', 'KaiSIP M0 ' + (window.KAISIP_VERSION || '?') + ' log=' + Log.fileName());
  Log.i('env', navigator.userAgent);

  function typ(x) { return typeof x; }
  Log.i('feat', 'RTCPeerConnection=' + typ(window.RTCPeerConnection) +
    ' moz=' + typ(window.mozRTCPeerConnection) +
    ' mediaDevices=' + typ(navigator.mediaDevices) +
    ' WebSocket=' + typ(window.WebSocket) + ' Promise=' + typ(window.Promise));
  Log.i('feat', 'wakeLock=' + typ(navigator.requestWakeLock) + ' mozAlarms=' + typ(navigator.mozAlarms) +
    ' vibrate=' + typ(navigator.vibrate) + ' notification=' + typ(window.Notification));
  Log.i('feat', 'DeviceStorage=' + typ(navigator.getDeviceStorage) +
    ' appendNamed=' + (function () { try { return typ(navigator.getDeviceStorage('sdcard').appendNamed); } catch (e) { return 'err'; } }()));
  Log.i('feat', 'mozAudioChannelManager=' + typ(navigator.mozAudioChannelManager));

  /* ---- tone generator: 1 kHz, 8 kHz sample rate, 16-bit mono ---- */
  function toneUrl(seconds) {
    var rate = 8000, n = rate * seconds;
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, str) { for (var i = 0; i < str.length; i++) { v.setUint8(o + i, str.charCodeAt(i)); } }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * 12000), true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function playTone(channel) {
    try {
      var a = new Audio(toneUrl(3));
      a.mozAudioChannelType = channel;
      Log.i('tone', 'channel requested=' + channel + ' effective=' + a.mozAudioChannelType);
      a.onplay = function () { Log.i('tone', channel + ' onplay'); };
      a.onended = function () { Log.i('tone', channel + ' ended'); };
      a.onerror = function () { Log.e('tone', channel + ' error ' + (a.error && a.error.code)); };
      var pr = a.play();
      if (pr && pr.then) {
        pr.then(function () { Log.i('tone', channel + ' play() resolved'); },
                function (e) { Log.e('tone', channel + ' play() rejected ' + e); });
      }
      Log.i('tone', 'LISTEN: where does the 1 kHz tone come out? (earpiece / speaker / headset / none)');
    } catch (e) { Log.e('tone', channel + ' EXC ' + e); }
  }

  function channelInfo() {
    var m = navigator.mozAudioChannelManager;
    if (!m) { Log.w('chan', 'no mozAudioChannelManager'); return; }
    var keys = [], k;
    for (k in m) { keys.push(k); }
    Log.i('chan', 'props: ' + keys.join(','));
    try { Log.i('chan', 'headphones=' + m.headphones + ' telephonySpeaker=' + m.telephonySpeaker); }
    catch (e) { Log.e('chan', 'read EXC ' + e); }
    try { Log.i('chan', 'volumeControlChannel=' + m.volumeControlChannel); } catch (e2) {}
  }

  function jssipCheck() {
    if (typeof JsSIP === 'undefined') { Log.w('jssip', 'JsSIP not loaded (js/lib/jssip.min.js missing)'); return; }
    Log.i('jssip', 'loaded version=' + (JsSIP.version || JsSIP.C && JsSIP.C.version || '?'));
    try {
      var sock = new JsSIP.WebSocketInterface('wss://pbx.example.com/ws');
      var ua = new JsSIP.UA({ sockets: [sock], uri: 'sip:test@pbx.example.com', register: false });
      Log.i('jssip', 'UA constructed OK (not started)');
      ua.start();
      ua.on('connected', function () { Log.i('jssip', 'UA connected to WSS'); ua.stop(); });
      ua.on('disconnected', function (e) { Log.i('jssip', 'UA disconnected ' + (e && (e.code || e.reason))); });
      setTimeout(function () { try { ua.stop(); } catch (e) {} }, 12000);
    } catch (e) { Log.e('jssip', 'EXC ' + e + (e && e.stack ? ' | ' + String(e.stack).substr(0, 200) : '')); }
  }

  function micCheck() {
    var gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      ? function (c) { return navigator.mediaDevices.getUserMedia(c); }
      : null;
    if (!gum) { Log.w('mic', 'no mediaDevices.getUserMedia'); return; }
    gum({ audio: true }).then(function (stream) {
      Log.i('mic', 'OK tracks=' + stream.getAudioTracks().length);
      var a = new Audio();
      a.mozAudioChannelType = 'content';
      if ('mozSrcObject' in a) { a.mozSrcObject = stream; } else { a.srcObject = stream; }
      a.play();
      Log.i('mic', 'LOOPBACK for 5 s: speak, do you hear yourself? (use headphones to avoid feedback)');
      setTimeout(function () { stream.getTracks().forEach(function (t) { t.stop(); }); Log.i('mic', 'loopback stopped'); }, 5000);
    }, function (e) { Log.e('mic', 'FAIL ' + (e && (e.name || e.message || e))); });
  }

  document.addEventListener('keydown', function (e) {
    switch (e.key) {
      case '1': playTone('content'); break;
      case '2': playTone('telephony'); break;
      case '3': channelInfo(); break;
      case '4': jssipCheck(); break;
      case '5': micCheck(); break;
      case '0': Log.flush(); Log.i('log', 'flushed mode=' + Log.mode()); break;
      case '*': out.textContent = ''; break;
      default: break;
    }
  });

  Log.i('help', 'keys: 1 tone content | 2 tone telephony | 3 chan info | 4 JsSIP | 5 mic loopback | 0 flush');
  channelInfo();
  jssipCheck();
  setTimeout(function () { Log.flush(); }, 4000);
}());
