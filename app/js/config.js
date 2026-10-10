/* Settings kept in localStorage. The password is entered on the phone and never logged. ES5. */
var Config = (function () {
  'use strict';
  var KEY = 'kaisip.config';
  var defaults = {
    wssUrl: '',               /* filled in on the Account screen, e.g. wss://pbx.example.com/ws */
    domain: '',               /* SIP domain; defaults to the server host */
    extension: '',
    password: '',
    stun: 'stun:stun.l.google.com:19302',
    background: 'off',
    ringVolume: 100,
    audioOut: 'ear',         /* default call output: 'ear' (earpiece) | 'speaker' */
    ecoMinutes: 15,          /* Economic background mode: minutes between connection checks (alarm) */
    pttChannel: '',          /* number dialled for push-to-talk (a Page() group on the PBX); empty = PTT off */
    pttMembers: '',          /* extensions whose PTT calls this phone answers automatically, e.g. "206,207" */
    msgSync: 'on',           /* ask the PBX for messages stored while this phone was offline */
    msgBox: '*98',           /* the PBX service number that answers "SYNC" with the stored messages */
    vmBox: '*97'             /* the number that opens the voicemail menu (Asterisk VoiceMailMain) */
  };

  /* any run of non-digits becomes one comma: "206; 207 ,208" -> "206,207,208" */
  function normalizeList(val) {
    return String(val === undefined || val === null ? '' : val).replace(/[^0-9]+/g, ',').replace(/^,+|,+$/g, '');
  }
  var cache = null;

  function load() {
    var stored = {};
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { stored = JSON.parse(raw) || {}; }
    } catch (e) { stored = {}; }
    var cfg = {}, k;
    for (k in defaults) {
      if (defaults.hasOwnProperty(k)) { cfg[k] = stored.hasOwnProperty(k) ? stored[k] : defaults[k]; }
    }
    return cfg;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); return true; }
    catch (e) { return false; }
  }

  /* returns '' when valid, otherwise a short message */
  function validate(key, val) {
    val = String(val === undefined || val === null ? '' : val);
    switch (key) {
      case 'wssUrl':
        return /^wss:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?(\/[A-Za-z0-9._\/\-]*)?$/.test(val) ? '' : 'Adresa trebuie să fie wss://gazdă/cale';
      case 'domain':
        return /^[A-Za-z0-9.\-]{1,100}$/.test(val) ? '' : 'Domeniu invalid';
      case 'extension':
        return /^[A-Za-z0-9_.@+\-]{1,64}$/.test(val) ? '' : 'Extensie invalidă';
      case 'password':
        return (val.length >= 1 && val.length <= 128 && !/[\x00-\x1f]/.test(val)) ? '' : 'Parolă invalidă';
      case 'stun':
        return (val === '' || /^stuns?:[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(val)) ? '' : 'STUN: stun:gazdă:port';
      case 'background':
        return (val === 'on' || val === 'off' || val === 'low') ? '' : 'Mod invalid';
      case 'ringVolume':
        return (/^\d{1,3}$/.test(val) && Number(val) <= 100) ? '' : 'Volum 0-100';
      case 'audioOut':
        return (val === 'ear' || val === 'speaker') ? '' : 'Ieșire invalidă';
      case 'ecoMinutes':
        return (/^\d{1,2}$/.test(val) && Number(val) >= 1 && Number(val) <= 60) ? '' : 'Minute 1-60';
      case 'msgSync':
        return (val === 'on' || val === 'off') ? '' : 'Valoare invalidă';
      case 'msgBox':
      case 'vmBox':
        return /^[0-9*#+]{1,12}$/.test(val) ? '' : 'Doar cifre, * # +';
      case 'pttChannel':
        return (val === '' || /^\d{1,10}$/.test(val)) ? '' : 'Doar cifre (max 10)';
      case 'pttMembers': {
        var list = normalizeList(val);
        return (list === '' || (/^\d{1,10}(,\d{1,10})*$/.test(list) && list.split(',').length <= 20)) ? '' : 'Numere separate prin virgulă';
      }
      default:
        return 'Câmp necunoscut';
    }
  }

  /* "pbx.example.com", "pbx.example.com:8089/sip" or a full wss:// URL -> { wssUrl, domain } or { error } */
  function normalizeServer(input) {
    var s = String(input === undefined || input === null ? '' : input).replace(/^\s+|\s+$/g, '');
    if (!s) { return { error: 'Completează serverul' }; }
    if (/^wss:\/\//i.test(s)) { s = s.replace(/^wss:\/\//i, ''); }
    else if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(s)) { return { error: 'Folosește wss:// (securizat)' }; }
    var slash = s.indexOf('/');
    var hostPort = slash < 0 ? s : s.slice(0, slash);
    var path = slash < 0 ? '/ws' : s.slice(slash);
    var url = 'wss://' + hostPort + path;
    var err = validate('wssUrl', url);
    if (err) { return { error: err }; }
    return { wssUrl: url, domain: hostPort.replace(/:\d+$/, '') };
  }

  return {
    defaults: defaults,
    validate: validate,
    normalizeServer: normalizeServer,
    normalizeList: normalizeList,
    get: function () {
      if (!cache) { cache = load(); }
      return cache;
    },
    set: function (key, val) {
      var err = validate(key, val);
      if (err) { return err; }
      var cfg = this.get();
      cfg[key] = (key === 'ringVolume' || key === 'ecoMinutes') ? Number(val)
        : (key === 'pttMembers' ? normalizeList(val) : String(val));
      return save() ? '' : 'Nu s-a putut salva';
    },
    isComplete: function () {
      var c = this.get();
      return !!(c.wssUrl && c.domain && c.extension && c.password);
    },
    _reset: function () { cache = null; }
  };
}());
