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
    /* registration failure -> state key used by the UI */
    registrationState: function (code) {
      code = Number(code);
      return (code === 401 || code === 403) ? 'authfail' : 'offline';
    }
  };
}());
