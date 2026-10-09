/* KaiSIP Diag: guided audio routing / volume diagnostics for certified KaiOS 2.5 apps.
   Up/Down choose, Enter starts. After each tone answer with the softkeys. Results go to sip-logs/ as RESULT lines.
   Every test has a watchdog: it can never leave the screen stuck on "Ascultă". ES5. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function div(cls, text) { var d = document.createElement('div'); if (cls) { d.className = cls; } if (text !== undefined) { d.textContent = text; } return d; }
  function softkeys(l, c, r) { $('l').textContent = l || ''; $('c').textContent = c || ''; $('r').textContent = r || ''; }

  var AC = window.AudioContext || window.webkitAudioContext;
  var tel = null;
  try { tel = navigator.mozTelephony; } catch (e) { tel = null; }

  function speakerState() { try { return tel ? !!tel.speakerEnabled : null; } catch (e) { return null; } }
  function setSpeaker(on) { try { if (tel) { tel.speakerEnabled = !!on; } } catch (e) { Log.e('diag', 'setSpeaker: ' + e); } }
  function headphones() { try { return !!navigator.mozAudioChannelManager.headphones; } catch (e) { return false; } }
  function setChannel(a, ch) { try { a.mozAudioChannelType = ch; } catch (e) {} return a.mozAudioChannelType; }

  /* ---------- sound sources ---------- */
  function toneUrl(seconds, hz) {
    var rate = 8000, n = rate * seconds;
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, str) { for (var i = 0; i < str.length; i++) { v.setUint8(o + i, str.charCodeAt(i)); } }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) { v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * (hz || 1000) * i / rate) * 12000), true); }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  /* a MediaStream with a tone, like a WebRTC remote stream */
  function toneStream(hz) {
    var ctx = new AC(), osc = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
    osc.frequency.value = hz || 800; osc.connect(dest); osc.start();
    return { ctx: ctx, osc: osc, stream: dest.stream, stop: function () { try { osc.stop(); ctx.close(); } catch (e) {} } };
  }

  /* each source: fn(secs, done, opts); must call done() eventually (the watchdog covers mistakes) */
  var SOURCES = {
    fileTelephony: function (secs, done, opts) {
      var a = new Audio(toneUrl(secs, 1000));
      setChannel(a, 'telephony');
      if (opts && opts.volume !== undefined) { a.volume = opts.volume; }
      a.onended = function () { done(); };
      a.play();
    },
    /* the way KaiSIP plays a call today */
    streamElement: function (secs, done) {
      var t = toneStream(800), a = new Audio();
      Log.i('diag', 'channel effective=' + setChannel(a, 'telephony'));
      if ('mozSrcObject' in a) { a.mozSrcObject = t.stream; } else { a.srcObject = t.stream; }
      a.play();
      setTimeout(function () { try { a.pause(); } catch (e) {} t.stop(); done(); }, secs * 1000);
    },
    /* channel assigned only after playback started */
    streamElementLate: function (secs, done) {
      var t = toneStream(800), a = new Audio();
      if ('mozSrcObject' in a) { a.mozSrcObject = t.stream; } else { a.srcObject = t.stream; }
      a.play();
      setTimeout(function () { Log.i('diag', 'late channel effective=' + setChannel(a, 'telephony')); }, 500);
      setTimeout(function () { try { a.pause(); } catch (e) {} t.stop(); done(); }, secs * 1000);
    },
    /* <audio> with a MediaStream -> Web Audio on the telephony channel */
    elementToTelephonyCtx: function (secs, done) {
      var t = toneStream(750), a = new Audio();
      if ('mozSrcObject' in a) { a.mozSrcObject = t.stream; } else { a.srcObject = t.stream; }
      a.play();
      var out; try { out = new AC('telephony'); } catch (e) { out = new AC(); }
      var node = out.createMediaElementSource(a);
      node.connect(out.destination);
      setTimeout(function () { try { a.pause(); out.close(); } catch (e) {} t.stop(); done(); }, secs * 1000);
    },
    /* bridge: normal context reads the stream, a second 'telephony' context plays the samples */
    bridge: function (secs, done) {
      var t = toneStream(700), inCtx = t.ctx;
      var src = inCtx.createMediaStreamSource(t.stream);
      var cap = inCtx.createScriptProcessor(1024, 1, 1);
      var queue = [], queued = 0;
      cap.onaudioprocess = function (e) {
        var d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d.length), i;
        for (i = 0; i < d.length; i++) { copy[i] = d[i]; }
        queue.push(copy); queued += copy.length;
        while (queued > 16384) { queued -= queue.shift().length; }
      };
      var mute = inCtx.createGain(); mute.gain.value = 0;
      src.connect(cap); cap.connect(mute); mute.connect(inCtx.destination);
      var out; try { out = new AC('telephony'); } catch (e2) { Log.w('diag', 'telephony ctx failed ' + e2); out = new AC(); }
      Log.i('diag', 'bridge sample rates in=' + inCtx.sampleRate + ' out=' + out.sampleRate);
      var play = out.createScriptProcessor(1024, 1, 1), cur = null, pos = 0;
      play.onaudioprocess = function (e) {
        var o = e.outputBuffer.getChannelData(0), i = 0;
        while (i < o.length) {
          if (!cur || pos >= cur.length) { cur = queue.shift() || null; pos = 0; if (cur) { queued -= cur.length; } }
          o[i++] = cur ? cur[pos++] : 0;
        }
      };
      var silent = out.createGain(); silent.gain.value = 1;
      play.connect(silent); silent.connect(out.destination);
      /* ScriptProcessor needs an input connection to run in some builds */
      var dummy = out.createOscillator(); dummy.frequency.value = 20; var dg = out.createGain(); dg.gain.value = 0;
      dummy.connect(dg); dg.connect(play); dummy.start();
      setTimeout(function () { try { dummy.stop(); play.disconnect(); out.close(); cap.disconnect(); } catch (e3) {} t.stop(); done(); }, secs * 1000);
    },
    oscWebAudio: function (secs, done) {
      var out; try { out = new AC('telephony'); } catch (e) { out = new AC(); }
      var osc = out.createOscillator(); osc.frequency.value = 600; osc.connect(out.destination); osc.start();
      setTimeout(function () { try { osc.stop(); out.close(); } catch (e2) {} done(); }, secs * 1000);
    },
    /* microphone looped into an <audio> on the telephony channel (what a call does with the remote side) */
    micElement: function (secs, done) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var a = new Audio();
        setChannel(a, 'telephony');
        if ('mozSrcObject' in a) { a.mozSrcObject = stream; } else { a.srcObject = stream; }
        a.play();
        setTimeout(function () { try { a.pause(); } catch (e) {} stream.getTracks().forEach(function (t) { t.stop(); }); done(); }, secs * 1000);
      }, function (e) { Log.e('diag', 'mic denied/failed: ' + (e && (e.name || e.message))); done(); });
    }
  };

  /* ---------- tests ---------- */
  var TESTS = [
    { id: 'bridge_ear', title: 'Pod Web Audio: flux → ureche', how: 'Ține la ureche. Soluția candidată pentru apel.', speaker: false, secs: 5, src: 'bridge', kind: 'route', expect: 'ear' },
    { id: 'bridge_spk', title: 'Pod Web Audio: flux → difuzor', how: 'Ține la ureche. Aceeași soluție, difuzor pornit.', speaker: true, secs: 5, src: 'bridge', kind: 'route', expect: 'speaker' },
    { id: 'el_late_ear', title: '<audio> cu flux, canal setat DUPĂ play', how: 'Ține la ureche.', speaker: false, secs: 5, src: 'streamElementLate', kind: 'route', expect: 'ear' },
    { id: 'el_to_wa_ear', title: '<audio> cu flux → Web Audio telephony', how: 'Ține la ureche.', speaker: false, secs: 5, src: 'elementToTelephonyCtx', kind: 'route', expect: 'ear' },
    { id: 'stream_el_ear', title: 'Flux în <audio> (cum e acum în KaiSIP)', how: 'Ține la ureche. Știm că iese pe difuzor.', speaker: false, secs: 4, src: 'streamElement', kind: 'route', expect: 'ear' },
    { id: 'osc_wa_ear', title: 'Oscilator Web Audio (referință)', how: 'Ține la ureche. Ne așteptăm la ureche.', speaker: false, secs: 4, src: 'oscWebAudio', kind: 'route', expect: 'ear' },
    { id: 'vol_keys', title: 'Taste de volum (lateral)', how: 'Apasă volum + și − de pe lateral CÂT SUNĂ tonul (10 s).', speaker: true, secs: 10, src: 'fileTelephony', before: function () { try { navigator.mozAudioChannelManager.volumeControlChannel = 'telephony'; Log.i('diag', 'volumeControlChannel=telephony'); } catch (e) { Log.e('diag', 'vcc ' + e); } }, kind: 'yesno', question: 'Volumul s-a schimbat?' },
    { id: 'vol_setting', title: 'Volum prin setările sistemului', how: 'Aplicația schimbă volumul „telephony” cu 4 trepte; compară cu tonul anterior.', speaker: true, secs: 4, src: 'fileTelephony', before: 'setvol', kind: 'yesno', question: 'Tonul s-a auzit diferit (mai tare/încet)?' },
    { id: 'vol_element', title: 'Volum în aplicație', how: 'Un ton la 100%, apoi unul la 20%.', speaker: true, secs: 3, src: 'fileTelephony', twice: true, kind: 'yesno', question: 'Al doilea a fost mai încet?' },
    { id: 'mic_el', title: 'Microfon → <audio> telephony', how: 'Vorbește (6 s) cu căști în difuzor/ureche. Doar ca să vedem că nu se blochează.', speaker: false, secs: 6, src: 'micElement', kind: 'route', expect: 'ear' }
  ];

  var results = {};
  var queue = [];
  var state = 'menu', sel = 0, cur = null, running = false;

  function refreshTop() {
    var sp = speakerState();
    $('top').textContent = 'Difuzor: ' + (sp === null ? 'n/a' : (sp ? 'DA' : 'NU')) + '  ·  Căști: ' + (headphones() ? 'da' : 'nu');
  }

  /* ---------- screens ---------- */
  function renderMenu() {
    state = 'menu';
    var el = $('body'); clear(el);
    var h = document.createElement('h1'); h.textContent = 'KaiSIP Diag 0.2'; el.appendChild(h);
    var items = ['▶ Rulează TOATE testele (ghidat)'].concat(TESTS.map(function (t) {
      var r = results[t.id];
      return (r ? (r.ok ? '✓ ' : '✗ ') : '· ') + t.title;
    })).concat(['Rezultate', 'Salvează jurnalul']);
    items.forEach(function (label, i) { el.appendChild(div('item' + (i === sel ? ' sel' : ''), label)); });
    var selected = el.querySelector('.sel'); if (selected && selected.scrollIntoView) { selected.scrollIntoView(false); }
    softkeys('', 'Alege', '');
  }
  function renderPrompt(t, idx, total) {
    state = 'prompt';
    var el = $('body'); clear(el);
    el.appendChild(div('hint', total ? ('Testul ' + idx + ' din ' + total) : 'Test'));
    el.appendChild(div('big', t.title));
    el.appendChild(div('hint', t.how));
    if (t.speaker !== undefined && t.speaker !== null) { el.appendChild(div('hint warn', 'Setez singur: difuzor ' + (t.speaker ? 'PORNIT' : 'OPRIT'))); }
    softkeys('Meniu', 'Pornește', 'Sari');
  }
  function renderRunning(t) {
    state = 'running';
    var el = $('body'); clear(el);
    el.appendChild(div('big', 'Ascultă…'));
    el.appendChild(div('hint', t.title));
    softkeys('', '', 'Oprește');
  }
  function renderAsk(t) {
    state = 'ask';
    var el = $('body'); clear(el);
    el.appendChild(div('big', t.kind === 'route' ? 'De unde a ieșit sunetul?' : t.question));
    if (t.kind === 'route') { el.appendChild(div('hint', 'Stânga = ureche · Centru = difuzor · Dreapta = nimic')); softkeys('Ureche', 'Difuzor', 'Nimic'); }
    else { el.appendChild(div('hint', 'Stânga = da · Dreapta = nu')); softkeys('Da', '', 'Nu'); }
  }
  function renderSummary() {
    state = 'summary';
    var el = $('body'); clear(el);
    var h = document.createElement('h1'); h.textContent = 'Rezultate'; el.appendChild(h);
    var any = false;
    TESTS.forEach(function (t) {
      var r = results[t.id];
      if (!r) { return; }
      any = true;
      el.appendChild(div('row ' + (r.ok ? 'ok' : 'bad'), (r.ok ? '✓ ' : '✗ ') + t.title + ' → ' + r.heard));
    });
    if (!any) { el.appendChild(div('hint', 'Niciun test rulat încă')); }
    softkeys('Meniu', '', 'Salvează');
  }

  /* ---------- running ---------- */
  function applySetvol(done) {
    try {
      var r = navigator.mozSettings.createLock().get('audio.volume.telephony');
      r.onsuccess = function () {
        var cur0 = Number(r.result['audio.volume.telephony']) || 5;
        var next = cur0 >= 7 ? cur0 - 4 : cur0 + 4;
        var o = {}; o['audio.volume.telephony'] = next;
        var w = navigator.mozSettings.createLock().set(o);
        w.onsuccess = function () { Log.i('diag', 'audio.volume.telephony ' + cur0 + ' -> ' + next); done(); };
        w.onerror = function () { Log.e('diag', 'volume write failed'); done(); };
      };
      r.onerror = function () { done(); };
    } catch (e) { Log.e('diag', 'setvol ' + e); done(); }
  }

  function startTest(t, idx, total) { cur = { t: t, idx: idx, total: total }; renderPrompt(t, idx, total); }

  var watchdog = null, finished = false;
  function finishRun(why) {
    if (finished) { return; }
    finished = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    running = false;
    if (why) { Log.w('diag', cur.t.id + ' finished by ' + why); }
    renderAsk(cur.t);
  }

  function runCurrent() {
    var t = cur.t;
    if (running) { return; }
    running = true; finished = false;
    if (t.speaker !== undefined && t.speaker !== null) { setSpeaker(t.speaker); }
    refreshTop();
    renderRunning(t);
    watchdog = setTimeout(function () { finishRun('watchdog'); }, (t.secs * (t.twice ? 2 : 1) + 4) * 1000);
    function play() {
      Log.i('diag', 'RUN ' + t.id + ' speaker=' + speakerState() + ' headphones=' + headphones());
      try {
        SOURCES[t.src](t.secs, function () {
          if (t.twice && !finished) { SOURCES[t.src](t.secs, function () { finishRun(); }, { volume: 0.2 }); }
          else { finishRun(); }
        }, t.opts);
      } catch (e) { Log.e('diag', t.id + ' EXC ' + e); finishRun('exception'); }
    }
    try {
      if (typeof t.before === 'function') { t.before(); play(); }
      else if (t.before === 'setvol') { applySetvol(play); }
      else { play(); }
    } catch (e2) { Log.e('diag', 'start ' + e2); finishRun('start exception'); }
  }

  function answer(kind) {
    var t = cur.t;
    var expect = t.kind === 'route' ? t.expect : 'yes';
    var ok = (kind === expect);
    results[t.id] = { heard: kind, ok: ok };
    Log.i('RESULT', t.id + ' speaker=' + speakerState() + ' heard=' + kind + ' expected=' + expect + ' ' + (ok ? 'OK' : 'DIFF'));
    nextInQueue();
  }
  function nextInQueue() {
    if (queue.length) { var i = queue.shift(); startTest(TESTS[i], (cur.total - queue.length), cur.total); }
    else { renderSummary(); Log.flush(); }
  }
  function startGuidedRun() {
    queue = TESTS.map(function (t, i) { return i; });
    var total = queue.length, i = queue.shift();
    cur = { total: total };
    startTest(TESTS[i], 1, total);
  }

  /* ---------- keys ---------- */
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (state === 'menu') {
      var n = TESTS.length + 3;
      if (k === 'ArrowUp') { e.preventDefault(); sel = (sel + n - 1) % n; renderMenu(); }
      else if (k === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % n; renderMenu(); }
      else if (k === 'Enter') {
        e.preventDefault();
        if (sel === 0) { startGuidedRun(); }
        else if (sel <= TESTS.length) { queue = []; cur = { total: 0 }; startTest(TESTS[sel - 1], 0, 0); }
        else if (sel === TESTS.length + 1) { renderSummary(); }
        else { Log.flush(); Log.i('diag', 'log flushed'); }
      }
    } else if (state === 'prompt') {
      if (k === 'Enter') { e.preventDefault(); runCurrent(); }
      else if (k === 'SoftLeft') { e.preventDefault(); queue = []; renderMenu(); }
      else if (k === 'SoftRight') { e.preventDefault(); if (queue.length) { nextInQueue(); } else { renderMenu(); } }
    } else if (state === 'running') {
      if (k === 'SoftRight') { e.preventDefault(); finishRun('user stop'); }
    } else if (state === 'ask') {
      if (cur.t.kind === 'route') {
        if (k === 'SoftLeft') { e.preventDefault(); answer('ear'); }
        else if (k === 'Enter') { e.preventDefault(); answer('speaker'); }
        else if (k === 'SoftRight') { e.preventDefault(); answer('none'); }
      } else {
        if (k === 'SoftLeft') { e.preventDefault(); answer('yes'); }
        else if (k === 'SoftRight') { e.preventDefault(); answer('no'); }
      }
    } else if (state === 'summary') {
      if (k === 'SoftLeft') { e.preventDefault(); renderMenu(); }
      else if (k === 'SoftRight') { e.preventDefault(); Log.flush(); Log.i('diag', 'log flushed'); }
    }
  });

  Log.i('diag', 'KaiSIP Diag 0.2.0 ' + navigator.userAgent);
  Log.i('diag', 'mozTelephony=' + (tel ? 'yes' : 'no') + ' mozSettings=' + (navigator.mozSettings ? 'yes' : 'no') +
    ' speakerEnabled=' + speakerState() + ' headphones=' + headphones());
  refreshTop();
  setInterval(refreshTop, 1500);
  renderMenu();
  setTimeout(function () { Log.flush(); }, 4000);
}());
