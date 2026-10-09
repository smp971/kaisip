/* Throwaway feasibility spike. ES5 only. Results go to screen and console ("SPIKE:" prefix). */
var WSS_URL = 'wss://pbx.example.com/ws';
var HTTPS_URL = 'https://pbx.example.com/';
var out = document.getElementById('out');

var runId = String(Date.now()).slice(-6);
var flushN = 0, buf = '';
function flush() {
  try {
    var ds = navigator.getDeviceStorage('sdcard');
    flushN++;
    var req = ds.addNamed(new Blob([buf], { type: 'text/plain' }), 'spike-' + runId + '-' + ('0' + flushN).slice(-2) + '.txt');
    req.onerror = function () { out.textContent += '(flush err ' + (req.error && req.error.name) + ')\n'; };
  } catch (e) { out.textContent += '(flush exc ' + e + ')\n'; }
}
function log(msg) {
  var line = '[' + new Date().toISOString().substr(11, 8) + '] ' + msg;
  buf += line + '\n';
  out.textContent += line + '\n';
  window.scrollTo(0, document.body.scrollHeight);
  if (/tests done|beat|MIC:|SDP|ICE|XHR|WSS|WAKE|PC/.test(msg)) { flush(); }
}

function t(name, fn) {
  try { log(name + ': ' + fn()); } catch (e) { log(name + ': EXC ' + e); }
}

log('UA: ' + navigator.userAgent);

/* 1. feature detection */
t('RTCPeerConnection', function () { return typeof RTCPeerConnection + ' / moz=' + typeof window.mozRTCPeerConnection; });
t('getUserMedia', function () { return 'nav.gUM=' + typeof navigator.getUserMedia + ' moz=' + typeof navigator.mozGetUserMedia + ' mediaDevices=' + typeof navigator.mediaDevices; });
t('WebSocket', function () { return typeof WebSocket; });
t('Promise', function () { return typeof Promise; });
t('Map/Symbol', function () { return typeof Map + '/' + typeof Symbol; });
t('fetch', function () { return typeof fetch; });
t('requestWakeLock', function () { return 'moz=' + typeof navigator.requestWakeLock + ' wakeLock=' + typeof navigator.wakeLock; });
t('mozAlarms', function () { return typeof navigator.mozAlarms; });
t('mozTCPSocket', function () { return typeof navigator.mozTCPSocket + ' / TCPSocket=' + typeof window.TCPSocket; });
t('UDPSocket', function () { return typeof window.UDPSocket; });
t('mozAudioChannelManager', function () { return typeof navigator.mozAudioChannelManager; });
t('crypto.subtle', function () { return typeof (window.crypto && window.crypto.subtle); });

/* 2. microphone */
function testMic(done) {
  var gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ?
    function (c) { return navigator.mediaDevices.getUserMedia(c); } :
    function (c) {
      return new Promise(function (res, rej) {
        var f = navigator.mozGetUserMedia || navigator.getUserMedia;
        if (!f) { return rej(new Error('no getUserMedia')); }
        f.call(navigator, c, res, rej);
      });
    };
  gum({ audio: true }).then(function (stream) {
    log('MIC: OK tracks=' + stream.getAudioTracks().length);
    window.__stream = stream;
    done(stream);
  }, function (err) {
    log('MIC: FAIL ' + (err && (err.name || err.message || err)));
    done(null);
  });
}

/* 3. peer connection / SDP / ICE */
function testPC(stream, done) {
  var PC = window.RTCPeerConnection || window.mozRTCPeerConnection;
  if (!PC) { log('PC: none'); return done(); }
  var pc;
  try { pc = new PC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); }
  catch (e) { log('PC ctor EXC ' + e); return done(); }
  var cands = 0, types = {};
  pc.onicecandidate = function (e) {
    if (e.candidate) {
      cands++;
      var m = / typ (\w+)/.exec(e.candidate.candidate);
      if (m) { types[m[1]] = (types[m[1]] || 0) + 1; }
    }
  };
  if (stream) { try { pc.addStream(stream); } catch (e) { log('addStream EXC ' + e); } }
  var p = pc.createOffer({ offerToReceiveAudio: true });
  p.then(function (offer) {
    var sdp = offer.sdp;
    log('SDP codecs: ' + (sdp.match(/a=rtpmap:\d+ [\w-]+\/\d+/g) || []).join(' | ').substr(0, 220));
    log('SDP dtls=' + /a=fingerprint/.test(sdp) + ' rtcpmux=' + /a=rtcp-mux/.test(sdp) + ' ice=' + /a=ice-ufrag/.test(sdp));
    return pc.setLocalDescription(offer);
  }).then(function () {
    setTimeout(function () {
      log('ICE candidates: ' + cands + ' ' + JSON.stringify(types) + ' state=' + pc.iceGatheringState);
      try { pc.close(); } catch (e) {}
      done();
    }, 6000);
  }, function (err) {
    log('createOffer FAIL ' + err);
    done();
  });
}

