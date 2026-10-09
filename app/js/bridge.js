/* Plays a MediaStream (the remote side of a call) through an AudioContext on the 'telephony' channel.
   Why: on Gecko 48 / KaiOS 2.5 an <audio> element playing a MediaStream is not routed to the earpiece on every phone,
   and AudioContext('telephony') refuses createMediaStreamSource. So a normal context reads the stream, hands the samples
   to a queue, and a second 'telephony' context plays them (verified on the 6300: earpiece and speaker both switch).
   The player also applies a gain, giving real volume control (including > 100%). ES5. */
var Bridge = (function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  var MAX_QUEUE = 4096;          /* samples (~85 ms at 48 kHz): beyond this the oldest audio is dropped to keep latency low */
  var active = null;

  function start(stream, gain) {
    stop();
    if (!AC) { throw new Error('no AudioContext'); }
    var st = { gain: gain === undefined ? 1 : gain, queue: [], queued: 0, drops: 0, underruns: 0, blocks: 0 };

    var inCtx = new AC();
    var src = inCtx.createMediaStreamSource(stream);
    var cap = inCtx.createScriptProcessor(1024, 1, 1);
    cap.onaudioprocess = function (e) {
      var d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d.length), i;
      for (i = 0; i < d.length; i++) { copy[i] = d[i]; }
      st.queue.push(copy);
      st.queued += copy.length;
      while (st.queued > MAX_QUEUE) { st.queued -= st.queue.shift().length; st.drops++; }
    };
    var mute = inCtx.createGain();
    mute.gain.value = 0;                      /* keep the processor running without playing on the normal channel */
    src.connect(cap); cap.connect(mute); mute.connect(inCtx.destination);

    var out;
    try { out = new AC('telephony'); } catch (e2) { Log.w('bridge', 'telephony context failed: ' + e2); out = new AC(); }
    var play = out.createScriptProcessor(1024, 1, 1), cur = null, pos = 0;
    play.onaudioprocess = function (e) {
      var o = e.outputBuffer.getChannelData(0), i = 0, v;
      st.blocks++;
      while (i < o.length) {
        if (!cur || pos >= cur.length) {
          cur = st.queue.shift() || null;
          pos = 0;
          if (cur) { st.queued -= cur.length; }
        }
        if (cur) {
          v = cur[pos++] * st.gain;
          o[i++] = v > 1 ? 1 : (v < -1 ? -1 : v);
        } else {
          o[i++] = 0;
          st.underruns++;
        }
      }
    };
    var level = out.createGain();
    level.gain.value = 1;
    play.connect(level); level.connect(out.destination);
    /* a ScriptProcessor only runs while it has an input: feed it silence */
    var dummy = out.createOscillator();
    dummy.frequency.value = 20;
    var dg = out.createGain();
    dg.gain.value = 0;
    dummy.connect(dg); dg.connect(play);
    dummy.start();

    active = { st: st, inCtx: inCtx, out: out, cap: cap, play: play, dummy: dummy, src: src };
    Log.i('bridge', 'started rates in=' + inCtx.sampleRate + ' out=' + out.sampleRate + ' gain=' + st.gain);
  }

  function stop() {
    if (!active) { return; }
    var a = active;
    active = null;
    try { a.dummy.stop(); } catch (e) {}
    try { a.cap.disconnect(); } catch (e1) {}
    try { a.play.disconnect(); } catch (e2) {}
    try { a.inCtx.close(); } catch (e3) {}
    try { a.out.close(); } catch (e4) {}
    Log.i('bridge', 'stopped blocks=' + a.st.blocks + ' underruns=' + a.st.underruns + ' dropped=' + a.st.drops);
  }

  return {
    start: start,
    stop: stop,
    active: function () { return !!active; },
    setGain: function (g) { if (active) { active.st.gain = g; } },
    stats: function () { return active ? { underruns: active.st.underruns, drops: active.st.drops, queued: active.st.queued } : null; }
  };
}());
