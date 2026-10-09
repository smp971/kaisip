/* Audio output routing: earpiece <-> loudspeaker during calls.
   Needs a certified app: the 'telephony' audio channel and mozTelephony.speakerEnabled.
   When unavailable (privileged install) everything falls back to the 'content' channel (speaker only). ES5. */
var Route = (function () {
  'use strict';
  var supportedCache = null, prevVolChannel = 'normal';

  function tel() {
    try { return navigator.mozTelephony || null; } catch (e) { return null; }
  }

  function canTelephonyChannel() {
    try {
      var a = new Audio();
      a.mozAudioChannelType = 'telephony';
      return a.mozAudioChannelType === 'telephony';
    } catch (e) { return false; }
  }

  function supported() {
    if (supportedCache === null) {
      var t = tel();
      supportedCache = !!(t && ('speakerEnabled' in t) && canTelephonyChannel());
      Log.i('route', 'earpiece routing supported=' + supportedCache);
    }
    return supportedCache;
  }

  function headphones() {
    try { return !!(navigator.mozAudioChannelManager && navigator.mozAudioChannelManager.headphones); }
    catch (e) { return false; }
  }

  function isSpeaker() {
    if (!supported()) { return true; }
    try { return !!tel().speakerEnabled; } catch (e) { return true; }
  }

  function setSpeaker(on) {
    if (!supported()) { return false; }
    try { tel().speakerEnabled = !!on; Log.i('route', 'speaker=' + !!on); return true; }
    catch (e) { Log.e('route', 'setSpeaker failed: ' + e); return false; }
  }

  return {
    supported: supported,
    headphones: headphones,
    isSpeaker: isSpeaker,
    setSpeaker: setSpeaker,
    toggle: function () { return setSpeaker(!isSpeaker()); },
    /* audio channel for call audio */
    channel: function () { return supported() ? 'telephony' : 'content'; },
    /* apply the user's default at the start of a call, and put it back to normal afterwards */
    begin: function () {
      if (!supported()) { return; }
      setSpeaker(Config.get().audioOut === 'speaker');
      try {   /* let the side volume keys act on the call channel while the app is in front */
        var m = navigator.mozAudioChannelManager;
        prevVolChannel = m.volumeControlChannel || 'normal';
        m.volumeControlChannel = 'telephony';
        Log.i('route', 'volume keys -> telephony');
      } catch (e) { Log.w('route', 'volumeControlChannel: ' + e); }
    },
    end: function () {
      if (!supported()) { return; }
      setSpeaker(false);
      try { navigator.mozAudioChannelManager.volumeControlChannel = prevVolChannel; } catch (e) {}
    },
    /* label for the toggle softkey */
    label: function () {
      if (!supported()) { return ''; }
      if (isSpeaker()) { return headphones() ? 'Căști' : 'Ureche'; }
      return headphones() ? 'Căști' : 'Difuzor';
    },
    onHeadphones: function (fn) {
      try { navigator.mozAudioChannelManager.addEventListener('headphoneschange', fn); } catch (e) {}
    }
  };
}());
