/* SIP / WebRTC error -> short user message (Romanian). ES5. */
var Errors = (function () {
  'use strict';
  var sip = {
    400: 'Cerere invalidă',
    401: 'Parolă greșită',
    403: 'Acces interzis',
    404: 'Număr inexistent',
    408: 'Fără răspuns',
    480: 'Indisponibil',
    486: 'Ocupat',
    487: 'Apel anulat',
    488: 'Media refuzată',
    503: 'Server indisponibil',
    603: 'Respins'
  };
  var text = {
    unconfigured: 'Completează setările',
    connecting: 'Se conectează',
    registered: 'Înregistrat',
    offline: 'Offline',
    authfail: 'Eroare autentificare',
    error: 'Eroare',
    mic: 'Microfon refuzat',
    network: 'Rețea căzută'
  };
  return {
    /* status code (number) -> message */
    sip: function (code) {
      code = Number(code);
      if (sip[code]) { return sip[code]; }
      if (code >= 500 && code < 600) { return 'Eroare server (' + code + ')'; }
      if (code >= 400 && code < 500) { return 'Eroare (' + code + ')'; }
      return code ? 'Eroare ' + code : 'Eroare necunoscută';
    },
    text: function (key) { return text[key] || key; },
    /* JsSIP failure cause string -> message */
    cause: function (cause) {
      var map = {
        'Busy': 'Ocupat',
        'Rejected': 'Respins',
        'Unavailable': 'Indisponibil',
        'Not Found': 'Număr inexistent',
        'Address Incomplete': 'Număr incomplet',
        'Authentication Error': 'Parolă greșită',
        'Canceled': 'Apel anulat',
        'No Answer': 'Fără răspuns',
        'Expired': 'Fără răspuns',
        'Request Timeout': 'Fără răspuns',
        'Connection Error': 'Rețea căzută',
        'User Denied Media Access': 'Microfon refuzat',
        'WebRTC Error': 'Eroare audio',
        'Missing SDP': 'Codecuri incompatibile',
        'Incompatible SDP': 'Codecuri incompatibile',
        'RTP Timeout': 'Fără audio',
        'Bye': 'Apel încheiat',
        'Terminated': 'Apel încheiat',
        'Internal Error': 'Eroare internă',
        'SIP Failure Code': 'Apel eșuat'
      };
      return map[cause] || (cause ? 'Apel eșuat' : 'Apel încheiat');
    },
    /* registration failure -> state key used by the UI */
    registrationState: function (code) {
      code = Number(code);
      return (code === 401 || code === 403) ? 'authfail' : 'offline';
    }
  };
}());
