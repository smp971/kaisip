"""Pack an app directory into a GerdaPkg / OmniSD style zip (application.zip + metadata.json).

usage: python build.py [appdir] [out.zip] [src:dest ...] [--variant privileged]
  appdir     default: <repo>/app
  out.zip    default: <repo>/dist/kaisip.zip
  src:dest   extra files copied into the package (src relative to the repo, dest inside the package)
  --variant privileged   build a non-certified package (no telephony permissions): speaker/headset only

Also importable: pack(appdir, out, extra=(), variant=None, raw_out=None) -> info dict.
"""
import os, sys, struct, zlib, zipfile, json, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERTIFIED_ONLY_PERMISSIONS = ('telephony', 'audio-channel-telephony')


def png(size, rgb=(0, 140, 70)):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def pack(appdir, out, extra=(), variant=None, raw_out=None):
    appdir, out = os.path.abspath(appdir), os.path.abspath(out)
    dist = os.path.dirname(out)
    os.makedirs(dist, exist_ok=True)
    for s in (56, 112):
        path = os.path.join(appdir, 'icon-%d.png' % s)
        if not os.path.exists(path):
            open(path, 'wb').write(png(s))

    manifest = json.load(open(os.path.join(appdir, 'manifest.webapp'), encoding='utf-8-sig'))
    if variant == 'privileged':
        manifest['type'] = 'privileged'
        for p in CERTIFIED_ONLY_PERMISSIONS:
            manifest.get('permissions', {}).pop(p, None)
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    slug = re.sub(r'[^a-z0-9]', '', manifest['name'].lower())

    inner = raw_out or os.path.join(dist, '_application.zip')
    count = 0
    with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _dirs, files in os.walk(appdir):
            for f in sorted(files):
                full = os.path.join(base, f)
                rel = os.path.relpath(full, appdir).replace(os.sep, '/')
                if rel == 'manifest.webapp':
                    z.writestr(rel, manifest_bytes)
                else:
                    z.write(full, rel)
                count += 1
        for src, dest in extra:
            z.write(os.path.join(ROOT, src), dest)
            count += 1

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(inner, 'application.zip')
        z.writestr('metadata.json', json.dumps({'version': 1, 'manifestURL': 'app://%s/manifest.webapp' % slug}))
    if raw_out is None:
        os.remove(inner)
    return {'version': manifest['version'], 'type': manifest.get('type'), 'files': count,
            'bytes': os.path.getsize(out), 'out': out, 'raw': raw_out}


if __name__ == '__main__':
    args = sys.argv[1:]
    variant = None
    if '--variant' in args:
        i = args.index('--variant')
        variant = args[i + 1]
        del args[i:i + 2]
    appdir = args[0] if len(args) > 0 else os.path.join(ROOT, 'app')
    out = args[1] if len(args) > 1 else os.path.join(ROOT, 'dist', 'kaisip.zip')
    extra = [a.split(':', 1) for a in args[2:]]
    info = pack(appdir, out, extra, variant)
    print('built %s v%s (%s): %d files, %d bytes' % (info['out'], info['version'], info['type'], info['files'], info['bytes']))
