"""Update an already installed packaged app in place, over adb with root, keeping its data (settings, contacts, messages).

Useful when the installer (GerdaPkg) refuses to reinstall an app that is already installed and the remote debugger is
not available. It replaces application.zip and manifest.webapp of the installed app and restarts the phone's UI (b2g).
The old files are saved next to this repository first.

usage: python tools/adb_update_app.py <adb-serial> <installed-app-id> <package.zip> [backup-dir]
  installed-app-id   the folder under /data/local/webapps, e.g. {08447e7d-0b3d-4ebe-9336-50c2db896018} or kaisip.local
  package.zip        a GerdaPkg style zip (application.zip + metadata.json) or a raw application.zip
Set ADB=<path to adb> when adb is not on PATH.
"""
import os, sys, io, json, subprocess, zipfile, hashlib, time

ADB = os.environ.get('ADB', 'adb')


def adb(serial, *args, check=True):
    env = dict(os.environ, MSYS_NO_PATHCONV='1')
    r = subprocess.run([ADB, '-s', serial] + list(args), capture_output=True, text=True, env=env)
    if check and r.returncode != 0:
        raise SystemExit('adb %s failed: %s' % (' '.join(args), (r.stderr or r.stdout).strip()))
    return (r.stdout or '').strip()


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    serial, app_id, package = sys.argv[1], sys.argv[2], sys.argv[3]
    backup = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dist', 'app-backup')

    outer = zipfile.ZipFile(package)
    inner = outer.read('application.zip') if 'application.zip' in outer.namelist() else open(package, 'rb').read()
    manifest = zipfile.ZipFile(io.BytesIO(inner)).read('manifest.webapp')
    version = json.loads(manifest.decode('utf-8-sig')).get('version')
    print('new package: version %s, %d bytes' % (version, len(inner)))

    folder = '/data/local/webapps/%s' % app_id
    if 'application.zip' not in adb(serial, 'shell', "ls '%s'" % folder, check=False):
        raise SystemExit('no installed app at %s (check the id with: adb shell ls /data/local/webapps)' % folder)

    os.makedirs(backup, exist_ok=True)
    for name in ('application.zip', 'manifest.webapp'):
        adb(serial, 'pull', '%s/%s' % (folder, name), os.path.join(backup, name))
    print('old files saved in', backup)

    tmp = os.path.join(backup, '_new')
    os.makedirs(tmp, exist_ok=True)
    open(os.path.join(tmp, 'application.zip'), 'wb').write(inner)
    open(os.path.join(tmp, 'manifest.webapp'), 'wb').write(manifest)
    adb(serial, 'push', os.path.join(tmp, 'application.zip'), '/data/local/tmp/_upd_application.zip')
    adb(serial, 'push', os.path.join(tmp, 'manifest.webapp'), '/data/local/tmp/_upd_manifest.webapp')

    # cp onto the existing files keeps their ownership and SELinux label
    adb(serial, 'shell', "stop b2g; sleep 3; cp /data/local/tmp/_upd_application.zip '%s/application.zip' && "
        "cp /data/local/tmp/_upd_manifest.webapp '%s/manifest.webapp'; rm -f /data/local/tmp/_upd_*; start b2g" % (folder, folder))
    time.sleep(12)
    got = adb(serial, 'shell', "busybox sha256sum '%s/application.zip'" % folder).split()[0]
    ok = got == hashlib.sha256(inner).hexdigest()
    print('installed file matches the package:', ok)
    print('b2g:', adb(serial, 'shell', 'getprop init.svc.b2g'))
    if not ok:
        raise SystemExit('hash mismatch: restore the backup from %s' % backup)


if __name__ == '__main__':
    main()
