/* Screens and softkeys. ES5. Screens: home | menu | settings | edit | about */
var UI = (function () {
  'use strict';

  /* Advanced settings. Extension and password live on the Account (login) screen. */
  var FIELDS = [
    { key: 'wssUrl', label: 'Server WSS' },
    { key: 'domain', label: 'Domeniu SIP' },
    { key: 'stun', label: 'STUN' },
    { key: 'background', label: 'Mod fundal', toggle: ['off', 'on'] },
    { key: 'ringVolume', label: 'Volum sonerie (0-100)' }
  ];
  var MENU = [
    { id: 'account', label: 'Cont' },
    { id: 'log', label: 'Jurnal apeluri' },
    { id: 'settings', label: 'Setări avansate' },
    { id: 'reconnect', label: 'Reconectează' },
    { id: 'about', label: 'Despre' }
  ];

  var screen = 'home', dial = '', menuSel = 0, setSel = 0;
  var edit = null;          /* { field, error, reveal } */
  var login = null;         /* { focus: 0|1, reveal, error, ext, pass } */
  var settingsChanged = false;
  var logSel = 0;
  var toastTimer = null, keyLogged = 0;

  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function div(cls, text) {
    var d = document.createElement('div');
    if (cls) { d.className = cls; }
    if (text !== undefined) { d.textContent = text; }
    return d;
  }

  function softkeys(l, c, r) {
    $('sk-l').textContent = l || '';
    $('sk-c').textContent = c || '';
    $('sk-r').textContent = r || '';
  }

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 2500);
  }

  /* ---------- status bar ---------- */
  function refreshStatus() {
    var s = Sip.state();
    var dot = $('dot');
    dot.className = s.state;
    var label = Errors.text(s.state === 'idle' ? 'connecting' : s.state);
    $('regtext').textContent = label + (s.detail && s.state !== 'registered' ? ' · ' + s.detail : '');
    $('ext').textContent = Config.get().extension;
    if (s.state === 'registered') { authPrompted = false; }
    if (s.state === 'authfail' && screen === 'home' && !authPrompted) {
      authPrompted = true;
      openLogin(s.detail || 'Parolă greșită');
      return;
    }
    if (screen === 'home') { renderHome(); }
  }

  /* ---------- home ---------- */
  function renderHome() {
    var el = $('screen');
    clear(el);
    el.appendChild(div('dialnum', dial || ''));
    var s = Sip.state();
    var hint = '';
    if (s.state === 'unconfigured') { hint = 'Apasă Cont și introdu extensia'; }
    else if (s.state === 'registered') { hint = dial ? 'Apasă Apel' : 'Scrie un număr'; }
    else { hint = s.detail || Errors.text(s.state); }
    el.appendChild(div('hint', hint));
    softkeys('Meniu', 'Apel', 'Cont');
  }

  /* ---------- menu ---------- */
  function renderMenu() {
    var el = $('screen');
    clear(el);
    var h = document.createElement('h1'); h.textContent = 'Meniu'; el.appendChild(h);
    var i, it;
    for (i = 0; i < MENU.length; i++) {
      it = div('item' + (i === menuSel ? ' sel' : ''), MENU[i].label);
      el.appendChild(it);
    }
    softkeys('Înapoi', 'Alege', '');
  }

  /* ---------- settings ---------- */
  function displayValue(f) {
    var v = Config.get()[f.key];
    if (f.secret) { return v ? Util.mask(v) : '(necompletat)'; }
    if (f.toggle) { return v === 'on' ? 'Pornit' : 'Oprit'; }
    return (v === '' || v === undefined) ? '(necompletat)' : String(v);
  }

  function renderSettings() {
    var el = $('screen');
    clear(el);
    var h = document.createElement('h1'); h.textContent = 'Setări'; el.appendChild(h);
    var i, row, k, v, selected = null;
    for (i = 0; i < FIELDS.length; i++) {
      row = div('item' + (i === setSel ? ' sel' : ''));
      k = div('k', FIELDS[i].label);
      v = div('v', displayValue(FIELDS[i]));
      row.appendChild(k); row.appendChild(v);
      el.appendChild(row);
      if (i === setSel) { selected = row; }
    }
    if (selected && selected.scrollIntoView) { selected.scrollIntoView(false); }
    softkeys('Înapoi', FIELDS[setSel].toggle ? 'Schimbă' : 'Editează', '');
  }

  function renderEdit() {
    var f = edit.field;
    var el = $('screen');
    clear(el);
    var box = div('edit');
    box.appendChild(div('k', f.label));
    var input = document.createElement('input');
    input.id = 'editinput';
    input.type = (f.secret && !edit.reveal) ? 'password' : 'text';
    input.value = edit.value !== undefined ? edit.value : String(Config.get()[f.key]);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    box.appendChild(input);
    if (edit.error) { box.appendChild(div('err', edit.error)); }
    el.appendChild(box);
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    softkeys('Anulează', 'OK', f.secret ? (edit.reveal ? 'Ascunde' : 'Arată') : '');
  }

  function startEdit(f) {
    if (f.toggle) {
      var cur = Config.get()[f.key];
      var next = f.toggle[(f.toggle.indexOf(cur) + 1) % f.toggle.length];
      var err = Config.set(f.key, next);
      if (err) { toast(err); } else { settingsChanged = true; Log.i('cfg', f.key + ' -> ' + next); }
      renderSettings();
      return;
    }
    edit = { field: f, error: '', reveal: false };
    screen = 'edit';
    renderEdit();
  }

  function commitEdit() {
    var input = $('editinput');
    var val = input ? input.value : '';
    var f = edit.field;
    if (f.key !== 'password') { val = val.replace(/^\s+|\s+$/g, ''); }
    var err = Config.set(f.key, val);
    if (err) { edit.error = err; edit.value = val; renderEdit(); return; }
    settingsChanged = true;
    Log.i('cfg', f.key + ' updated' + (f.secret ? '' : ' -> ' + val));
    edit = null;
    screen = 'settings';
    renderSettings();
    refreshStatus();
  }

  function leaveSettings() {
    if (settingsChanged) {
      settingsChanged = false;
      if (Config.isComplete()) { toast('Salvat. Se reconectează'); Sip.restart(); }
    }
    if (loginPending && login) {
      loginPending = false;
      screen = 'login';
      renderLogin();
      return;
    }
    loginPending = false;
    screen = 'home';
    renderHome();
    refreshStatus();
  }

  /* ---------- call screen ---------- */
  function callStateText(c) {
    switch (c.state) {
      case 'calling': return 'Se apelează';
      case 'ringing': return 'Sună';
      case 'incoming': return 'Apel primit';
      case 'incall': return '';
      case 'ended': return c.message || 'Apel încheiat';
      default: return '';
    }
  }

  function renderCall() {
    var c = Call.current();
    if (!c) { backToHome(); return; }
    var el = $('screen');
    clear(el);
    el.appendChild(div('dialnum', c.name || c.number));
    if (c.name) { el.appendChild(div('hint', c.number)); }
    el.appendChild(div('callstate', callStateText(c)));
    var timer = div('calltimer', c.state === 'incall' ? Util.fmtDuration((Date.now() - c.answeredAt) / 1000) : '');
    timer.id = 'calltimer';
    el.appendChild(timer);
    if (c.state === 'incall' && c.muted) { el.appendChild(div('hint', 'Microfon oprit')); }
    if (c.state === 'incoming') { softkeys('Respinge', '', 'Răspunde'); }
    else if (c.state === 'incall') { softkeys(c.muted ? 'Activează mic' : 'Mute', '', 'Închide'); }
    else if (c.state === 'ended') { softkeys('', '', ''); }
    else { softkeys('', '', 'Anulează'); }
  }

  function onCallKey(e, k) {
    var c = Call.current();
    if (!c) { return; }
    if (c.state === 'incoming') {
      if (k === 'SoftRight' || k === 'Call' || k === 'Enter') { e.preventDefault(); Call.answer(); }
      else if (k === 'SoftLeft' || k === 'End' || k === 'Back') { e.preventDefault(); Call.reject(); }
    } else if (c.state === 'incall') {
      if (/^[0-9*#]$/.test(k)) { e.preventDefault(); Call.dtmf(k); }
      else if (k === 'SoftLeft') { e.preventDefault(); Call.toggleMute(); }
      else if (k === 'SoftRight' || k === 'End' || k === 'Back') { e.preventDefault(); Call.hangup(); }
    } else if (c.state === 'calling' || c.state === 'ringing') {
      if (k === 'SoftRight' || k === 'End' || k === 'Back') { e.preventDefault(); Call.hangup(); }
    }
  }

  /* ---------- call log ---------- */
  function renderLog() {
    var el = $('screen');
    clear(el);
    var h = document.createElement('h1'); h.textContent = 'Jurnal apeluri'; el.appendChild(h);
    var list = CallLog.list();
    if (!list.length) {
      el.appendChild(div('hint', 'Niciun apel'));
      softkeys('Înapoi', '', '');
      return;
    }
    if (logSel >= list.length) { logSel = list.length - 1; }
    var i, row, sel = null;
    for (i = 0; i < list.length; i++) {
      row = div('item' + (i === logSel ? ' sel' : ''), CallLog.label(list[i]));
      el.appendChild(row);
      if (i === logSel) { sel = row; }
    }
    if (sel && sel.scrollIntoView) { sel.scrollIntoView(false); }
    softkeys('Înapoi', 'Apelează', 'Șterge');
  }

  /* ---------- account (login) ---------- */
  var loginPending = false;      /* user went to advanced settings from the login screen */
  var authPrompted = false;      /* avoid reopening login in a loop after a wrong password */

  function inputRow(label, id, type, value) {
    var box = div('edit');
    box.appendChild(div('k', label));
    var input = document.createElement('input');
    input.id = id;
    input.type = type;
    input.value = value || '';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    box.appendChild(input);
    return box;
  }

  function syncLogin() {
    var a = $('loginext'), b = $('loginpass');
    if (a) { login.ext = a.value; }
    if (b) { login.pass = b.value; }
  }

  function renderLogin() {
    var el = $('screen');
    clear(el);
    var h = document.createElement('h1'); h.textContent = 'Cont SIP'; el.appendChild(h);
    el.appendChild(inputRow('Extensie', 'loginext', 'text', login.ext));
    el.appendChild(inputRow('Parolă', 'loginpass', login.reveal ? 'text' : 'password', login.pass));
    if (login.error) { el.appendChild(div('err', login.error)); }
    el.appendChild(div('hint', 'Server: ' + Config.get().domain));
    var target = $(login.focus === 0 ? 'loginext' : 'loginpass');
    target.focus();
    try { target.setSelectionRange(target.value.length, target.value.length); } catch (e) {}
    softkeys(login.reveal ? 'Ascunde' : 'Arată',
             login.focus === 0 ? 'Următorul' : 'Conectare',
             Config.isComplete() ? 'Anulează' : 'Setări');
  }

  function openLogin(error) {
    var c = Config.get();
    login = { focus: 0, reveal: false, error: error || '', ext: c.extension, pass: c.password };
    screen = 'login';
    renderLogin();
  }

  function submitLogin() {
    syncLogin();
    var ext = login.ext.replace(/^\s+|\s+$/g, ''), pass = login.pass;
    var e1 = Config.validate('extension', ext), e2 = Config.validate('password', pass);
    if (e1 || e2) {
      login.error = e1 || (e2 ? 'Completează parola' : '');
      login.focus = e1 ? 0 : 1;
      renderLogin();
      return;
    }
    Config.set('extension', ext);
    Config.set('password', pass);
    Log.i('cfg', 'account saved ext=' + ext);
    login = null;
    authPrompted = false;
    screen = 'home';
    toast('Se conectează');
    Sip.restart();
    renderHome();
    refreshStatus();
  }

  /* ---------- about ---------- */
  function renderAbout() {
    var el = $('screen');
    clear(el);
    var h = document.createElement('h1'); h.textContent = 'Despre'; el.appendChild(h);
    var c = Config.get();
    el.appendChild(div('item', 'KaiSIP ' + (window.KAISIP_VERSION || '?')));
    el.appendChild(div('item', 'Cont: ' + (c.extension || '-') + '@' + c.domain));
    el.appendChild(div('item', 'Server: ' + c.wssUrl));
    el.appendChild(div('item', 'JsSIP ' + (typeof JsSIP !== 'undefined' ? JsSIP.version || '' : 'lipsă')));
    el.appendChild(div('item', 'Jurnal: ' + Log.fileName()));
    softkeys('Înapoi', '', '');
  }

  /* ---------- navigation ---------- */
  function openSettings() { screen = 'settings'; settingsChanged = false; renderSettings(); }
  function openMenu() { screen = 'menu'; menuSel = 0; renderMenu(); }
  function backToHome() { screen = 'home'; renderHome(); }

  function menuChoose() {
    var id = MENU[menuSel].id;
    if (id === 'account') { openLogin(); }
    else if (id === 'log') { screen = 'log'; logSel = 0; renderLog(); }
    else if (id === 'settings') { openSettings(); }
    else if (id === 'reconnect') { Sip.restart(); toast('Se reconectează'); backToHome(); }
    else if (id === 'about') { screen = 'about'; renderAbout(); }
  }

  /* ---------- keys ---------- */
  function norm(e) {
    var k = e.key;
    if (k === 'SoftLeft' || k === 'F1') { return 'SoftLeft'; }
    if (k === 'SoftRight' || k === 'F2') { return 'SoftRight'; }
    if (k === 'Enter') { return 'Enter'; }
    if (k === 'Backspace') { return 'Back'; }
    if (k === 'ArrowUp') { return 'Up'; }
    if (k === 'ArrowDown') { return 'Down'; }
    if (k === 'Call') { return 'Call'; }
    if (k === 'EndCall') { return 'End'; }
    if (/^[0-9*#]$/.test(k || '')) { return k; }
    return k || '';
  }

  function onKey(e) {
    if (keyLogged < 40) { keyLogged++; Log.i('key', 'key=' + e.key + ' code=' + e.keyCode); }
    var k = norm(e);

    if (screen === 'edit') {
      if (k === 'Enter') { e.preventDefault(); commitEdit(); }
      else if (k === 'SoftLeft') { e.preventDefault(); edit = null; screen = 'settings'; renderSettings(); }
      else if (k === 'SoftRight' && edit.field.secret) {
        e.preventDefault();
        edit.value = $('editinput').value;
        edit.reveal = !edit.reveal;
        renderEdit();
      }
      return;
    }

    if (screen === 'call') { onCallKey(e, k); return; }

    if (screen === 'log') {
      var entries = CallLog.list();
      if (k === 'Up' && entries.length) { logSel = (logSel + entries.length - 1) % entries.length; renderLog(); e.preventDefault(); }
      else if (k === 'Down' && entries.length) { logSel = (logSel + 1) % entries.length; renderLog(); e.preventDefault(); }
      else if ((k === 'Enter' || k === 'Call') && entries.length) {
        e.preventDefault();
        var err0 = Call.dial(entries[logSel].number);
        if (err0) { toast(err0); }
      }
      else if (k === 'SoftRight' && entries.length) { e.preventDefault(); CallLog.clear(); logSel = 0; renderLog(); toast('Jurnal șters'); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); backToHome(); }
      return;
    }

    if (screen === 'login') {
      if (k === 'Up') { e.preventDefault(); syncLogin(); login.focus = 0; renderLogin(); }
      else if (k === 'Down') { e.preventDefault(); syncLogin(); login.focus = 1; renderLogin(); }
      else if (k === 'Enter') {
        e.preventDefault();
        if (login.focus === 0) { syncLogin(); login.focus = 1; renderLogin(); } else { submitLogin(); }
      }
      else if (k === 'SoftLeft') { e.preventDefault(); syncLogin(); login.reveal = !login.reveal; renderLogin(); }
      else if (k === 'SoftRight') {
        e.preventDefault();
        syncLogin();
        if (Config.isComplete()) { login = null; screen = 'home'; renderHome(); refreshStatus(); }
        else { loginPending = true; openSettings(); }
      }
      return;
    }

    if (screen === 'home') {
      if (/^[0-9*#]$/.test(k)) { if (dial.length < 24) { dial += k; renderHome(); } e.preventDefault(); }
      else if (k === 'Back') { if (dial) { dial = dial.slice(0, -1); renderHome(); e.preventDefault(); } }
      else if (k === 'SoftLeft') { e.preventDefault(); openMenu(); }
      else if (k === 'SoftRight') { e.preventDefault(); openLogin(); }
      else if (k === 'Enter' || k === 'Call') {
        e.preventDefault();
        if (!dial) { toast('Scrie un număr'); }
        else {
          var err = Call.dial(dial);
          if (err) { toast(err); } else { dial = ''; }
        }
      }
      return;
    }

    if (screen === 'menu') {
      if (k === 'Up') { menuSel = (menuSel + MENU.length - 1) % MENU.length; renderMenu(); e.preventDefault(); }
      else if (k === 'Down') { menuSel = (menuSel + 1) % MENU.length; renderMenu(); e.preventDefault(); }
      else if (k === 'Enter') { e.preventDefault(); menuChoose(); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); backToHome(); }
      return;
    }

    if (screen === 'settings') {
      if (k === 'Up') { setSel = (setSel + FIELDS.length - 1) % FIELDS.length; renderSettings(); e.preventDefault(); }
      else if (k === 'Down') { setSel = (setSel + 1) % FIELDS.length; renderSettings(); e.preventDefault(); }
      else if (k === 'Enter') { e.preventDefault(); startEdit(FIELDS[setSel]); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); leaveSettings(); }
      return;
    }

    if (screen === 'about') {
      if (k === 'SoftLeft' || k === 'Back' || k === 'Enter') { e.preventDefault(); backToHome(); }
    }
  }

  return {
    init: function () {
      document.addEventListener('keydown', onKey);
      Call.on('new', function () { screen = 'call'; renderCall(); });
      Call.on('change', function () { if (screen === 'call') { renderCall(); } });
      Call.on('tick', function (c) {
        var t = $('calltimer');
        if (screen === 'call' && t && c && c.state === 'incall') { t.textContent = Util.fmtDuration((Date.now() - c.answeredAt) / 1000); }
      });
      Call.on('ended', function () { if (screen === 'call') { renderCall(); } });
      Call.on('cleared', function () { if (screen === 'call') { backToHome(); refreshStatus(); } });
      renderHome();
      refreshStatus();
    },
    refreshStatus: refreshStatus,
    openSettings: openSettings,
    openLogin: openLogin,
    toast: toast
  };
}());
