import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_static as builder


class AssetVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'static').mkdir()
        self.directory = patch.object(builder, 'BUILD_DIR', str(self.root))
        self.directory.start()
        builder._ASSET_HASH_CACHE.clear()

    def tearDown(self):
        self.directory.stop()
        builder._ASSET_HASH_CACHE.clear()
        self.temp.cleanup()

    def write(self, name, text):
        (self.root / 'static' / name).write_text(text, encoding='utf-8')

    def test_manual_versions_are_replaced_for_scripts_styles_and_modules(self):
        for name in ['view.js', 'view.mjs', 'view.css']:
            self.write(name, 'version one')
            source = f'<script src="/static/{name}?mode=compact&amp;v=1#example"></script>'
            actual = builder.add_asset_cache_busters(source)
            self.assertRegex(actual, r'\?mode=compact&amp;v=[0-9a-f]{8}#example')
            self.assertNotIn('&amp;v=1#', actual)
            self.assertEqual(builder.add_asset_cache_busters(actual), actual)

    def test_relative_and_single_quoted_references_work_without_rewriting_external_urls(self):
        self.write('view.mjs', 'export const value=1;')
        actual = builder.add_asset_cache_busters("<script src='../static/view.mjs?v=1'></script>")
        self.assertRegex(actual, r"src='../static/view.mjs\?v=[0-9a-f]{8}'")
        for source in ['<script src="https://example.org/static/view.mjs?v=1"></script>',
                       '<link href="/static/missing.css?v=1">']:
            self.assertEqual(builder.add_asset_cache_busters(source), source)

    def build_modules(self, leaf):
        self.write('entry.mjs', "import {value} from './middle.mjs'; export {value};")
        self.write('middle.mjs', "export {value} from './leaf.mjs?mode=one';")
        self.write('leaf.mjs', leaf)
        builder.version_script_dependencies()
        return (
            builder.add_asset_cache_busters('<script src="/static/entry.mjs?v=1"></script>'),
            (self.root / 'static' / 'entry.mjs').read_text(encoding='utf-8'),
            (self.root / 'static' / 'middle.mjs').read_text(encoding='utf-8'),
        )

    def test_dependency_only_change_invalidates_entrypoint_and_transitive_imports(self):
        first = self.build_modules('export const value=1;')
        self.assertEqual(first, self.build_modules('export const value=1;'))
        second = self.build_modules('export const value=2;')
        for before, after in zip(first, second):
            self.assertNotEqual(before, after)
        self.assertRegex(second[1], r"middle.mjs\?v=[0-9a-f]{16}")
        self.assertRegex(second[2], r"leaf.mjs\?mode=one&v=[0-9a-f]{16}")

    def test_cycles_and_dynamic_imports_share_a_version_without_recursive_hashes(self):
        self.write('a.mjs', "import './b.mjs'; const later=import('./b.mjs');")
        self.write('b.mjs', "export * from './a.mjs';")
        builder.version_script_dependencies()
        combined = ''.join((self.root/'static'/name).read_text(encoding='utf-8') for name in ['a.mjs', 'b.mjs'])
        versions = re.findall(r'\?v=([0-9a-f]{16})', combined)
        self.assertEqual(len(versions), 3)
        self.assertEqual(len(set(versions)), 1)

    def test_unknown_import_targets_and_external_modules_stay_unchanged(self):
        source = "import './missing.mjs'; import 'https://example.org/remote.mjs'; import './plain.js';"
        self.write('entry.mjs', source)
        builder.version_script_dependencies()
        self.assertEqual((self.root/'static/entry.mjs').read_text(encoding='utf-8'), source)

    def test_dynamic_dossier_child_update_changes_loader_and_parent_url(self):
        def build(child):
            self.write('dossier-signals.js', "const script=document.createElement('script'); script.src = '/static/record-dossiers.js';")
            self.write('record-dossiers.js', child)
            builder.version_script_dependencies()
            return (
                builder.add_asset_cache_busters('<script src="/static/dossier-signals.js?v=1"></script>'),
                (self.root/'static/dossier-signals.js').read_text(encoding='utf-8'),
            )
        before = build('const relationshipLanding=false;')
        after = build('const relationshipLanding=true;')
        self.assertNotEqual(before[0], after[0])
        self.assertNotEqual(before[1], after[1])
        self.assertRegex(after[1], r'record-dossiers.js\?v=[0-9a-f]{16}')


if __name__ == '__main__':
    unittest.main()
