import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    'build_static', Path(__file__).resolve().parents[1] / 'build_static.py'
)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class DeployedIntelProjectionTests(unittest.TestCase):
    def test_article_fallback_is_compact_and_body_bounded(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.json'
            output = Path(tmp) / 'output.json'
            long_body = 'x' * (build.DEPLOYED_ARTICLE_BODY_CHARS + 25)
            source.write_text(
                json.dumps([
                    {'aid': 'long', 'summary': 'kept', 'body_text': long_body},
                    {'aid': 'short', 'body_text': 'complete'},
                ], indent=2),
                encoding='utf-8',
            )

            build.copy_root_intel_file(source, output, 'intel_articles.json')

            deployed = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(deployed[0]['summary'], 'kept')
            self.assertEqual(
                len(deployed[0]['body_text']), build.DEPLOYED_ARTICLE_BODY_CHARS
            )
            self.assertTrue(deployed[0]['body_text_truncated'])
            self.assertEqual(deployed[1]['body_text'], 'complete')
            self.assertNotIn('body_text_truncated', deployed[1])
            self.assertEqual(len(json.loads(source.read_text())[0]['body_text']), len(long_body))
            self.assertLess(output.stat().st_size, source.stat().st_size)
            self.assertLessEqual(output.stat().st_size, build.PAGES_MAX_ASSET_BYTES)

    def test_non_article_fallback_is_copied_verbatim(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.json'
            output = Path(tmp) / 'output.json'
            source.write_bytes(b'{"value": 1}\n')

            build.copy_root_intel_file(source, output, 'intel_companies.json')

            self.assertEqual(output.read_bytes(), source.read_bytes())


if __name__ == '__main__':
    unittest.main()
