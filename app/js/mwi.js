/* Voicemail indicator (RFC 3842 message-summary NOTIFY, sent by Asterisk when the endpoint has mailboxes=). ES5. */
var Mwi = (function () {
  'use strict';
  var state = { waiting: false, newMsgs: 0, oldMsgs: 0 };
  var handlers = [];

  /* "Messages-Waiting: yes\r\nVoice-Message: 2/5 (0/0)" -> { waiting, newMsgs, oldMsgs } */
  function parse(body) {
    var text = String(body === undefined || body === null ? '' : body);
    var w = /Messages-Waiting:\s*(yes|no)/i.exec(text);
    var v = /Voice-Message:\s*(\d+)\s*\/\s*(\d+)/i.exec(text);
    var n = v ? Number(v[1]) : 0, o = v ? Number(v[2]) : 0;
    var waiting = w ? w[1].toLowerCase() === 'yes' : n > 0;
    if (waiting && !v) { n = 1; }      /* the PBX says there is mail but not how much */
    if (!waiting) { n = 0; }
    return { waiting: waiting, newMsgs: n, oldMsgs: o };
  }

  function set(next) {
    var changed = next.newMsgs !== state.newMsgs || next.oldMsgs !== state.oldMsgs || next.waiting !== state.waiting;
    state = next;
    if (changed) {
      var i;
      for (i = 0; i < handlers.length; i++) { try { handlers[i](state); } catch (e) {} }
    }
  }

  return {
    parse: parse,
    count: function () { return state.newMsgs; },
    state: function () { return state; },
    on: function (fn) { handlers.push(fn); },
    bindUA: function (ua) {
      ua.on('sipEvent', function (d) {
        var ev = d && d.event && (d.event.event || d.event);
        if (String(ev || '').toLowerCase() !== 'message-summary') { return; }
        set(parse(d.request && d.request.body));
        Log.i('mwi', 'voicemail new=' + state.newMsgs + ' old=' + state.oldMsgs);
      });
    },
    _reset: function () { state = { waiting: false, newMsgs: 0, oldMsgs: 0 }; handlers = []; }
  };
}());
