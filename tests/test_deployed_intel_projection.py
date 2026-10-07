import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import hashlib


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

    def test_growing_unicode_corpus_fits_and_keeps_all_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'source.json', Path(tmp) / 'intel_articles.json'
            articles = [{'aid': str(i), 'summary': 'kept', 'url': f'https://example.org/{i}',
                         'body_text': '雪🚁' * 1500} for i in range(12)]
            source.write_text(json.dumps(articles), encoding='utf-8')
            original = source.read_bytes()
            source_sha = hashlib.sha256(original).hexdigest()
            manifest = {'inputs': {'intel-db/articles.json': {
                'destinations': ['intel_articles.json'], 'sha256': source_sha,
                'revision_verified': True, 'upstream_ref': 'a' * 40}}}
            manifest_path = Path(tmp) / 'publication_inputs.json'
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with patch.object(build, 'PAGES_MAX_ASSET_BYTES', 10000):
                build.copy_root_intel_file(source, output, 'intel_articles.json')
            deployed = json.loads(output.read_text(encoding='utf-8'))
            self.assertLessEqual(output.stat().st_size, 10000)
            self.assertEqual(len(deployed), len(articles))
            for before, after in zip(articles, deployed):
                for key in ('aid', 'summary', 'url'):
                    self.assertEqual(after[key], before[key])
                self.assertTrue(before['body_text'].startswith(after['body_text']))
                self.assertTrue(after['body_text_truncated'])
            row = json.loads(manifest_path.read_text())['inputs']['intel-db/articles.json']
            projection = row['projections']['intel_articles.json']
            self.assertEqual(row['sha256'], source_sha)
            self.assertEqual(projection['source_sha256'], source_sha)
            self.assertEqual(projection['sha256'], hashlib.sha256(output.read_bytes()).hexdigest())
            self.assertEqual(projection['article_count'], len(articles))
            self.assertLess(projection['body_prefix_chars'], build.DEPLOYED_ARTICLE_BODY_CHARS)
            self.assertEqual(projection['bytes'], output.stat().st_size)
            self.assertEqual(source.read_bytes(), original)
            first = output.read_bytes()
            with patch.object(build, 'PAGES_MAX_ASSET_BYTES', 10000):
                build.copy_root_intel_file(source, output, 'intel_articles.json')
            self.assertEqual(output.read_bytes(), first)

    def test_oversized_metadata_fails_without_overwriting_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'source.json', Path(tmp) / 'output.json'
            source.write_text(json.dumps([{'aid': 'kept', 'summary': 'x' * 1000,
                                          'body_text': 'body'}]), encoding='utf-8')
            output.write_bytes(b'previous')
            with patch.object(build, 'PAGES_MAX_ASSET_BYTES', 100):
                with self.assertRaisesRegex(ValueError, 'metadata alone'):
                    build.copy_root_intel_file(source, output, 'intel_articles.json')
            self.assertEqual(output.read_bytes(), b'previous')


if __name__ == '__main__':
    unittest.main()
