"""Regression coverage for destructive shell rewriting and silent script failures."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import build_static as builder


class NavigationRewriteTests(unittest.TestCase):
    def test_intel_app_imports_survive_replacing_legacy_navigation(self):
        source = (Path(__file__).resolve().parents[1] / 'forge-source/intel.html').read_text()
        built = builder.inject_nav(source, 'intel.html')
        for asset in ('dossier-signals.js', 'intel-normalization.js', 'ask-pie-retrieval.js'):
            self.assertIn(f'<script src="/static/{asset}"></script>', built)
        self.assertIn('id="feed-search"', built)
        self.assertEqual(built.count('id="dc-drawer"'), 1)
        self.assertEqual(built.count('window.dcNavToggle ='), 1)
        twice = builder.inject_nav(built, 'intel.html')
        self.assertEqual(twice.count('id="dc-drawer"'), 1)
        self.assertEqual(twice.count('intel-normalization.js'), 1)

    def test_unmarked_shell_does_not_consume_interleaved_application_content(self):
        source = '''<html><body class="reference"><nav id="dc-nav"><a>Old</a></nav>
        <script src="/static/app.js"></script><div id="dc-overlay"></div>
        <div id="dc-drawer"><div><a>Old menu</a></div></div>
        <script>window.appReady = true;</script><main><h1>App</h1></main></body></html>'''
        built = builder.inject_nav(source, 'example.html')
        self.assertIn('<body class="reference">', built)
        self.assertIn('<script src="/static/app.js"></script>', built)
        self.assertIn('window.appReady = true', built)
        self.assertIn('<main><h1>App</h1></main>', built)
        self.assertEqual(built.count('id="dc-nav"'), 1)


class ScriptAssetTests(unittest.TestCase):
    def test_self_requesting_script_and_missing_asset_fail_build(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(builder, 'BUILD_DIR', temporary):
            for src in ('', '?v=2', '#x', '/static/missing.js'):
                with self.subTest(src=src), self.assertRaises(ValueError):
                    builder.validate_script_assets(f'<script src="{src}"></script>', 'audit/index.html')

    def test_nested_and_absolute_local_assets_resolve_without_touching_remote_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(builder, 'BUILD_DIR', temporary):
            root = Path(temporary); (root / 'static').mkdir()
            (root / 'static/app.js').write_text('window.appReady = true;')
            for src in ('/static/app.js?v=2', '../static/app.js', 'https://cdn.example/app.js'):
                builder.validate_script_assets(f'<script src="{src}"></script>', 'guide/index.html')


if __name__ == '__main__':
    unittest.main()
