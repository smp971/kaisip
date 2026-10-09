"""Pack an app directory into a GerdaPkg / OmniSD style zip (application.zip + metadata.json).

usage: python build.py [appdir] [out.zip] [src:dest ...]
  appdir   default: <repo>/app
  out.zip  default: <repo>/dist/kaisip.zip
  src:dest extra files copied into the package (src relative to the repo, dest inside the package)
manifestURL is taken from the manifest 'origin' field if present, else app://<name-in-lowercase>
"""
import os, sys, struct, zlib, zipfile, json, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'app')
OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'dist', 'kaisip.zip')
EXTRA = [a.split(':', 1) for a in sys.argv[3:]]
DIST = os.path.dirname(OUT)


def png(size, rgb=(0, 140, 70)):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


os.makedirs(DIST, exist_ok=True)
for s in (56, 112):
    path = os.path.join(APP, 'icon-%d.png' % s)
    if not os.path.exists(path):
        open(path, 'wb').write(png(s))

manifest = json.load(open(os.path.join(APP, 'manifest.webapp'), encoding='utf-8-sig'))
slug = re.sub(r'[^a-z0-9]', '', manifest['name'].lower())
inner = os.path.join(DIST, '_application.zip')
count = 0
with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _dirs, files in os.walk(APP):
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, APP).replace(os.sep, '/')
            z.write(full, rel)
            count += 1
    for src, dest in EXTRA:
        z.write(os.path.join(ROOT, src), dest)
        count += 1

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(inner, 'application.zip')
    z.writestr('metadata.json', json.dumps({'version': 1, 'manifestURL': 'app://%s/manifest.webapp' % slug}))
os.remove(inner)
print('built %s v%s (%s): %d files, %d bytes' % (OUT, manifest['version'], manifest.get('type'), count, os.path.getsize(OUT)))
