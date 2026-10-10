# PBX setup (Asterisk 22 + PJSIP + nginx)

KaiSIP is a WebRTC client: it speaks **SIP over WebSocket (WSS)** and sends audio with **SRTP/DTLS**. Your PBX
must expose a secure WebSocket endpoint that the phone's browser engine (Gecko 48, TLS 1.2) can reach.
The examples use `pbx.example.com`; replace it. They are a starting point, not a hardened production config.

## 1. Asterisk

`/etc/asterisk/http.conf` (loopback only; nginx terminates TLS in front of it):

```ini
[general]
servername=Asterisk
enabled=yes
bindaddr=127.0.0.1
bindport=8098
; an idle WebSocket is closed after session_inactivity ms (default 30000). The app sends a ping every 20 s,
; but in the "Economic" background mode the phone sleeps, so give it room:
session_inactivity=3600000
```

`/etc/asterisk/pjsip.conf` (or an included file):

```ini
[transport-ws]
type=transport
protocol=ws
bind=0.0.0.0

[206]
type=endpoint
transport=transport-ws
context=internal
disallow=all
allow=alaw
allow=ulaw
aors=206
auth=206
webrtc=yes                  ; DTLS-SRTP, ICE, rtcp-mux, AVPF
dtls_auto_generate_cert=yes
dtmf_mode=info              ; needed for DTMF, see below
rewrite_contact=yes
rtp_symmetric=yes
force_rport=yes

[206]
type=aor
max_contacts=1
remove_existing=yes
qualify_frequency=30

[206]
type=auth
auth_type=userpass
username=206
password=<a long random password>
```

`/etc/asterisk/rtp.conf`:

```ini
[general]
rtpstart=10000
rtpend=10100
icesupport=yes
stunaddr=stun.l.google.com:19302
```

Reload: `asterisk -rx "core reload"` and `asterisk -rx "module reload res_pjsip.so"`.
Open the RTP UDP range (10000-10100 above) in the firewall.

### DTMF

Gecko 48 cannot send RFC 4733 events, so KaiSIP sends **SIP INFO** (`application/dtmf-relay`).
That only works when the endpoint has `dtmf_mode=info`.

### Codecs

The phones offer opus, G.722, PCMU and PCMA; the example above uses PCMU/PCMA.

## 2. nginx (TLS 1.2 + 1.3, WebSocket proxy)

```nginx
location = /ws {
    proxy_pass http://127.0.0.1:8098/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

- The phone cannot speak TLS 1.3: keep `ssl_protocols TLSv1.2 TLSv1.3;` and an `ECDHE-RSA-AES128-GCM-SHA256`
  style suite.
- If `/ws` sits behind an SSO or auth proxy, exempt this path, otherwise the WebSocket upgrade gets a redirect.
- Rate-limit the path (`limit_req`, `limit_conn`) and ban repeat offenders: Asterisk sees every WebSocket peer
  as `127.0.0.1`, so its own fail2ban jail cannot tell clients apart; use the nginx access log instead.

## 3. The certificate must be trusted by the phone

KaiOS 2.5 ships an old root store. **Let's Encrypt's `ISRG Root X1` is not in the built-in store** (checked on a
Nokia 8110 4G with GerdaOS and on a stock Nokia 6300 4G, KaiOS 2.5.4). Check by opening
`https://your-server/` in the phone's browser. If it fails, either use a certificate from an older CA
(for example one chained to USERTrust or DigiCert) or add the root to the phone's certificate database
(`cert9.db`) with root access, see `tools/add_isrg_root.py`.

## 4. Push-to-talk (optional, KaiSIP phones only)

KaiSIP's **Walkie-talkie** screen places a short call to a *channel number* while you hold the OK key. On the PBX that
number pages a group: every member answers automatically and only listens.

`extensions.conf`, in the context your extensions use (here `internal`):

```
[internal]
exten => 700,1,NoOp(KaiSIP PTT channel)
 same => n,Page(PJSIP/206&PJSIP/207,ib(ptt-mark^s^1),20)
 same => n,Hangup()

[ptt-mark]
exten => s,1,Set(PJSIP_HEADER(add,X-KaiSIP-PTT)=1)
 same => n,Return()
```

Then `asterisk -rx "dialplan reload"`. Notes:

- `Page()` needs `app_page.so` and `app_confbridge.so` (`asterisk -rx "module show like page"`).
- Without the `d` option the page is one-way: the caller talks, the members listen.
- `b(ptt-mark^s^1)` adds the header `X-KaiSIP-PTT` to every outgoing leg. A phone answers by itself **only** if the call carries
  that header **and** the caller's extension is in the phone's **PTT members** setting; any other call rings normally. The
  auto-answer is receive-only: the phone's microphone is never opened.
- In the app: **Settings -> PTT channel** = `700`, **PTT members** = the extensions allowed to talk to this phone
  (for example `206,207`). Every phone of the group needs both settings.
- The sender is also in the page list in the example above; that leg is rejected as busy, which is harmless.

## 5. Quick check from a computer

```
curl -i --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Protocol: sip" https://pbx.example.com/ws
```

`HTTP/1.1 101 Switching Protocols` with `Sec-WebSocket-Protocol: sip` means the endpoint is reachable.
