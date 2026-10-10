/* Chat history, kept in localStorage: threads by number, newest messages last. ES5.
   item: { id, dir:'in'|'out', text, ts, status:'queued'|'sending'|'sent'|'failed' (out only) }  */
var Messages = (function () {
  'use strict';
  var KEY = 'kaisip.messages';
  var MAX_PER_THREAD = 100, MAX_THREADS = 30, MAX_TEXT = 500;
  var seq = 0;

  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY));
      if (o && o.threads && typeof o.threads === 'object' && !(o.threads instanceof Array)) { return o; }
    } catch (e) { /* fall through */ }
    return { threads: {} };
  }
  function save(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  /* keep tab and newline, drop other control characters, cap the length */
  function cleanText(t) {
    return String(t === undefined || t === null ? '' : t)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, MAX_TEXT);
  }
  function newId() { return Date.now().toString(36) + (seq++).toString(36); }
  function threadOf(o, number) {
    if (!o.threads[number]) { o.threads[number] = { unread: 0, items: [] }; }
    return o.threads[number];
  }
  function trimThreads(o) {
    var nums = Object.keys(o.threads);
    if (nums.length <= MAX_THREADS) { return; }
    nums.sort(function (a, b) { return lastTs(o.threads[a]) - lastTs(o.threads[b]); });   /* oldest first */
    while (nums.length > MAX_THREADS) { delete o.threads[nums.shift()]; }
  }
  function lastTs(t) { return t.items.length ? t.items[t.items.length - 1].ts : 0; }
  function push(number, item) {
    var o = load(), t = threadOf(o, number);
    t.items.push(item);
    if (t.items.length > MAX_PER_THREAD) { t.items = t.items.slice(-MAX_PER_THREAD); }
    trimThreads(o);
    save(o);
    return item;
  }

  return {
    MAX_TEXT: MAX_TEXT,
    cleanText: cleanText,

    /* [{ number, last, unread, count }] newest conversation first */
    threads: function () {
      var o = load(), list = [];
      Object.keys(o.threads).forEach(function (n) {
        var t = o.threads[n];
        if (!t.items.length) { return; }
        list.push({ number: n, last: t.items[t.items.length - 1], unread: t.unread || 0, count: t.items.length });
      });
      list.sort(function (a, b) { return b.last.ts - a.last.ts; });
      return list;
    },
    get: function (number) {
      var t = load().threads[number];
      return t ? t.items.slice() : [];
    },

    /* returns the stored item, or null for an empty message or an immediate duplicate */
    addIncoming: function (number, text, ts) {
      var clean = cleanText(text);
      if (!clean.replace(/\s+/g, '')) { return null; }
      var o = load(), t = threadOf(o, number), last = t.items[t.items.length - 1], now = ts || Date.now();
      if (last && last.dir === 'in' && last.text === clean && Math.abs(now - last.ts) < 3000) { return null; }   /* PBX redelivery */
      var item = { id: newId(), dir: 'in', text: clean, ts: now };
      t.items.push(item);
      if (t.items.length > MAX_PER_THREAD) { t.items = t.items.slice(-MAX_PER_THREAD); }
      t.unread = (t.unread || 0) + 1;
      trimThreads(o);
      save(o);
      return item;
    },
    addOutgoing: function (number, text, status) {
      var clean = cleanText(text);
      if (!clean.replace(/\s+/g, '')) { return null; }
      return push(number, { id: newId(), dir: 'out', text: clean, ts: Date.now(), status: status || 'queued' });
    },
    setStatus: function (number, id, status) {
      var o = load(), t = o.threads[number], i;
      if (!t) { return false; }
      for (i = 0; i < t.items.length; i++) {
        if (t.items[i].id === id) { t.items[i].status = status; return save(o); }
      }
      return false;
    },
    markRead: function (number) {
      var o = load();
      if (o.threads[number] && o.threads[number].unread) { o.threads[number].unread = 0; save(o); }
    },
    unread: function (number) { var t = load().threads[number]; return t ? (t.unread || 0) : 0; },
    unreadTotal: function () {
      var o = load(), n = 0;
      Object.keys(o.threads).forEach(function (k) { n += o.threads[k].unread || 0; });
      return n;
    },
    /* outgoing messages waiting for a connection: [{ number, item }] */
    queued: function () {
      var o = load(), out = [];
      Object.keys(o.threads).forEach(function (n) {
        o.threads[n].items.forEach(function (it) { if (it.dir === 'out' && it.status === 'queued') { out.push({ number: n, item: it }); } });
      });
      return out;
    },
    failed: function (number) {
      return this.get(number).filter(function (it) { return it.dir === 'out' && it.status === 'failed'; });
    },
    removeThread: function (number) { var o = load(); delete o.threads[number]; return save(o); },
    clear: function () { save({ threads: {} }); },

    /* short list label: "Zoe (2)" / "207" */
    label: function (t, displayName) {
      return (displayName || t.number) + (t.unread ? ' (' + t.unread + ')' : '');
    },
    /* one-line preview of the newest message */
    preview: function (t) {
      var s = (t.last.dir === 'out' ? 'Tu: ' : '') + t.last.text.replace(/\s+/g, ' ');
      return s.length > 34 ? s.slice(0, 33) + '…' : s;
    }
  };
}());
