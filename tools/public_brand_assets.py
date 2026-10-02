"""Small deterministic public icons, generated without an imaging dependency."""
import struct
import zlib
from pathlib import Path


def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def mark_png(width, height):
    # The shared UAS mark is a quadrotor silhouette; no private data is drawn.
    rows = bytearray()
    scale = min(width, height)
    for y in range(height):
        rows.append(0)  # PNG filter: none
        dy = (y + .5 - height / 2) / scale
        for x in range(width):
            dx = (x + .5 - width / 2) / scale
            rotor = any(.043 ** 2 <= (dx - cx) ** 2 + (dy - cy) ** 2 <= .087 ** 2
                        for cx, cy in ((-.19, -.19), (.19, -.19), (-.19, .19), (.19, .19)))
            arm = abs(dx) < .2 and abs(dy) < .2 and min(abs(dx - dy), abs(dx + dy)) < .018
            body = abs(dx) + abs(dy) < .105
            ink = rotor or arm or body
            rows.extend((224, 179, 76, 255) if ink else (12, 12, 10, 255))
    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', header) + _chunk(b'IDAT', zlib.compress(rows, 9)) + _chunk(b'IEND', b'')


def write_brand_assets(root):
    root = Path(root)
    (root / 'static').mkdir(parents=True, exist_ok=True)
    png = mark_png(32, 32)
    ico = struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(png), 22) + png
    (root / 'favicon.ico').write_bytes(ico)
    (root / 'static' / 'og-image.png').write_bytes(mark_png(1200, 630))
