import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from tools.public_brand_assets import write_brand_assets
from build_static import inject_seo


class PublicBrandAssetTests(unittest.TestCase):
    def test_generated_png_is_decodable_and_ico_directory_points_to_its_image(self):
        with tempfile.TemporaryDirectory() as folder:
            write_brand_assets(folder)
            icon = (Path(folder) / 'favicon.ico').read_bytes()
            self.assertEqual(icon[:6], b'\x00\x00\x01\x00\x01\x00')
            length, offset = struct.unpack_from('<II', icon, 14)
            self.assertEqual(offset, 22)
            self.assertEqual(icon[offset:offset + 8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(offset + length, len(icon))
            png = (Path(folder) / 'static' / 'og-image.png').read_bytes()
            self.assertEqual(struct.unpack_from('>II', png, 16), (1200, 630))
            compressed, index = b'', 8
            while index < len(png):
                size = struct.unpack_from('>I', png, index)[0]
                kind, data = png[index + 4:index + 8], png[index + 8:index + 8 + size]
                crc = struct.unpack_from('>I', png, index + 8 + size)[0]
                self.assertEqual(crc, zlib.crc32(kind + data) & 0xffffffff)
                if kind == b'IDAT': compressed += data
                index += size + 12
            pixels = zlib.decompress(compressed)
            self.assertEqual(len(pixels), 630 * (1 + 1200 * 4))
            self.assertIn(bytes((224, 179, 76, 255)), pixels)
            self.assertLess(len(png), 100000)

    def test_published_pages_reference_the_generated_resources(self):
        html = inject_seo('<html><head><title>Fixture</title></head><body></body></html>', 'fixture.html', 'fixture/index.html')
        self.assertIn('href="/favicon.ico"', html)
        self.assertIn('https://uas-forge.com/static/og-image.png', html)
        self.assertIn('content="UAS quadrotor mark"', html)


if __name__ == '__main__':
    unittest.main()
