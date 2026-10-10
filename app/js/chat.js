/* Chat over SIP MESSAGE (RFC 3428). Works with any SIP client that supports text messages (Linphone, ...).
   Offline delivery: the PBX stores messages for phones that are not registered; every time this phone registers it
   sends "SYNC" to the PBX service number and the PBX sends back what it kept (see docs/PBX-SETUP.md). ES5. */
var Chat = (function () {
  'use strict';
  var handlers = {};

  function emit(ev, data) {
    var list = handlers[ev] || [], i;
    for (i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { Log.e('chat', 'handler ' + ev + ': ' + e); }
    }
  }

  function uri(number) { return 'sip:' + encodeURIComponent(number) + '@' + Config.get().domain; }
  function nameOf(number) { var c = Contacts.findByNumber(number); return c ? c.name : number; }

  function notify(number, text) {
    try { if (navigator.vibrate) { navigator.vibrate([150, 80, 150]); } } catch (e) {}
    Sound.beep();
    if (document.hidden && window.Notification) {
      try { new Notification('Mesaj de la ' + nameOf(number), { body: text.slice(0, 80) }); }
      catch (e2) { Log.w('chat', 'notification failed: ' + e2); }
    }
  }

  function onIncoming(data) {
    var m = data.message, ru = m.remote_identity;
    var number = ru && ru.uri ? decodeURIComponent(ru.uri.user || '') : '';
    var ct = '';
    try { ct = data.request.getHeader('Content-Type') || ''; } catch (e) {}
    try { m.accept(); } catch (e1) { Log.w('chat', 'accept failed: ' + e1); }
    if (!number || !/^text\/plain/i.test(ct)) { Log.i('chat', 'ignored message type=' + ct + ' from=' + number); return; }
    var item = Messages.addIncoming(number, data.request.body);
    if (!item) { Log.i('chat', 'empty or duplicate message from ' + number); return; }
    Log.i('chat', 'message from ' + number + ' (' + item.text.length + ' chars)');
    notify(number, item.text);
    emit('incoming', { number: number, item: item });
  }

  function bindUA(ua) {
    ua.on('newMessage', function (data) {
      if (data.originator !== 'remote') { return; }
      try { onIncoming(data); } catch (e) { Log.e('chat', 'incoming failed: ' + e); }
    });
  }

  function setStatus(number, item, status, why) {
    Messages.setStatus(number, item.id, status);
    if (why) { Log.w('chat', 'message to ' + number + ' ' + status + ' (' + why + ')'); }
    emit('changed', { number: number });
  }

  function deliver(number, item) {
    var ua = Sip.ua();
    if (!ua || Sip.state().state !== 'registered') { setStatus(number, item, 'queued'); return; }
    setStatus(number, item, 'sending');
    try {
      ua.sendMessage(uri(number), item.text, {
        contentType: 'text/plain',
        eventHandlers: {
          succeeded: function () { setStatus(number, item, 'sent'); },
          failed: function (d) { setStatus(number, item, 'failed', (d && d.response && d.response.status_code) || (d && d.cause)); }
        }
      });
    } catch (e) { setStatus(number, item, 'failed', String(e)); }
  }

  /* send everything that was written while offline */
  function flush() {
    var q = Messages.queued();
    if (q.length) { Log.i('chat', 'sending ' + q.length + ' queued message(s)'); }
    q.forEach(function (x) { deliver(x.number, x.item); });
  }

  /* ask the PBX for messages stored while this phone was offline */
  function sync() {
    var cfg = Config.get(), ua = Sip.ua();
    if (cfg.msgSync !== 'on' || !ua || !cfg.msgBox) { return; }
    try {
      ua.sendMessage(uri(cfg.msgBox), 'SYNC', {
        contentType: 'text/plain',
        eventHandlers: {
          succeeded: function () { Log.i('chat', 'sync requested'); },
          failed: function (d) { Log.i('chat', 'sync not available (' + ((d && d.response && d.response.status_code) || (d && d.cause)) + ')'); }
        }
      });
    } catch (e) { Log.w('chat', 'sync failed: ' + e); }
  }

  Sip.on('state', function (s) {
    if (s && s.state === 'registered') { flush(); sync(); }
  });

  return {
    bindUA: bindUA,
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    /* returns '' on success or a short message */
    send: function (rawNumber, text) {
      var number = Util.filterNumber(rawNumber), clean = Messages.cleanText(text);
      if (!number) { return 'Număr invalid'; }
      if (number === Config.get().extension) { return 'Acesta e numărul tău'; }
      if (!clean.replace(/\s+/g, '')) { return 'Mesaj gol'; }
      var item = Messages.addOutgoing(number, clean, 'queued');
      if (!item) { return 'Mesaj gol'; }
      Log.i('chat', 'sending to ' + number + ' (' + item.text.length + ' chars)');
      deliver(number, item);
      return '';
    },
    /* try again the messages that failed for this conversation */
    retryFailed: function (number) {
      Messages.failed(number).forEach(function (it) { deliver(number, it); });
    },
    flush: flush,
    sync: sync
  };
}());
