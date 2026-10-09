/* Certified audio-routing diagnostics.
   1 tone on 'content'   2 tone on 'telephony'   3 toggle mozTelephony.speakerEnabled
   4 dump mozTelephony / mozAudioChannelManager   5 mic loopback on 'telephony'   0 flush log */
(function () {
  'use strict';
  var out = document.getElementById('out');
  Log.onLine(function (line) {
    out.textContent += line + '\n';
    var l = out.textContent.split('\n');
    if (l.length > 200) { out.textContent = l.slice(-200).join('\n'); }
    window.scrollTo(0, document.body.scrollHeight);
  });
  Log.i('diag', 'KaiSIP Diag (certified) ' + navigator.userAgent);
  function typ(x) { return typeof x; }
  Log.i('feat', 'mozTelephony=' + typ(navigator.mozTelephony) + ' mozAudioChannelManager=' + typ(navigator.mozAudioChannelManager) +
        ' mozSettings=' + typ(navigator.mozSettings));

  function toneUrl(seconds) {
    var rate = 8000, n = rate * seconds;
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, str) { for (var i = 0; i < str.length; i++) { v.setUint8(o + i, str.charCodeAt(i)); } }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) { v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * 12000), true); }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function tone(channel) {
    try {
      var a = new Audio(toneUrl(4));
      a.mozAudioChannelType = channel;
      Log.i('tone', 'requested=' + channel + ' effective=' + a.mozAudioChannelType + ' speakerEnabled=' + speaker());
      a.onplay = function () { Log.i('tone', channel + ' onplay'); };
      a.onended = function () { Log.i('tone', channel + ' ended'); };
      a.onerror = function () { Log.e('tone', channel + ' error'); };
      var p = a.play();
      if (p && p.then) { p.then(null, function (e) { Log.e('tone', 'rejected ' + e); }); }
      Log.i('tone', 'LISTEN: earpiece / speaker / nothing?');
    } catch (e) { Log.e('tone', 'EXC ' + e); }
  }

  function speaker() {
    try { return navigator.mozTelephony ? navigator.mozTelephony.speakerEnabled : 'n/a'; } catch (e) { return 'err:' + e; }
  }

  function toggleSpeaker() {
    try {
      if (!navigator.mozTelephony) { Log.w('spk', 'no mozTelephony'); return; }
      var before = navigator.mozTelephony.speakerEnabled;
      navigator.mozTelephony.speakerEnabled = !before;
      Log.i('spk', 'speakerEnabled ' + before + ' -> ' + navigator.mozTelephony.speakerEnabled);
    } catch (e) { Log.e('spk', 'EXC ' + e); }
  }

  function dump() {
    var objs = { mozTelephony: navigator.mozTelephony, mozAudioChannelManager: navigator.mozAudioChannelManager };
    Object.keys(objs).forEach(function (name) {
      var o = objs[name];
      if (!o) { Log.w('dump', name + ' missing'); return; }
      var keys = [], k;
      for (k in o) { keys.push(k); }
      Log.i('dump', name + ': ' + keys.join(','));
    });
  }

  function micLoop() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var a = new Audio();
      a.mozAudioChannelType = 'telephony';
      if ('mozSrcObject' in a) { a.mozSrcObject = stream; } else { a.srcObject = stream; }
      a.play();
      Log.i('mic', 'loopback on telephony channel for 6 s (use headphones if on speaker)');
      setTimeout(function () { stream.getTracks().forEach(function (t) { t.stop(); }); Log.i('mic', 'stopped'); }, 6000);
    }, function (e) { Log.e('mic', 'FAIL ' + (e && (e.name || e.message))); });
  }

  document.addEventListener('keydown', function (e) {
    switch (e.key) {
      case '1': tone('content'); break;
      case '2': tone('telephony'); break;
      case '3': toggleSpeaker(); break;
      case '4': dump(); break;
      case '5': micLoop(); break;
      case '0': Log.flush(); Log.i('log', 'flushed'); break;
      default: break;
    }
  });
  Log.i('help', 'keys: 1 content tone | 2 telephony tone | 3 toggle speaker | 4 dump | 5 mic loop | 0 flush');
  dump();
  setTimeout(function () { Log.flush(); }, 4000);
}());
