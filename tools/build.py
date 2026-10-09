"""Pack app/ into dist/kaisip.zip (GerdaPkg / OmniSD layout: application.zip + metadata.json)."""
import os, struct, zlib, zipfile, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(DIST, 'kaisip.zip')


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
inner = os.path.join(DIST, 'application.zip')
count = 0
with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _dirs, files in os.walk(APP):
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, APP).replace(os.sep, '/')
            z.write(full, rel)
            count += 1

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(inner, 'application.zip')
    z.writestr('metadata.json', json.dumps({'version': 1, 'manifestURL': 'app://kaisip/manifest.webapp'}))
os.remove(inner)
print('built %s v%s: %d files, %d bytes' % (OUT, manifest['version'], count, os.path.getsize(OUT)))
