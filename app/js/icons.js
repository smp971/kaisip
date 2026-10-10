/* Menu icons as small inline SVGs (emoji are not reliable on KaiOS fonts). ES5. */
var Icons = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  /* 24x24 viewBox, stroked with currentColor */
  var PATHS = {
    account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
    contacts: 'M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z M9 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0z M8 16c0-2 1.5-3 3-3s3 1 3 3 M19 7h2 M19 12h2 M19 17h2',
    chat: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M7 9h10 M7 12h6',
    ptt: 'M9 3h6v10a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6',
    log: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    settings: 'M4 7h9 M17 7h3 M15 5v4 M4 17h3 M11 17h9 M9 15v4 M4 12h16',
    reconnect: 'M20 12a8 8 0 0 1-14 5.3 M4 12a8 8 0 0 1 14-5.3 M18 3v4h-4 M6 21v-4h4',
    about: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5v.5',
    voicemail: 'M7 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M17 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M7 16h10'
  };

  return {
    has: function (id) { return PATHS.hasOwnProperty(id); },
    make: function (id, size) {
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', String(size || 30));
      svg.setAttribute('height', String(size || 30));
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', PATHS[id] || '');
      svg.appendChild(p);
      return svg;
    }
  };
}());
