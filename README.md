# KaiSIP

A **SIP softphone for KaiOS 2.5** feature phones (Nokia 8110 4G, 6300 4G and similar). It registers to your own
PBX over **SIP-over-WebSocket + WebRTC**, makes and receives voice calls, switches earpiece/speaker, has contacts
and a call log, and can stay connected in the background. Built with plain ES5 JavaScript and [JsSIP](https://jssip.net).

> *Pe scurt (RO):* client SIP pentru telefoane KaiOS 2.5. Se conectează la centrala ta (Asterisk etc.) prin WSS.
> Pachetele sunt la **Releases**; instrucțiunile de mai jos.

## Features

- Voice calls in both directions, hang up, reject, mute, **in-call DTMF** (SIP INFO), **volume 20-300%** (up/down keys)
- **Earpiece / speaker / headset** switching during a call (center key); needs the *certified* package
- Contacts (add, edit, delete), call log (last 20), names shown on incoming calls
- First-run **Account** screen: server, extension, password
- Background modes: **Off**, **Economic** (no permanent wake lock, alarm-based check), **Continuous** (wake lock)
- Logs to `sip-logs/` on the SD card (never contains passwords)

## What you need

1. A KaiOS 2.5 phone that lets you install your own apps (see *Install*).
2. A PBX with a WebSocket SIP endpoint, WebRTC enabled, TLS 1.2 and a certificate the phone trusts.
   See **[docs/PBX-SETUP.md](docs/PBX-SETUP.md)** (Asterisk 22 + nginx example).

## Download

Get the files from the **Releases** page. Each release has:

| File | Use it for |
|---|---|
| `kaisip-<v>-gerdapkg.zip` | **GerdaOS (GerdaPkg)**, OmniSD and similar installers. *Certified*: earpiece/speaker switching. **Start here.** |
| `kaisip-<v>-privileged-gerdapkg.zip` | Same installers, when your phone refuses certified apps. Call audio on the speaker/headset only. |
| `kaisip-<v>-application.zip` | The packaged app itself, for WebIDE, `tools/rdp_install.py` and tools that import an app zip. |
| `kaisip-diag-<v>-gerdapkg.zip` | Optional guided audio diagnostics (earpiece/speaker/volume tests). |
| `kaisip-<v>-source.zip` | Source of that release. |
| `SHA256SUMS.txt` | Checksums of all of the above. |

## Install

**GerdaOS (Nokia 8110 4G)** - copy `kaisip-<v>-gerdapkg.zip` to the SD card, open it from the file manager and
install it with **GerdaPkg**.

**Stock KaiOS 2.5 with a package installer (OmniSD, Wallace Toolbox)** - copy the zip to the SD card and use the
installer's "install package" entry. *Not reliable:* on a stock Nokia 6300 4G the Wallace Toolbox file picker would not
select the zip, so use the next method there.

**Over USB with ADB (any KaiOS 2.5 phone with debug mode)** - this is the most reliable way on stock firmware:

1. On the phone dial `*#*#33284#*#*` to enable debugging. Connect USB. `adb devices` must list it.
2. `python tools/rdp_install.py <adb-serial> install kaisip-<v>-gerdapkg.zip kaisip.local`
   (set `ADB=<path to adb>` if adb is not on your PATH). Installing again with the same id updates the app.

The certified build needs a phone that accepts certified apps; the debugger route allows it on the Nokia 6300 4G
(stock 2.5.4) and GerdaPkg allows it on the 8110. If a phone refuses, use the *privileged* package.

## First run

Open **KaiSIP**. The **Account** screen asks for:

- **Server** - `pbx.example.com` (becomes `wss://pbx.example.com/ws`; a full `wss://host:port/path` also works)
- **Extension** and **Password** (kept only on the phone)

The status bar turns green and says *Înregistrat* (registered). Type a number and press **Apel**.

## Keys

| Screen | Key | Action |
|---|---|---|
| Home | digits / Backspace | dial / delete |
| Home | green key or **Apel** (center) | call |
| Home | left / right softkey | Menu / Contacts |
| Incoming | green key / right softkey | answer |
| Incoming | left softkey / red key | reject |
| In call | digits, `*`, `#` | send DTMF |
| In call | **center** | earpiece <-> speaker |
| In call | up / down | volume (20% ... 300%) |
| In call | left softkey | mute |
| In call | right softkey / red key | hang up |

Menu: Account, Contacts, Call log, Settings (ring volume, background mode, default output, advanced), Reconnect, About.

## Background mode

- **Off** - connected while the app is open.
- **Economic** - the phone is not kept awake; a system alarm wakes it every 15 minutes to verify the connection and the
  registration lasts 30 minutes. The PBX must keep idle WebSockets open (`session_inactivity`, see PBX-SETUP).
  Experimental: whether incoming calls ring with the screen off depends on the phone and the network.
- **Continuous** - holds a CPU wake lock. Reliable, costs battery.

## Known limits

- KaiOS 2.5 only (Gecko 48). KaiOS 3 apps are a different platform.
- No push notifications: calls arrive while the app is connected (see background modes).
- Earpiece/speaker switching needs the certified package. On some phones the audio of a WebRTC stream ignores the usual
  audio channel; KaiSIP plays it through a small Web Audio bridge (`app/js/bridge.js`) that works on the tested phones.
- DTMF needs `dtmf_mode=info` on the PBX endpoint.
- Tested on Nokia 8110 4G (GerdaOS) and Nokia 6300 4G (KaiOS 2.5.4) against Asterisk 22. Other phones may differ.

## Security notes

- The password is stored in the app's `localStorage` on the phone. Use a dedicated extension with a long random password.
- A *certified* app has broad system privileges. Only install packages you built or downloaded from a source you trust
  and check them against `SHA256SUMS.txt`.
- Only `wss://` is accepted.

## Build from source

Requires Python 3 (no packages).

```
python tools/build.py                      # dist/kaisip.zip (certified, GerdaPkg layout)
python tools/build.py --variant privileged app dist/kaisip-privileged.zip
python tools/release.py                    # every format + SHA256SUMS.txt into dist/release/
```

Unit tests are plain HTML: serve the repository root (`python -m http.server`) and open `tests/index.html`; the title
shows `TESTS <n> pass 0 fail`.

Layout: `app/` the app (ES5), `tests/` unit tests, `tools/` build, release, installer, icon and diagnostics tools,
`docs/` PBX setup and the design spec.

## License

MIT, see [LICENSE](LICENSE). JsSIP (MIT) is bundled, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
