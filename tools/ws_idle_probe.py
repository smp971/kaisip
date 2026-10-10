"""Open a SIP WebSocket, send one SIP OPTIONS request, then stay idle and report when the server closes it.
usage: python tools/ws_idle_probe.py <host> [path=/ws] [max_seconds=120] [keepalive_seconds=0] [--no-sip]
--no-sip skips the OPTIONS request: Asterisk closes a connection that never sent a SIP request after about 32 s,
so an idle probe without a request says nothing about how KaiSIP behaves.
With keepalive_seconds the probe also sends the CRLF CRLF text frame the app sends.
Economic background mode needs the server to keep a registered idle socket open longer than the phone's check interval.
Git Bash on Windows rewrites a leading /ws: run with MSYS_NO_PATHCONV=1."""
import socket, ssl, sys, time, base64, os, uuid

args = [a for a in sys.argv[1:] if not a.startswith('--')]
send_sip = '--no-sip' not in sys.argv
host = args[0]
path = args[1] if len(args) > 1 else '/ws'
limit = int(args[2]) if len(args) > 2 else 120
keep = int(args[3]) if len(args) > 3 else 0
s = ssl.create_default_context().wrap_socket(socket.create_connection((host, 443), 10), server_hostname=host)
key = base64.b64encode(os.urandom(16)).decode()
s.sendall(('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
           'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: sip\r\n\r\n' % (path, host, key)).encode())
head = s.recv(4096).split(b'\r\n')[0].decode()
print(head)
if ' 101 ' not in head:
    sys.exit(1)

CRLF2 = b'\r' + b'\n' + b'\r' + b'\n'


def frame(payload):
    mask = os.urandom(4)
    n = len(payload)
    hdr = bytes([0x81, 0x80 | n]) if n < 126 else bytes([0x81, 0x80 | 126, n >> 8, n & 255])
    return hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


def read_frames(data):
    """first frame's opcode and payload text (server frames are unmasked)"""
    if len(data) < 2:
        return None, ''
    op, n, off = data[0] & 0x0f, data[1] & 0x7f, 2
    if n == 126:
        n, off = (data[2] << 8) | data[3], 4
    return op, data[off:off + n].decode('utf-8', 'replace')


s.settimeout(5)
if send_sip:
    cid = uuid.uuid4().hex
    msg = ('OPTIONS sip:%s SIP/2.0\r\nVia: SIP/2.0/WSS probe.invalid;branch=z9hG4bK%s\r\nMax-Forwards: 70\r\n'
           'From: <sip:probe@%s>;tag=%s\r\nTo: <sip:%s>\r\nCall-ID: %s\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n'
           % (host, uuid.uuid4().hex[:10], host, uuid.uuid4().hex[:8], host, cid))
    s.sendall(frame(msg.encode()))
    try:
        op, text = read_frames(s.recv(4096))
        print('SIP answer: ' + (text.split('\r\n')[0] if text else '(none)'))
    except socket.timeout:
        print('no SIP answer in 5 s')

t0 = time.time()
last = t0
s.settimeout(1)
while time.time() - t0 < limit:
    if keep and time.time() - last >= keep:
        s.sendall(frame(CRLF2))
        last = time.time()
    try:
        d = s.recv(4096)
        if not d:
            print('closed by the server after %.0f s' % (time.time() - t0)); sys.exit(0)
        if d[0] & 0x0f == 8:
            print('close frame after %.0f s' % (time.time() - t0)); sys.exit(0)
    except socket.timeout:
        pass
    except OSError as e:
        print('connection error after %.0f s: %s' % (time.time() - t0, e)); sys.exit(0)
print('still open after %d s' % limit)
