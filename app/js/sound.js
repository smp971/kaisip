/* Ringtone, ringback tone, remote audio playback, vibration. Content audio channel only. ES5. */
var Sound = (function () {
  'use strict';
  var ring = null, ringback = null, remote = null, vibTimer = null;

  /* Build a WAV (8 kHz, 16-bit mono) from segments [{hz1, hz2, ms}] where hz=0 means silence. */
  function wavUrl(segments) {
    var rate = 8000, total = 0, i;
    for (i = 0; i < segments.length; i++) { total += Math.round(rate * segments[i].ms / 1000); }
    var buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
    function s(o, str) { for (var j = 0; j < str.length; j++) { v.setUint8(o + j, str.charCodeAt(j)); } }
    s(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, total * 2, true);
    var pos = 44, n, k, x, seg;
    for (i = 0; i < segments.length; i++) {
      seg = segments[i];
      n = Math.round(rate * seg.ms / 1000);
      for (k = 0; k < n; k++) {
        x = 0;
        if (seg.hz1) {
          x = Math.sin(2 * Math.PI * seg.hz1 * k / rate);
          if (seg.hz2) { x = (x + Math.sin(2 * Math.PI * seg.hz2 * k / rate)) / 2; }
          x *= 9000;
        }
        v.setInt16(pos, Math.round(x), true);
        pos += 2;
      }
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function loopAudio(url, volume, channel) {
    var a = new Audio(url);
    try { a.mozAudioChannelType = channel || 'content'; } catch (e) {}
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, volume));
    var p = a.play();
    if (p && p.then) { p.then(null, function (err) { Log.w('sound', 'play rejected: ' + err); }); }
    return a;
  }

  function stopAudio(a) {
    if (!a) { return; }
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {}
  }

  function stopVibration() {
    if (vibTimer !== null) { clearInterval(vibTimer); vibTimer = null; }
    try { if (navigator.vibrate) { navigator.vibrate(0); } } catch (e) {}
  }

  return {
    /* UK-style double ring, 2 s on, 4 s off */
    startRingtone: function (volumePercent) {
      this.stopRingtone();
      var url = wavUrl([
        { hz1: 400, hz2: 450, ms: 400 }, { ms: 200 }, { hz1: 400, hz2: 450, ms: 400 }, { ms: 200 },
        { hz1: 400, hz2: 450, ms: 400 }, { ms: 3000 }
      ]);
      ring = loopAudio(url, (volumePercent === undefined ? 100 : volumePercent) / 100);
      try {
        if (navigator.vibrate) {
          navigator.vibrate([400, 200, 400]);
          vibTimer = setInterval(function () { navigator.vibrate([400, 200, 400]); }, 4200);
        }
      } catch (e) { Log.w('sound', 'vibrate failed: ' + e); }
    },
    stopRingtone: function () { stopAudio(ring); ring = null; stopVibration(); },

    /* 425 Hz, 1 s on, 4 s off */
    startRingback: function () {
      this.stopRingback();
      /* in the earpiece when routing is available, so it matches where the call audio will come out */
      ringback = loopAudio(wavUrl([{ hz1: 425, ms: 1000 }, { ms: 4000 }]), 0.6, Route.channel());
    },
    stopRingback: function () { stopAudio(ringback); ringback = null; },

    playRemote: function (stream) {
      this.stopRemote();
      try {
        remote = new Audio();
        try { remote.mozAudioChannelType = Route.channel(); } catch (e) {}
        if ('mozSrcObject' in remote) { remote.mozSrcObject = stream; } else { remote.srcObject = stream; }
        var p = remote.play();
        if (p && p.then) { p.then(null, function (err) { Log.w('sound', 'remote play rejected: ' + err); }); }
        Log.i('sound', 'remote audio playing');
      } catch (e2) { Log.e('sound', 'remote audio failed: ' + e2); }
    },
    stopRemote: function () { stopAudio(remote); remote = null; },

    stopAll: function () { this.stopRingtone(); this.stopRingback(); this.stopRemote(); }
  };
}());
