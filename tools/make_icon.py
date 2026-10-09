"""Draw the KaiSIP icon (feature phone with radio waves) as 56x56 and 112x112 PNG, no dependencies.

usage: python make_icon.py <out_dir> [accent]   accent: green (default) | orange (diag)
"""
import math, struct, sys, zlib, os

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
ACCENT = sys.argv[2] if len(sys.argv) > 2 else 'green'
TOP, BOTTOM = {
    'green': ((38, 214, 140), (14, 104, 186)),
    'orange': ((255, 176, 59), (214, 74, 38)),
}[ACCENT]
DARK = (14, 62, 96)
SS = 4          # supersampling


def rrect(x, y, cx, cy, hx, hy, r):
    dx, dy = abs(x - cx) - (hx - r), abs(y - cy) - (hy - r)
    if dx <= 0 and dy <= 0:
        return True
    dx, dy = max(dx, 0), max(dy, 0)
    return dx * dx + dy * dy <= r * r


def arc(x, y, cx, cy, r, w, a0, a1):
    d = math.hypot(x - cx, y - cy)
    if abs(d - r) > w / 2:
        return False
    a = math.degrees(math.atan2(y - cy, x - cx)) % 360
    a0, a1 = a0 % 360, a1 % 360
    return (a0 <= a <= a1) if a0 <= a1 else (a >= a0 or a <= a1)


def pixel(x, y):
    """x, y in 0..1 -> (r, g, b, a) with a in 0..1"""
    if not rrect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22):
        return (0, 0, 0, 0.0)
    t = y
    col = tuple(TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3))
    # radio waves, left and right of the phone top
    for r, alpha in ((0.30, 0.95), (0.40, 0.55)):
        for a0, a1 in ((-32, 32), (148, 212)):
            if arc(x, y, 0.5, 0.32, r, 0.035, a0, a1):
                col = tuple(col[i] * (1 - alpha) + 255 * alpha for i in range(3))
    # phone body
    if rrect(x, y, 0.5, 0.54, 0.19, 0.33, 0.07):
        col = (255, 255, 255)
        if rrect(x, y, 0.5, 0.38, 0.14, 0.11, 0.03):          # screen
            col = DARK
        for kx in (0.40, 0.50, 0.60):                          # keypad
            for ky in (0.60, 0.69, 0.78):
                if (x - kx) ** 2 + (y - ky) ** 2 <= 0.028 ** 2:
                    col = DARK
    return (col[0], col[1], col[2], 1.0)


def render(size):
    rows = []
    n = size * SS
    samples = {}
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    X = (px * SS + sx + 0.5) / n
                    Y = (py * SS + sy + 0.5) / n
                    pr, pg, pb, pa = pixel(X, Y)
                    r += pr * pa; g += pg * pa; b += pb * pa; a += pa
            if a > 0:
                row += bytes((int(r / a), int(g / a), int(b / a), int(255 * a / (SS * SS))))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(b'\x00' + bytes(row))
    return rows


def write_png(path, size):
    raw = b''.join(render(size))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(data)
    print('wrote', path, len(data), 'bytes')


for s in (56, 112):
    write_png(os.path.join(OUT, 'icon-%d.png' % s), s)
