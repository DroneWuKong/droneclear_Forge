from pathlib import Path
import tempfile
import unittest
from tools.pages_asset_limits import validate_pages_asset_sizes


class PagesAssetLimitsTests(unittest.TestCase):
    def test_exact_limit_passes_and_nested_oversize_reports_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'exact.json').write_bytes(b'x'*32)
            validate_pages_asset_sizes(root, maximum=32)
            (root/'static').mkdir()
            (root/'static'/'too-large.json').write_bytes(b'x'*33)
            with self.assertRaisesRegex(ValueError, r'static/too-large.json \(33 bytes\)'):
                validate_pages_asset_sizes(root, maximum=32)

    def test_compressed_extension_does_not_bypass_platform_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp)/'research_index.json.gzip').write_bytes(b'x'*33)
            with self.assertRaisesRegex(ValueError, 'research_index.json.gzip'):
                validate_pages_asset_sizes(tmp, maximum=32)
