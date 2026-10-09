/* Settings kept in localStorage. The password is entered on the phone and never logged. ES5. */
var Config = (function () {
  'use strict';
  var KEY = 'kaisip.config';
  var defaults = {
    wssUrl: 'wss://pbx.example.com/ws',
    domain: 'pbx.example.com',
    extension: '',
    password: '',
    stun: 'stun:stun.l.google.com:19302',
    background: 'off',
    ringVolume: 100
  };
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
        return (val === 'on' || val === 'off') ? '' : 'Mod invalid';
      case 'ringVolume':
        return (/^\d{1,3}$/.test(val) && Number(val) <= 100) ? '' : 'Volum 0-100';
      default:
        return 'Câmp necunoscut';
    }
  }

  return {
    defaults: defaults,
    validate: validate,
    get: function () {
      if (!cache) { cache = load(); }
      return cache;
    },
    set: function (key, val) {
      var err = validate(key, val);
      if (err) { return err; }
      var cfg = this.get();
      cfg[key] = (key === 'ringVolume') ? Number(val) : String(val);
      return save() ? '' : 'Nu s-a putut salva';
    },
    isComplete: function () {
      var c = this.get();
      return !!(c.wssUrl && c.domain && c.extension && c.password);
    },
    _reset: function () { cache = null; }
  };
}());
