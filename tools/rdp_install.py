"""Install / uninstall a packaged app on a KaiOS 2.5 phone through the remote debugger
(the same protocol WebIDE uses). Needs ADB, debug mode on (*#*#33284#*#*).

  python rdp_install.py <serial> install   <dist/kaisip.zip> <appId>
  python rdp_install.py <serial> uninstall <appId>
  python rdp_install.py <serial> list
"""
import socket, json, subprocess, sys, base64, zipfile, io, time

ADB = r'D:\ROMS\platform-tools-dl\platform-tools\adb.exe'
PORT = 6000


class RDP(object):
    def __init__(self, port):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=20)
        self.buf = b''

    def read(self):
        while True:
            i = self.buf.find(b':')
            if i > 0 and self.buf[:i].isdigit():
                n = int(self.buf[:i])
                if len(self.buf) >= i + 1 + n:
                    msg = self.buf[i + 1:i + 1 + n]
                    self.buf = self.buf[i + 1 + n:]
                    return json.loads(msg.decode('utf-8'))
            data = self.sock.recv(65536)
            if not data:
                raise EOFError('debugger connection closed')
            self.buf += data

    def send(self, obj):
        b = json.dumps(obj).encode('utf-8')
        self.sock.sendall(str(len(b)).encode() + b':' + b)

    def request(self, obj):
        self.send(obj)
        while True:
            m = self.read()
            if m.get('from') == obj['to'] and 'type' not in m or m.get('from') == obj['to'] and m.get('type') not in ('appOpen', 'appClose', 'appInstall', 'appUninstall', 'appUpdate'):
                return m


def connect(serial):
    subprocess.run([ADB, '-s', serial, 'forward', 'tcp:%d' % PORT, 'localfilesystem:/data/local/debugger-socket'], check=True)
    r = RDP(PORT)
    hello = r.read()
    print('server hello from=%s app=%s' % (hello.get('from'), hello.get('applicationType')))
    roots = r.request({'to': 'root', 'type': 'listTabs'})
    actor = roots.get('webappsActor')
    if not actor:
        raise SystemExit('no webappsActor in listTabs reply: keys=%s' % sorted(roots.keys()))
    print('webappsActor =', actor)
    return r, actor


def do_list(r, actor):
    res = r.request({'to': actor, 'type': 'getAll'})
    for a in res.get('apps', []):
        print(' %-45s status=%s origin=%s' % (a.get('name'), a.get('appStatus'), a.get('origin')))


def do_install(r, actor, zip_path, app_id):
    outer = zipfile.ZipFile(zip_path)
    inner = outer.read('application.zip') if 'application.zip' in outer.namelist() else open(zip_path, 'rb').read()
    print('package: %d bytes' % len(inner))
    up = r.request({'to': actor, 'type': 'uploadPackage'})
    if 'actor' not in up:
        raise SystemExit('uploadPackage failed: %s' % up)
    uploader = up['actor']
    print('upload actor =', uploader)
    CH = 24 * 1024
    for off in range(0, len(inner), CH):
        # PackageUploadJSONActor.chunk reads chunk.charCodeAt(i) as a byte: send a binary string (latin-1), not base64
        piece = inner[off:off + CH].decode('latin-1')
        res = r.request({'to': uploader, 'type': 'chunk', 'chunk': piece})
        if 'error' in res:
            raise SystemExit('chunk error: %s' % res)
    res = r.request({'to': uploader, 'type': 'done'})
    if 'error' in res:
        raise SystemExit('done error: %s' % res)
    print('upload complete, installing as', app_id)
    res = r.request({'to': actor, 'type': 'install', 'appId': app_id, 'upload': uploader})
    print('install reply:', json.dumps(res)[:400])
    if 'error' in res or res.get('success') is False:
        raise SystemExit('INSTALL FAILED')
    # wait for installation notification, then list
    time.sleep(2)
    do_list(r, actor)


def do_uninstall(r, actor, app_id):
    res = r.request({'to': actor, 'type': 'uninstall', 'manifestURL': 'app://%s/manifest.webapp' % app_id})
    print('uninstall reply:', json.dumps(res)[:300])


if __name__ == '__main__':
    serial, cmd = sys.argv[1], sys.argv[2]
    rdp, actor = connect(serial)
    if cmd == 'list':
        do_list(rdp, actor)
    elif cmd == 'install':
        do_install(rdp, actor, sys.argv[3], sys.argv[4])
    elif cmd == 'uninstall':
        do_uninstall(rdp, actor, sys.argv[3])
