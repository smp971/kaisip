/* Push-to-talk between KaiSIP phones.
   Press = a short call to the PTT channel number (a Page() group on the PBX); release = hang up.
   Receiving = an incoming call carrying the X-KaiSIP-PTT header from a known member is answered automatically,
   receive-only (this phone's microphone is NOT opened), on the speaker. Anyone else is an ordinary call. ES5. */
var Ptt = (function () {
  'use strict';
  var HEADER = 'X-KaiSIP-PTT';
  var talking = false;

  function members() {
    var list = Config.normalizeList(Config.get().pttMembers);
    return list ? list.split(',') : [];
  }
  function channel() { return Util.filterNumber(Config.get().pttChannel); }

  /* may this caller make our phone answer by itself? */
  function isMember(number) {
    var n = Util.filterNumber(number);
    return !!n && members().indexOf(n) >= 0;
  }

  /* an incoming INVITE is a PTT transmission when it has the header AND the sender is a member */
  function shouldAutoAnswer(headerValue, callerNumber) {
    return !!headerValue && isMember(callerNumber);
  }

  /* what the PTT screen shows, from the current call */
  function status(c) {
    if (!c || !c.ptt) { return { key: 'idle', text: 'Liber' }; }
    if (c.dir === 'out') {
      if (c.state === 'incall') { return { key: 'talking', text: 'VORBEȘTI' }; }
      if (c.state === 'ended') { return { key: 'idle', text: c.message || 'Liber' }; }
      return { key: 'opening', text: 'Se deschide canalul' };
    }
    if (c.state === 'ended') { return { key: 'idle', text: 'Liber' }; }
    return { key: 'listening', text: 'Asculți' };
  }

  return {
    HEADER: HEADER,
    members: members,
    channel: channel,
    isMember: isMember,
    shouldAutoAnswer: shouldAutoAnswer,
    status: status,
    isTalking: function () { return talking; },
    ready: function () { return !!channel() && Sip.state().state === 'registered'; },

    /* key down: returns '' on success or a short message to show */
    press: function () {
      if (talking) { return ''; }
      if (!channel()) { return 'Setează canalul PTT în Setări'; }
      if (Sip.state().state !== 'registered') { return 'Nu ești înregistrat'; }
      if (Call.inCall()) { return 'Canal ocupat'; }
      var err = Call.dial(channel(), { ptt: true });
      if (err) { return err; }
      talking = true;
      return '';
    },

    /* key up */
    release: function () {
      if (!talking) { return; }
      talking = false;
      var c = Call.current();
      if (c && c.ptt && c.dir === 'out' && !c.ended) { Call.hangup(); }
    },

    _reset: function () { talking = false; }
  };
}());
