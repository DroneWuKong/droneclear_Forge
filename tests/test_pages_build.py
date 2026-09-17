import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('pages_build', Path(__file__).resolve().parents[1]/'tools/build_pages.py')
build=importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class PagesBuildTests(unittest.TestCase):
    def test_pin_skips_branch_lookup(self):
        with patch.dict(os.environ, {'AI_PROJECT_REF':'a'*40}, clear=True), patch.object(build.urllib.request,'urlopen') as network:
            self.assertEqual(build.resolve_ref(),'a'*40)
            network.assert_not_called()

    def test_invalid_pin_and_missing_credentials_fail_closed(self):
        for env in ({'AI_PROJECT_REF':'main'}, {}):
            with patch.dict(os.environ,env,clear=True),self.assertRaises(ValueError):
                build.resolve_ref()

    def test_branch_is_resolved_once(self):
        with patch.dict(os.environ,{'GITHUB_PAT':'test-only'},clear=True),patch.object(build.urllib.request,'urlopen',return_value=io.BytesIO(b'{"sha":"' + b'b'*40 + b'"}')) as network:
            self.assertEqual(build.resolve_ref(),'b'*40)
            network.assert_called_once()

    def test_production_build_includes_fail_closed_private_export(self):
        ref = 'c' * 40
        command = build.build_command(ref)
        self.assertEqual(command[:2], [build.sys.executable, str(build.ROOT/'build_static.py')])
        self.assertEqual(command[command.index('--data-ref') + 1], ref)
        self.assertIn('--include-private', command)
