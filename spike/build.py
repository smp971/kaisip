import os, struct, zlib, zipfile

APP = r'D:\ROMS\kaios-sip\spike\app'
OUT = r'D:\ROMS\kaios-sip\spike\sip-spike.zip'


def png(size, rgb=(0, 160, 60)):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


for s in (56, 112):
    open(os.path.join(APP, 'icon-%d.png' % s), 'wb').write(png(s))

app_zip = os.path.join(os.path.dirname(OUT), 'application.zip')
with zipfile.ZipFile(app_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(APP)):
        z.write(os.path.join(APP, name), name)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(app_zip, 'application.zip')
    z.writestr('metadata.json', '{ "version": 1, "manifestURL": "app://sip-spike/manifest.webapp" }')
os.remove(app_zip)
print('built', OUT, os.path.getsize(OUT), 'bytes')
