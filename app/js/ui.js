/* Screens and softkeys. ES5.
   Screens: home | menu | settings | edit | login | call | log | contacts | contactedit | ctx | confirm | about */
var UI = (function () {
  'use strict';

  var BG_LABELS = { off: 'Oprit', low: 'Economic', on: 'Continuu' };
  var OUT_LABELS = { ear: 'Ureche', speaker: 'Difuzor' };

  /* Basic settings; connection details live under "Setări avansate". */
  var BASIC = [
    { key: 'ringVolume', label: 'Volum sonerie (0-100)' },
    { key: 'background', label: 'Mod fundal', toggle: ['off', 'low', 'on'], labels: BG_LABELS },
    { key: 'audioOut', label: 'Ieșire audio la apel', toggle: ['ear', 'speaker'], labels: OUT_LABELS, needsRoute: true },
    { link: 'adv', label: 'Setări avansate' }
  ];
  var ADV = [
    { key: 'wssUrl', label: 'Server WSS', conn: true },
    { key: 'domain', label: 'Domeniu SIP', conn: true },
    { key: 'stun', label: 'STUN', conn: true }
  ];
  var MENU = [
    { id: 'account', label: 'Cont' },
    { id: 'contacts', label: 'Contacte' },
    { id: 'log', label: 'Jurnal apeluri' },
    { id: 'settings', label: 'Setări' },
    { id: 'reconnect', label: 'Reconectează' },
    { id: 'about', label: 'Despre' }
  ];

  var screen = 'home', dial = '', menuSel = 0, setSel = 0, logSel = 0, ctSel = 0;
  var settingsMode = 'basic', settingsDirectAdv = false, settingsChanged = false;
  var edit = null;                 /* { field, error, reveal, value } */
  var login = null;                /* { focus, reveal, error, ext, pass } */
  var ced = null;                  /* contact edit: { id, focus, name, number, error } */
  var ctx = null;                  /* context menu: { title, items:[{label, run}], sel, back } */
  var confirmBox = null;           /* { text, yes, back } */
  var loginPending = false, authPrompted = false;
  var toastTimer = null, keyLogged = 0;

  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function div(cls, text) {
    var d = document.createElement('div');
    if (cls) { d.className = cls; }
    if (text !== undefined) { d.textContent = text; }
    return d;
  }
  function heading(el, text) { var h = document.createElement('h1'); h.textContent = text; el.appendChild(h); }
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
  function focusEnd(id) {
    var t = $(id);
    if (!t) { return; }
    t.focus();
    try { t.setSelectionRange(t.value.length, t.value.length); } catch (e) {}
  }

  /* ---------- status bar ---------- */
  function refreshStatus() {
    var s = Sip.state();
    $('dot').className = s.state;
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
    var s = Sip.state(), hint = '';
    var known = dial ? Contacts.findByNumber(dial) : null;
    if (known) { hint = known.name; }
    else if (s.state === 'unconfigured') { hint = 'Deschide Meniu → Cont'; }
    else if (s.state === 'registered') { hint = dial ? 'Apasă Apel' : 'Scrie un număr'; }
    else { hint = s.detail || Errors.text(s.state); }
    el.appendChild(div('hint', hint));
    softkeys('Meniu', 'Apel', 'Contacte');
  }
  function backToHome() { screen = 'home'; renderHome(); }

  /* ---------- menu ---------- */
  function renderMenu() {
    var el = $('screen');
    clear(el);
    heading(el, 'Meniu');
    var i;
    for (i = 0; i < MENU.length; i++) { el.appendChild(div('item' + (i === menuSel ? ' sel' : ''), MENU[i].label)); }
    softkeys('Înapoi', 'Alege', '');
  }
  function openMenu() { screen = 'menu'; menuSel = 0; renderMenu(); }
  function menuChoose() {
    var id = MENU[menuSel].id;
    if (id === 'account') { openLogin(); }
    else if (id === 'contacts') { openContacts(); }
    else if (id === 'log') { screen = 'log'; logSel = 0; renderLog(); }
    else if (id === 'settings') { openSettings('basic'); }
    else if (id === 'reconnect') { Sip.restart(); toast('Se reconectează'); backToHome(); }
    else if (id === 'about') { screen = 'about'; renderAbout(); }
  }

  /* ---------- generic context menu ---------- */
  function openCtx(title, items, back) {
    ctx = { title: title, items: items, sel: 0, back: back };
    screen = 'ctx';
    renderCtx();
  }
  function renderCtx() {
    var el = $('screen');
    clear(el);
    heading(el, ctx.title);
    var i;
    for (i = 0; i < ctx.items.length; i++) { el.appendChild(div('item' + (i === ctx.sel ? ' sel' : ''), ctx.items[i].label)); }
    softkeys('Înapoi', 'Alege', '');
  }
  function closeCtx() { var b = ctx ? ctx.back : 'home'; ctx = null; goto(b); }
  function goto(name) {
    screen = name;
    if (name === 'home') { renderHome(); }
    else if (name === 'log') { renderLog(); }
    else if (name === 'contacts') { renderContacts(); }
    else if (name === 'menu') { renderMenu(); }
    else if (name === 'settings') { renderSettings(); }
    else { backToHome(); }
  }

  function openConfirm(text, yes, back) {
    confirmBox = { text: text, yes: yes, back: back };
    screen = 'confirm';
    var el = $('screen');
    clear(el);
    el.appendChild(div('dialnum', ''));
    el.appendChild(div('callstate', text));
    softkeys('Nu', '', 'Da');
  }

  /* ---------- settings ---------- */
  function fieldsNow() {
    if (settingsMode === 'adv') { return ADV; }
    return BASIC.filter(function (f) { return !(f.needsRoute && !Route.supported()); });
  }
  function displayValue(f) {
    if (f.link) { return '›'; }
    var v = Config.get()[f.key];
    if (f.labels) { return f.labels[v] || String(v); }
    if (f.key === 'ringVolume') { return v + '%'; }
    return (v === '' || v === undefined) ? '(necompletat)' : String(v);
  }
  function renderSettings() {
    var el = $('screen'), fields = fieldsNow();
    clear(el);
    heading(el, settingsMode === 'adv' ? 'Setări avansate' : 'Setări');
    if (setSel >= fields.length) { setSel = fields.length - 1; }
    var i, row, selected = null;
    for (i = 0; i < fields.length; i++) {
      row = div('item' + (i === setSel ? ' sel' : ''));
      row.appendChild(div('k', fields[i].label));
      row.appendChild(div('v', displayValue(fields[i])));
      el.appendChild(row);
      if (i === setSel) { selected = row; }
    }
    if (selected && selected.scrollIntoView) { selected.scrollIntoView(false); }
    var f = fields[setSel];
    softkeys('Înapoi', f.link ? 'Deschide' : (f.toggle ? 'Schimbă' : 'Editează'), '');
  }
  function openSettings(mode) {
    settingsMode = mode || 'basic';
    settingsDirectAdv = (settingsMode === 'adv');
    settingsChanged = false;
    setSel = 0;
    screen = 'settings';
    renderSettings();
  }
  function afterChange(f) {
    if (f.key === 'background') { Background.apply(); settingsChanged = true; }
    else if (f.conn) { settingsChanged = true; }
  }
  function renderEdit() {
    var f = edit.field, el = $('screen');
    clear(el);
    var box = div('edit');
    box.appendChild(div('k', f.label));
    var input = document.createElement('input');
    input.id = 'editinput';
    input.type = 'text';
    input.value = edit.value !== undefined ? edit.value : String(Config.get()[f.key]);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    box.appendChild(input);
    if (edit.error) { box.appendChild(div('err', edit.error)); }
    el.appendChild(box);
    focusEnd('editinput');
    softkeys('Anulează', 'OK', '');
  }
  function startEdit(f) {
    if (f.link) { settingsMode = f.link; setSel = 0; renderSettings(); return; }
    if (f.toggle) {
      var cur = Config.get()[f.key];
      var next = f.toggle[(f.toggle.indexOf(cur) + 1) % f.toggle.length];
      var err = Config.set(f.key, next);
      if (err) { toast(err); }
      else { Log.i('cfg', f.key + ' -> ' + next); afterChange(f); }
      renderSettings();
      return;
    }
    edit = { field: f, error: '' };
    screen = 'edit';
    renderEdit();
  }
  function commitEdit() {
    var input = $('editinput'), f = edit.field;
    var val = (input ? input.value : '').replace(/^\s+|\s+$/g, '');
    var err = Config.set(f.key, val);
    if (err) { edit.error = err; edit.value = val; renderEdit(); return; }
    Log.i('cfg', f.key + ' -> ' + val);
    afterChange(f);
    edit = null;
    screen = 'settings';
    renderSettings();
    refreshStatus();
  }
  function leaveSettings() {
    if (settingsMode === 'adv' && !settingsDirectAdv) { settingsMode = 'basic'; setSel = 0; renderSettings(); return; }
    if (settingsChanged) {
      settingsChanged = false;
      if (Config.isComplete()) { toast('Salvat. Se reconectează'); Sip.restart(); }
    }
    if (loginPending && login) { loginPending = false; screen = 'login'; renderLogin(); return; }
    loginPending = false;
    backToHome();
    refreshStatus();
  }

  /* ---------- call screen ---------- */
  function callStateText(c) {
    switch (c.state) {
      case 'calling': return 'Se apelează';
      case 'ringing': return 'Sună';
      case 'incoming': return 'Apel primit';
      case 'ended': return c.message || 'Apel încheiat';
      default: return '';
    }
  }
  function routeNow() {
    if (!Route.supported()) { return ''; }
    return 'Ieșire: ' + (Route.headphones() ? 'căști' : (Route.isSpeaker() ? 'difuzor' : 'ureche'));
  }
  function renderCall() {
    var c = Call.current();
    if (!c) { backToHome(); return; }
    var el = $('screen');
    clear(el);
    el.appendChild(div('dialnum callname', c.name || c.number));
    if (c.name) { el.appendChild(div('hint', c.number)); }
    el.appendChild(div('callstate', callStateText(c)));
    var timer = div('calltimer', c.state === 'incall' ? Util.fmtDuration((Date.now() - c.answeredAt) / 1000) : '');
    timer.id = 'calltimer';
    el.appendChild(timer);
    if (c.state === 'incall') {
      if (c.muted) { el.appendChild(div('hint', 'Microfon oprit')); }
      if (c.dtmf) { el.appendChild(div('hint', 'Cifre: ' + c.dtmf)); }
    }
    if (c.state !== 'incoming' && c.state !== 'ended') {
      var r = routeNow();
      if (r) { el.appendChild(div('hint', r)); }
    }
    if (c.state === 'incoming') { softkeys('Respinge', '', 'Răspunde'); }
    else if (c.state === 'incall') { softkeys(c.muted ? 'Mic pornit' : 'Mute', Route.label(), 'Închide'); }
    else if (c.state === 'ended') { softkeys('', '', ''); }
    else { softkeys('', Route.label(), 'Anulează'); }
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
      else if (k === 'Enter') { e.preventDefault(); Call.toggleRoute(); }
      else if (k === 'SoftRight' || k === 'End' || k === 'Back') { e.preventDefault(); Call.hangup(); }
    } else if (c.state === 'calling' || c.state === 'ringing') {
      if (k === 'Enter') { e.preventDefault(); Call.toggleRoute(); }
      else if (k === 'SoftRight' || k === 'End' || k === 'Back') { e.preventDefault(); Call.hangup(); }
    }
  }

  /* ---------- call log ---------- */
  function renderLog() {
    var el = $('screen');
    clear(el);
    heading(el, 'Jurnal apeluri');
    var list = CallLog.list();
    if (!list.length) { el.appendChild(div('hint', 'Niciun apel')); softkeys('Înapoi', '', ''); return; }
    if (logSel >= list.length) { logSel = list.length - 1; }
    var i, row, sel = null;
    for (i = 0; i < list.length; i++) {
      row = div('item' + (i === logSel ? ' sel' : ''), CallLog.label(list[i]));
      el.appendChild(row);
      if (i === logSel) { sel = row; }
    }
    if (sel && sel.scrollIntoView) { sel.scrollIntoView(false); }
    softkeys('Înapoi', 'Apelează', 'Opțiuni');
  }
  function logOptions() {
    var entry = CallLog.list()[logSel];
    var items = [];
    if (entry && !Contacts.findByNumber(entry.number)) {
      items.push({ label: 'Salvează în contacte', run: function () { ctx = null; openContactEdit(null, entry.number, 'log'); } });
    }
    items.push({ label: 'Șterge jurnalul', run: function () { CallLog.clear(); logSel = 0; closeCtx(); toast('Jurnal șters'); } });
    openCtx('Jurnal', items, 'log');
  }

  /* ---------- contacts ---------- */
  function openContacts() { screen = 'contacts'; ctSel = 0; renderContacts(); }
  function renderContacts() {
    var el = $('screen'), list = Contacts.list();
    clear(el);
    heading(el, 'Contacte');
    if (!list.length) {
      el.appendChild(div('hint', 'Niciun contact'));
      softkeys('Înapoi', '', 'Adaugă');
      return;
    }
    if (ctSel >= list.length) { ctSel = list.length - 1; }
    var i, row, sel = null;
    for (i = 0; i < list.length; i++) {
      row = div('item' + (i === ctSel ? ' sel' : ''));
      row.appendChild(div('v', list[i].name));
      row.appendChild(div('k', list[i].number));
      el.appendChild(row);
      if (i === ctSel) { sel = row; }
    }
    if (sel && sel.scrollIntoView) { sel.scrollIntoView(false); }
    softkeys('Înapoi', 'Apelează', 'Opțiuni');
  }
  function contactOptions() {
    var list = Contacts.list(), c = list[ctSel];
    var items = [{ label: 'Adaugă contact', run: function () { ctx = null; openContactEdit(null, '', 'contacts'); } }];
    if (c) {
      items.push({ label: 'Editează', run: function () { ctx = null; openContactEdit(c, '', 'contacts'); } });
      items.push({
        label: 'Șterge',
        run: function () {
          ctx = null;
          openConfirm('Ștergi „' + c.name + '”?', function () { Contacts.remove(c.id); toast('Șters'); }, 'contacts');
        }
      });
    }
    openCtx('Contact', items, 'contacts');
  }
  function openContactEdit(contact, prefillNumber, backTo) {
    ced = {
      id: contact ? contact.id : null, focus: 0, error: '',
      name: contact ? contact.name : '', number: contact ? contact.number : (prefillNumber || ''),
      back: backTo || 'contacts'
    };
    screen = 'contactedit';
    renderContactEdit();
  }
  function syncContact() {
    var a = $('cname'), b = $('cnum');
    if (a) { ced.name = a.value; }
    if (b) { ced.number = b.value; }
  }
  function renderContactEdit() {
    var el = $('screen');
    clear(el);
    heading(el, ced.id ? 'Editează contact' : 'Contact nou');
    el.appendChild(inputRow('Nume', 'cname', 'text', ced.name));
    el.appendChild(inputRow('Număr', 'cnum', 'tel', ced.number));
    if (ced.error) { el.appendChild(div('err', ced.error)); }
    focusEnd(ced.focus === 0 ? 'cname' : 'cnum');
    softkeys('Anulează', ced.focus === 0 ? 'Următorul' : 'Salvează', '');
  }
  function saveContact() {
    syncContact();
    var res = ced.id ? Contacts.update(ced.id, ced.name, ced.number) : Contacts.add(ced.name, ced.number);
    if (res.error) { ced.error = res.error; ced.focus = /nume/i.test(res.error) ? 0 : 1; renderContactEdit(); return; }
    var back = ced.back;
    ced = null;
    toast('Salvat');
    goto(back === 'log' ? 'log' : 'contacts');
  }

  /* ---------- account (login) ---------- */
  function syncLogin() {
    var a = $('loginext'), b = $('loginpass');
    if (a) { login.ext = a.value; }
    if (b) { login.pass = b.value; }
  }
  function renderLogin() {
    var el = $('screen');
    clear(el);
    heading(el, 'Cont SIP');
    el.appendChild(inputRow('Extensie', 'loginext', 'text', login.ext));
    el.appendChild(inputRow('Parolă', 'loginpass', login.reveal ? 'text' : 'password', login.pass));
    if (login.error) { el.appendChild(div('err', login.error)); }
    el.appendChild(div('hint', 'Server: ' + Config.get().domain));
    focusEnd(login.focus === 0 ? 'loginext' : 'loginpass');
    softkeys(login.reveal ? 'Ascunde' : 'Arată', login.focus === 0 ? 'Următorul' : 'Conectare', Config.isComplete() ? 'Anulează' : 'Setări');
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
    if (e1 || e2) { login.error = e1 || 'Completează parola'; login.focus = e1 ? 0 : 1; renderLogin(); return; }
    Config.set('extension', ext);
    Config.set('password', pass);
    Log.i('cfg', 'account saved ext=' + ext);
    login = null;
    authPrompted = false;
    toast('Se conectează');
    Sip.restart();
    backToHome();
    refreshStatus();
  }

  /* ---------- about ---------- */
  function renderAbout() {
    var el = $('screen'), c = Config.get();
    clear(el);
    heading(el, 'Despre');
    el.appendChild(div('item', 'KaiSIP ' + (window.KAISIP_VERSION || '?')));
    el.appendChild(div('item', 'Cont: ' + (c.extension || '-') + '@' + c.domain));
    el.appendChild(div('item', 'Server: ' + c.wssUrl));
    el.appendChild(div('item', 'Ureche/difuzor: ' + (Route.supported() ? 'da' : 'nu (doar difuzor)')));
    el.appendChild(div('item', 'JsSIP ' + (typeof JsSIP !== 'undefined' ? (JsSIP.version || '') : 'lipsă')));
    el.appendChild(div('item', 'Jurnal: ' + Log.fileName()));
    softkeys('Înapoi', '', '');
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
    return k || '';
  }
  function isDigit(k) { return /^[0-9*#]$/.test(k); }
  function wrap(i, n, d) { return (i + n + d) % n; }

  function onKey(e) {
    if (keyLogged < 40) { keyLogged++; Log.i('key', 'key=' + e.key + ' code=' + e.keyCode); }
    var k = norm(e), n;

    if (screen === 'call') { onCallKey(e, k); return; }

    if (screen === 'edit') {
      if (k === 'Enter') { e.preventDefault(); commitEdit(); }
      else if (k === 'SoftLeft') { e.preventDefault(); edit = null; screen = 'settings'; renderSettings(); }
      return;
    }

    if (screen === 'login') {
      if (k === 'Up') { e.preventDefault(); syncLogin(); login.focus = 0; renderLogin(); }
      else if (k === 'Down') { e.preventDefault(); syncLogin(); login.focus = 1; renderLogin(); }
      else if (k === 'Enter') { e.preventDefault(); if (login.focus === 0) { syncLogin(); login.focus = 1; renderLogin(); } else { submitLogin(); } }
      else if (k === 'SoftLeft') { e.preventDefault(); syncLogin(); login.reveal = !login.reveal; renderLogin(); }
      else if (k === 'SoftRight') {
        e.preventDefault(); syncLogin();
        if (Config.isComplete()) { login = null; backToHome(); refreshStatus(); }
        else { loginPending = true; openSettings('adv'); }
      }
      return;
    }

    if (screen === 'contactedit') {
      if (k === 'Up') { e.preventDefault(); syncContact(); ced.focus = 0; renderContactEdit(); }
      else if (k === 'Down') { e.preventDefault(); syncContact(); ced.focus = 1; renderContactEdit(); }
      else if (k === 'Enter') { e.preventDefault(); if (ced.focus === 0) { syncContact(); ced.focus = 1; renderContactEdit(); } else { saveContact(); } }
      else if (k === 'SoftLeft') { e.preventDefault(); var b = ced.back; ced = null; goto(b === 'log' ? 'log' : 'contacts'); }
      return;
    }

    if (screen === 'confirm') {
      if (k === 'SoftRight' || k === 'Enter') { e.preventDefault(); var yes = confirmBox.yes, back = confirmBox.back; confirmBox = null; yes(); goto(back); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); var back2 = confirmBox.back; confirmBox = null; goto(back2); }
      return;
    }

    if (screen === 'ctx') {
      n = ctx.items.length;
      if (k === 'Up') { e.preventDefault(); ctx.sel = wrap(ctx.sel, n, -1); renderCtx(); }
      else if (k === 'Down') { e.preventDefault(); ctx.sel = wrap(ctx.sel, n, 1); renderCtx(); }
      else if (k === 'Enter') { e.preventDefault(); ctx.items[ctx.sel].run(); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); closeCtx(); }
      return;
    }

    if (screen === 'contacts') {
      var cl = Contacts.list();
      if (k === 'Up' && cl.length) { e.preventDefault(); ctSel = wrap(ctSel, cl.length, -1); renderContacts(); }
      else if (k === 'Down' && cl.length) { e.preventDefault(); ctSel = wrap(ctSel, cl.length, 1); renderContacts(); }
      else if ((k === 'Enter' || k === 'Call') && cl.length) {
        e.preventDefault();
        var er = Call.dial(cl[ctSel].number);
        if (er) { toast(er); }
      }
      else if (k === 'SoftRight') { e.preventDefault(); if (cl.length) { contactOptions(); } else { openContactEdit(null, '', 'contacts'); } }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); backToHome(); }
      return;
    }

    if (screen === 'log') {
      var entries = CallLog.list();
      if (k === 'Up' && entries.length) { e.preventDefault(); logSel = wrap(logSel, entries.length, -1); renderLog(); }
      else if (k === 'Down' && entries.length) { e.preventDefault(); logSel = wrap(logSel, entries.length, 1); renderLog(); }
      else if ((k === 'Enter' || k === 'Call') && entries.length) {
        e.preventDefault();
        var er2 = Call.dial(entries[logSel].number);
        if (er2) { toast(er2); }
      }
      else if (k === 'SoftRight' && entries.length) { e.preventDefault(); logOptions(); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); backToHome(); }
      return;
    }

    if (screen === 'home') {
      if (isDigit(k)) { e.preventDefault(); if (dial.length < 24) { dial += k; renderHome(); } }
      else if (k === 'Back') { if (dial) { e.preventDefault(); dial = dial.slice(0, -1); renderHome(); } }
      else if (k === 'SoftLeft') { e.preventDefault(); openMenu(); }
      else if (k === 'SoftRight') { e.preventDefault(); openContacts(); }
      else if (k === 'Enter' || k === 'Call') {
        e.preventDefault();
        if (!dial) { toast('Scrie un număr'); }
        else { var err = Call.dial(dial); if (err) { toast(err); } else { dial = ''; } }
      }
      return;
    }

    if (screen === 'menu') {
      if (k === 'Up') { e.preventDefault(); menuSel = wrap(menuSel, MENU.length, -1); renderMenu(); }
      else if (k === 'Down') { e.preventDefault(); menuSel = wrap(menuSel, MENU.length, 1); renderMenu(); }
      else if (k === 'Enter') { e.preventDefault(); menuChoose(); }
      else if (k === 'SoftLeft' || k === 'Back') { e.preventDefault(); backToHome(); }
      return;
    }

    if (screen === 'settings') {
      var fields = fieldsNow();
      if (k === 'Up') { e.preventDefault(); setSel = wrap(setSel, fields.length, -1); renderSettings(); }
      else if (k === 'Down') { e.preventDefault(); setSel = wrap(setSel, fields.length, 1); renderSettings(); }
      else if (k === 'Enter') { e.preventDefault(); startEdit(fields[setSel]); }
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
      Call.on('new', function () { ctx = null; confirmBox = null; screen = 'call'; renderCall(); });
      Call.on('change', function () { if (screen === 'call') { renderCall(); } });
      Call.on('tick', function (c) {
        var t = $('calltimer');
        if (screen === 'call' && t && c && c.state === 'incall') { t.textContent = Util.fmtDuration((Date.now() - c.answeredAt) / 1000); }
      });
      Call.on('ended', function () { if (screen === 'call') { renderCall(); } });
      Call.on('cleared', function () { if (screen === 'call') { backToHome(); refreshStatus(); } });
      Route.onHeadphones(function () { if (screen === 'call') { renderCall(); } });
      renderHome();
      refreshStatus();
    },
    refreshStatus: refreshStatus,
    openSettings: openSettings,
    openLogin: openLogin,
    toast: toast
  };
}());
