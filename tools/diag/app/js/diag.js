/* KaiSIP Diag: guided audio routing / volume diagnostics for certified KaiOS 2.5 apps.
   Up/Down choose, Enter starts. After each tone answer with the softkeys. Results go to sip-logs/ as RESULT lines. ES5. */
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
  function setChannel(a, ch) { try { a.mozAudioChannelType = ch; } catch (e) {} return a.mozAudioChannelType; }

  /* every source: start(done) plays for ~secs seconds, then calls done(); returns nothing */
  var SOURCES = {
    fileTelephony: function (secs, done, opts) {
      var a = new Audio(toneUrl(secs, 1000));
      setChannel(a, 'telephony');
      if (opts && opts.volume !== undefined) { a.volume = opts.volume; }
      a.onended = function () { done(); };
      a.play();
    },
    fileContent: function (secs, done) {
      var a = new Audio(toneUrl(secs, 1000));
      setChannel(a, 'content');
      a.onended = function () { done(); };
      a.play();
    },
    streamElement: function (secs, done, opts) {     /* like a WebRTC remote stream played through <audio mozSrcObject> */
      var ctx = new AC(), osc = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 800; osc.connect(dest); osc.start();
      var a = new Audio();
      setChannel(a, (opts && opts.channel) || 'telephony');
      if ('mozSrcObject' in a) { a.mozSrcObject = dest.stream; } else { a.srcObject = dest.stream; }
      a.play();
      setTimeout(function () { try { osc.stop(); a.pause(); ctx.close(); } catch (e) {} done(); }, secs * 1000);
    },
    streamWebAudio: function (secs, done) {          /* MediaStream -> AudioContext('telephony') */
      var src = new AC(), osc = src.createOscillator(), dest = src.createMediaStreamDestination();
      osc.frequency.value = 700; osc.connect(dest); osc.start();
      var out; try { out = new AC('telephony'); } catch (e) { Log.w('diag', 'AudioContext(channel) failed: ' + e); out = new AC(); }
      out.createMediaStreamSource(dest.stream).connect(out.destination);
      setTimeout(function () { try { osc.stop(); src.close(); out.close(); } catch (e2) {} done(); }, secs * 1000);
    },
    oscWebAudio: function (secs, done) {             /* oscillator straight into AudioContext('telephony') */
      var out; try { out = new AC('telephony'); } catch (e) { out = new AC(); }
      var osc = out.createOscillator(); osc.frequency.value = 600; osc.connect(out.destination); osc.start();
      setTimeout(function () { try { osc.stop(); out.close(); } catch (e2) {} done(); }, secs * 1000);
    },
    micWebAudio: function (secs, done) {             /* microphone -> AudioContext('telephony') */
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var out; try { out = new AC('telephony'); } catch (e) { out = new AC(); }
        out.createMediaStreamSource(stream).connect(out.destination);
        setTimeout(function () { stream.getTracks().forEach(function (t) { t.stop(); }); try { out.close(); } catch (e2) {} done(); }, secs * 1000);
      }, function (e) { Log.e('diag', 'mic failed ' + (e && e.name)); done(); });
    }
  };

  /* ---------- tests ---------- */
  /* kind 'route': ask Ureche/Difuzor/Nimic, expected is 'ear' or 'speaker'.   kind 'yesno': ask Da/Nu, expected 'yes' */
  var TESTS = [
    { id: 'file_ear', title: 'Ton din fișier, ureche', how: 'Ține telefonul la ureche.', speaker: false, secs: 4, src: 'fileTelephony', kind: 'route', expect: 'ear' },
    { id: 'file_spk', title: 'Ton din fișier, difuzor', how: 'Ține telefonul la ureche.', speaker: true, secs: 4, src: 'fileTelephony', kind: 'route', expect: 'speaker' },
    { id: 'stream_el_ear', title: 'Flux (ca apelul) în <audio>, ureche', how: 'Ține la ureche. Așa redă KaiSIP acum apelul.', speaker: false, secs: 4, src: 'streamElement', kind: 'route', expect: 'ear' },
    { id: 'stream_wa_ear', title: 'Flux prin Web Audio, ureche', how: 'Ține la ureche. Varianta nouă pentru apel.', speaker: false, secs: 4, src: 'streamWebAudio', kind: 'route', expect: 'ear' },
    { id: 'stream_wa_spk', title: 'Flux prin Web Audio, difuzor', how: 'Ține la ureche.', speaker: true, secs: 4, src: 'streamWebAudio', kind: 'route', expect: 'speaker' },
    { id: 'osc_wa_ear', title: 'Oscilator Web Audio, ureche', how: 'Ține la ureche.', speaker: false, secs: 4, src: 'oscWebAudio', kind: 'route', expect: 'ear' },
    { id: 'stream_content', title: 'Flux pe canalul „content” (referință)', how: 'Ține la ureche. Ne așteptăm la difuzor.', speaker: false, secs: 4, src: 'streamElement', opts: { channel: 'content' }, kind: 'route', expect: 'speaker' },
    { id: 'mic_wa_ear', title: 'Microfon prin Web Audio, ureche', how: 'Vorbește în timpul testului (6 s). Ține la ureche.', speaker: false, secs: 6, src: 'micWebAudio', kind: 'route', expect: 'ear' },
    { id: 'vol_keys', title: 'Taste de volum (lateral)', how: 'Apasă volum + și − de pe lateral CÂT SUNĂ tonul (10 s).', speaker: true, secs: 10, src: 'fileTelephony', before: function () { try { navigator.mozAudioChannelManager.volumeControlChannel = 'telephony'; Log.i('diag', 'volumeControlChannel=telephony'); } catch (e) { Log.e('diag', 'vcc ' + e); } }, kind: 'yesno', question: 'Volumul s-a schimbat?' },
    { id: 'vol_setting', title: 'Volum prin setările sistemului', how: 'Aplicația schimbă volumul „telephony” cu 4 trepte; compară cu tonul anterior.', speaker: true, secs: 4, src: 'fileTelephony', before: 'setvol', kind: 'yesno', question: 'Tonul s-a auzit diferit (mai tare/încet)?' },
    { id: 'vol_element', title: 'Volum în aplicație', how: 'Un ton la 100%, apoi unul la 20%.', speaker: true, secs: 3, src: 'fileTelephony', twice: true, kind: 'yesno', question: 'Al doilea a fost mai încet?' }
  ];

  var results = {};          /* id -> { heard, ok } */
  var queue = [];            /* indexes still to run in a guided run */
  var state = 'menu', sel = 0, cur = null, running = false, topTimer = null;

  function refreshTop() {
    var sp = speakerState();
    $('top').textContent = 'Difuzor: ' + (sp === null ? 'n/a' : (sp ? 'DA' : 'NU')) + '  ·  Căști: ' + (headphones() ? 'da' : 'nu');
  }

  /* ---------- screens ---------- */
  function renderMenu() {
    state = 'menu';
    var el = $('body'); clear(el);
    var h = document.createElement('h1'); h.textContent = 'KaiSIP Diag'; el.appendChild(h);
    var items = ['▶ Rulează TOATE testele (ghidat)'].concat(TESTS.map(function (t, i) {
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
    softkeys('', '', '');
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

  function startTest(t, idx, total) {
    cur = { t: t, idx: idx, total: total };
    renderPrompt(t, idx, total);
  }

  function runCurrent() {
    var t = cur.t;
    if (running) { return; }
    running = true;
    if (t.speaker !== undefined && t.speaker !== null) { setSpeaker(t.speaker); }
    refreshTop();
    renderRunning(t);
    function play() {
      var src = SOURCES[t.src];
      Log.i('diag', 'RUN ' + t.id + ' speaker=' + speakerState() + ' headphones=' + headphones());
      try {
        src(t.secs, function () {
          if (t.twice) {
            SOURCES[t.src](t.secs, function () { running = false; renderAsk(t); }, { volume: 0.2 });
          } else { running = false; renderAsk(t); }
        }, t.opts);
      } catch (e) { Log.e('diag', t.id + ' EXC ' + e); running = false; renderAsk(t); }
    }
    if (typeof t.before === 'function') { t.before(); play(); }
    else if (t.before === 'setvol') { applySetvol(play); }
    else { play(); }
  }

  function answer(kind) {      /* kind: ear | speaker | none | yes | no */
    var t = cur.t;
    var expect = t.kind === 'route' ? t.expect : 'yes';
    var ok = (kind === expect);
    results[t.id] = { heard: kind, ok: ok };
    Log.i('RESULT', t.id + ' speaker=' + speakerState() + ' heard=' + kind + ' expected=' + expect + ' ' + (ok ? 'OK' : 'DIFF'));
    nextInQueue();
  }

  function nextInQueue() {
    if (queue.length) {
      var i = queue.shift();
      startTest(TESTS[i], (cur.total - queue.length), cur.total);
    } else {
      renderSummary();
      Log.flush();
    }
  }

  function startGuidedRun() {
    queue = TESTS.map(function (t, i) { return i; });
    var total = queue.length;
    var i = queue.shift();
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
      else if (k === 'SoftRight') { e.preventDefault(); nextInQueue(); if (!queue.length && state === 'prompt') { renderMenu(); } }
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

  Log.i('diag', 'KaiSIP Diag 0.1.0 ' + navigator.userAgent);
  Log.i('diag', 'mozTelephony=' + (tel ? 'yes' : 'no') + ' mozSettings=' + (navigator.mozSettings ? 'yes' : 'no') +
    ' speakerEnabled=' + speakerState() + ' headphones=' + headphones());
  refreshTop();
  topTimer = setInterval(refreshTop, 1500);
  renderMenu();
  setTimeout(function () { Log.flush(); }, 4000);
}());
