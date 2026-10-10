# KaiSIP — SIP client for KaiOS 2.5 (Nokia 8110 4G / GerdaOS)

Date: 2026-10-09 · Status: design approved by the user, section by section, in chat.

## 1. Goal

A voice SIP client that runs as a privileged KaiOS 2.5 app (Gecko 48) on a Nokia 8110 4G
with GerdaOS, installed through GerdaPkg. It registers to an Asterisk 22 PBX
(`pbx.example.com`, PJSIP, extension 206 "KaiOS 8110") over **SIP-over-WebSocket + WebRTC audio**,
makes and receives calls, and can optionally stay connected in the background.

Non-goals for v1: phone contacts, messaging, video, conference, call transfer.

## 2. Feasibility (spike results, 2026-10-09)

Measured on the device:

| Item | Result |
|---|---|
| Engine | `Mozilla/5.0 (Mobile; Nokia_8110_4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5` |
| WebRTC | `RTCPeerConnection`, `mediaDevices.getUserMedia` (mic OK), DTLS-SRTP, rtcp-mux, ICE; STUN gives `srflx` candidates |
| Codecs offered | opus, G722, PCMU, PCMA, iLBC (PBX allows alaw/ulaw) |
| Sockets | no `TCPSocket` / `UDPSocket` → WebSocket is the only transport |
| TLS | phone has no ISRG roots; `ISRG Root X1` was imported into `cert9.db`; `wss://pbx.example.com/ws` → `OPEN`, protocol `sip` |
| Background | `requestWakeLock('cpu')` alone kept 10 s timers exact for ~16 min; silent-audio keep-alive added nothing |
| Server idle | Asterisk closes an idle WebSocket after ~25–30 s (`session_inactivity`) |

Server side (done): Asterisk HTTP on `127.0.0.1:8098`, `transport-ws`, extension 206 with
`webrtc=yes`, nginx `location = /ws` with SSOWAT bypass, TLS 1.2+1.3, RTP 10000–10100 open.

## 3. Architecture

ES5 only (Gecko 48). JsSIP for SIP signalling, native WebRTC for audio.

Modules (each one file, one purpose):

- `log.js` — buffered logger; writes one file per run into `sip-logs/` on the SD card
  (`appendNamed` when available, otherwise rewrite on a debounce); mirrors to screen.
- `config.js` — settings in `localStorage` (server WSS URL, SIP domain, extension, password,
  STUN, background mode, ringtone volume). Password is entered on the phone, never in code.
- `sip.js` — wraps JsSIP: UA lifecycle, registration, reconnect with backoff (2→60 s),
  CRLF keep-alive every ~20 s, `online`/`offline` handling, call sessions, DTMF.
- `audio.js` — remote stream playback (`Audio`, `mozAudioChannelType='content'`,
  `mozSrcObject` with `srcObject` fallback), ringtone loop, vibration.
- `background.js` — background mode Off/On: On = `wake-lock cpu` + keep-alive + `mozAlarms`
  safety net for reconnect. Default Off.
- `calllog.js` — last 20 calls (in/out/missed) in `localStorage`.
- `errors.js` — SIP/WebRTC error → short message table (Romanian).
- `ui.js` — screens and softkeys. `app.js` wires everything.

## 4. Screens and keys (240×320, softkeys Left / Center / Right)

- **Home / dial**: registration state (Registered / Connecting / Offline / Auth error) + own number;
  digits typed directly; Backspace deletes. Softkeys: Menu · Call · Settings. Green key = call.
- **Incoming**: ringtone + vibration + caller number. Left = Reject, Right/green = Answer.
- **In call**: timer; digits/`*`/`#` send DTMF. Left = Mute, Center = Speaker/Headset, Right/red = Hang up.
- **Call log**: last 20, call from the list.
- **Settings**: WSS server, SIP domain, extension, password, background mode, STUN, ringtone volume.

Audio: v1 plays on speaker/headset (content channel). Earpiece needs the `telephony` channel
(certified); to be tested in M0, accepted as a v1 limitation if it does not work.

## 5. SIP / WebRTC behaviour

- WSS to `wss://pbx.example.com/ws`, user = extension, domain `pbx.example.com`, register expires ~120 s.
- Calls: audio only, `getUserMedia({audio:true})`, STUN `stun.l.google.com:19302`.
- Errors shown briefly: wrong password (401/403), unknown number (404), busy (486),
  no answer (408/480), mic refused, network down.
- Missed call in background: vibration + system notification + call log entry.
- Dialled numbers are filtered to `0-9 * # +`.
- JsSIP must first be proven to run on Gecko 48 (M0/M1). Fallback: a minimal in-house SIP stack.

## 6. Testing

- Pure logic (number filter, state machine, call log, error table, config) is unit-tested on the
  PC in a small HTML page in the in-app browser (no Node required).
- On device: a Diagnostic screen and the `sip-logs/` file, read over ADB.
- Hardware checklist with a second client (Linphone or extension 207): register on 206;
  call 500 (echo test); 207→206 and 206→207 with mute/DTMF/hang-up from both sides;
  reject and missed call; background on/off; reconnect after Wi-Fi off/on; 1 h battery drain.

## 7. Milestones (each shipped and checked on the phone)

- **M0** audio routing test (earpiece vs speaker) and JsSIP loading on Gecko 48; logger to `sip-logs/`.
- **M1** registration + home screen.
- **M2** outgoing call (500, then 207).
- **M3** incoming call, ringtone, vibration.
- **M4** background mode, keep-alive, reconnect.
- **M5** call log, full settings, polish.

## 8. Build and install

`tools/build.py` packs `app/` into `dist/kaisip.zip` (GerdaPkg/OmniSD layout:
`application.zip` + `metadata.json`), `adb push` to the SD card, install with GerdaPkg.
Versions `0.1.x`. No secrets in the package.

## 9. Related server notes (not part of the app)

- Raise `session_inactivity` in Asterisk `http.conf`.
- `/ws` is public: add nginx `limit_req`/`limit_conn` and a fail2ban jail on the nginx log
  (Asterisk sees WebSocket peers as 127.0.0.1).
- Findings from the MiniPBX WebUI audit are tracked separately.
