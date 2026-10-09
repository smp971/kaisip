/* KaiSIP's own contacts (name + number), kept in localStorage. ES5. */
var Contacts = (function () {
  'use strict';
  var KEY = 'kaisip.contacts';
  var MAX_NAME = 40, MAX_NUMBER = 24, MAX_CONTACTS = 200;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(list) !== '[object Array]') { return []; }
      return list.filter(function (c) { return c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.number === 'string'; });
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function trim(s) { return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function byName(a, b) {
    var x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  function newId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* returns '' when valid; skipId lets an edit keep its own number */
  function validate(name, number, skipId) {
    name = trim(name);
    var num = Util.filterNumber(number);
    if (!name) { return 'Scrie un nume'; }
    if (name.length > MAX_NAME) { return 'Nume prea lung'; }
    if (!num) { return 'Număr invalid'; }
    if (num.length > MAX_NUMBER) { return 'Număr prea lung'; }
    var i, list = load();
    for (i = 0; i < list.length; i++) {
      if (list[i].number === num && list[i].id !== skipId) { return 'Există deja: ' + list[i].name; }
    }
    return '';
  }

  return {
    maxName: MAX_NAME,
    list: function () { return load().sort(byName); },
    count: function () { return load().length; },
    get: function (id) {
      var i, list = load();
      for (i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
      return null;
    },
    validate: validate,
    /* returns { error } or { id } */
    add: function (name, number) {
      var err = validate(name, number);
      if (err) { return { error: err }; }
      var list = load();
      if (list.length >= MAX_CONTACTS) { return { error: 'Prea multe contacte' }; }
      var c = { id: newId(), name: trim(name), number: Util.filterNumber(number) };
      list.push(c);
      return save(list) ? { id: c.id } : { error: 'Nu s-a putut salva' };
    },
    update: function (id, name, number) {
      var err = validate(name, number, id);
      if (err) { return { error: err }; }
      var i, list = load();
      for (i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i].name = trim(name);
          list[i].number = Util.filterNumber(number);
          return save(list) ? { id: id } : { error: 'Nu s-a putut salva' };
        }
      }
      return { error: 'Contact negăsit' };
    },
    remove: function (id) {
      var list = load(), n = list.length;
      list = list.filter(function (c) { return c.id !== id; });
      if (list.length === n) { return false; }
      return save(list);
    },
    findByNumber: function (number) {
      var num = Util.filterNumber(number), i, list = load();
      if (!num) { return null; }
      for (i = 0; i < list.length; i++) { if (list[i].number === num) { return list[i]; } }
      return null;
    },
    clear: function () { save([]); }
  };
}());
