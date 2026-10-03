import json
import tempfile
import unittest
from pathlib import Path
import build_static
from tools.build_navigation import write_directory, ALIASES

class DirectoryTests(unittest.TestCase):
    def test_directory_covers_enabled_routes_and_excludes_private_and_duplicate_hubs(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp);(output/'static').mkdir()
            write_directory(build_static.PAGES,Path('forge-source'),output)
            rows=json.loads((output/'static/site-directory.json').read_text())
            paths={__import__('urllib.parse',fromlist=['urlparse']).urlparse(row['url']).path for row in rows}
            for destination in build_static.PAGES.values():
                route=destination.removesuffix('index.html').strip('/')
                if route.startswith('private') or route in ALIASES:continue
                self.assertIn('/'+route+'/' if route else '/',paths)
            self.assertFalse(any('/private/' in row['url'] for row in rows))
            self.assertEqual(len(rows),len({row['url'] for row in rows}))

if __name__=='__main__':unittest.main()