/* 4. TLS + WebSocket to the PBX */
function testXHR(done) {
  try {
    var x = new XMLHttpRequest({ mozSystem: true, mozAnon: true });
    x.open('GET', HTTPS_URL, true);
    x.timeout = 10000;
    x.onload = function () { log('XHR https: status ' + x.status + ' url=' + x.responseURL); done(); };
    x.onerror = function () { log('XHR https: ERROR (cert/network) status=' + x.status); done(); };
    x.ontimeout = function () { log('XHR https: TIMEOUT'); done(); };
    x.send();
  } catch (e) { log('XHR EXC ' + e); done(); }
}

function testWS(done) {
  var ws, finished = false;
  function end(why) { if (finished) { return; } finished = true; log('WSS: ' + why); try { ws.close(); } catch (e) {} done(); }
  try { ws = new WebSocket(WSS_URL, 'sip'); }
  catch (e) { return end('ctor EXC ' + e); }
  ws.onopen = function () { end('OPEN protocol=' + ws.protocol); };
  ws.onerror = function () { log('WSS: onerror'); };
  ws.onclose = function (ev) { end('CLOSE code=' + ev.code + ' reason=' + ev.reason); };
  setTimeout(function () { end('TIMEOUT 12s'); }, 12000);
}

/* 5. wake lock + heartbeat to see if timers survive screen off */
function testWake() {
  var lock = null;
  try {
    if (navigator.requestWakeLock) {
      lock = navigator.requestWakeLock('cpu');
      log('WAKE cpu: acquired topic=' + lock.topic);
    } else { log('WAKE: no requestWakeLock'); }
  } catch (e) { log('WAKE EXC ' + e); }
  /* keep one WebSocket open the whole time and watch its state */
  var ws = null, wsEvents = 0;
  function openWs() {
    try {
      ws = new WebSocket(WSS_URL, 'sip');
      ws.onopen = function () { wsEvents++; log('WS reopened/open'); };
      ws.onclose = function (ev) { wsEvents++; log('WS CLOSED code=' + ev.code); };
      ws.onmessage = function () { wsEvents++; };
    } catch (e) { log('WS EXC ' + e); }
  }
  openWs();

  var phase = 'A', silent = null, n = 0, last = Date.now(), t0 = Date.now();
  function startSilentAudio() {
    try {
      var rate = 8000, len = rate; /* 1 s of silence, 16-bit mono */
      var buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
      function s(o, str) { for (var i = 0; i < str.length; i++) { v.setUint8(o + i, str.charCodeAt(i)); } }
      s(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
      v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, len * 2, true);
      silent = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      silent.mozAudioChannelType = 'content';
      silent.loop = true;
      silent.play();
      log('PHASE B: silent audio started');
    } catch (e) { log('silent audio EXC ' + e); }
  }
  setInterval(function () {
    n++;
    var now = Date.now();
    var el = Math.round((now - t0) / 1000);
    if (phase === 'A' && el >= 180) { phase = 'B'; startSilentAudio(); }
    log('beat ' + n + ' ph=' + phase + ' t=' + el + 's dt=' + Math.round((now - last) / 1000) + 's ws=' + (ws ? ws.readyState : '-') + ' ev=' + wsEvents);
    last = now;
  }, 10000);
}

testMic(function (stream) {
  testPC(stream, function () {
    testXHR(function () {
      testWS(function () {
        log('--- tests done, wake/heartbeat running ---');
        testWake();
      });
    });
  });
});

