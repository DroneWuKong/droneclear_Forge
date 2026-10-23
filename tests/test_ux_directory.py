import json
import tempfile
import unittest
from pathlib import Path
import build_static
from tools.build_navigation import write_directory, ALIASES, RESEARCH

class DirectoryTests(unittest.TestCase):
    def test_directory_covers_enabled_routes_and_excludes_private_and_duplicate_hubs(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp);(output/'static').mkdir()
            (output/'tools-home').mkdir()
            (output/'tools-home/index.html').write_text(Path('forge-source/tools-home.html').read_text())
            write_directory(build_static.PAGES,Path('forge-source'),output)
            rows=json.loads((output/'static/site-directory.json').read_text())
            fallback=(output/'tools-home/index.html').read_text()
            paths={__import__('urllib.parse',fromlist=['urlparse']).urlparse(row['url']).path for row in rows}
            for destination in build_static.PAGES.values():
                route=destination.removesuffix('index.html').strip('/')
                if route.startswith('private') or route in ALIASES:continue
                self.assertIn('/'+route+'/' if route else '/',paths)
            self.assertFalse(any('/private/' in row['url'] for row in rows))
            self.assertEqual(len(rows),len({row['url'] for row in rows}))
            for row in rows:
                self.assertIn('href="'+row['url']+'"',fallback)
            self.assertNotIn('PUBLIC_TOOL_DIRECTORY',fallback)

    def test_specialist_research_is_one_click_from_home_and_menu(self):
        home=Path('forge-source/patterns-home.html').read_text()
        for route in ('adversary-bom','mirroring','actors','ttps','evasion','market-lens'):
            self.assertIn('href="/'+route+'/"',home)
            self.assertIn('href="https://uas-patterns.com/'+route+'/"',build_static._UNIFIED_NAV)
        self.assertIn('href="/tools-home/?area=Research"',home)
        self.assertIn('https://uas-patterns.com/tools-home/?area=Research',build_static._UNIFIED_NAV)

    def test_research_page_identity_matches_directory(self):
        for name,destination in build_static.PAGES.items():
            if destination.removesuffix('index.html').strip('/') not in RESEARCH or name=='clock.html':continue
            with self.subTest(page=name):
                built=build_static.inject_nav('<html><body></body></html>',name)
                self.assertIn('data-uas-area="research"',built)

if __name__=='__main__':unittest.main()
