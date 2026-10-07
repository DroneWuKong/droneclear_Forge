import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from tools.build_system_test_lab import export_toolkit, FILES

ROOT = Path(__file__).resolve().parents[1]
TOOLKIT = ROOT / 'forge-source/system-tests'
spec = importlib.util.spec_from_file_location('lab_runner', TOOLKIT / 'run_tests.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
CATALOG = json.loads((TOOLKIT / 'profiles.json').read_text())


class SystemTestLabTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.config = {'schema_version': 1, 'system': {'name': 'fixture', 'version': '1', 'source_commit': 'a' * 40}, 'artifacts': [], 'commands': {}, 'documents': {}}

    def run_profile(self, profile='general', execute=False):
        return runner.run(self.config, CATALOG, profile, self.root, execute, 'b' * 64)

    def row(self, report, identifier):
        return next(row for row in report['results'] if row['id'] == identifier)

    def test_unconfigured_system_does_not_gain_passes(self):
        self.config['system'] = {'name': '', 'version': '', 'source_commit': ''}
        report = self.run_profile()
        self.assertEqual(report['summary']['pass'], 0)
        self.assertEqual(report['summary']['blocked'], 8)
        self.assertEqual(self.row(report, 'G09')['status'], 'review_required')

    def test_release_drift_and_missing_files_fail(self):
        path = self.root / 'release.bin'; path.write_bytes(b'first')
        self.config['artifacts'] = [{'path': path.name, 'sha256': runner.digest(path)}]
        self.assertEqual(self.row(self.run_profile(), 'G02')['status'], 'pass')
        path.write_bytes(b'changed')
        self.assertEqual(self.row(self.run_profile(), 'G02')['status'], 'fail')
        path.unlink()
        self.assertEqual(self.row(self.run_profile(), 'G02')['status'], 'fail')

    def test_paths_cannot_escape_selected_system(self):
        with tempfile.TemporaryDirectory() as outside:
            path = Path(outside) / 'secret.bin'; path.write_bytes(b'outside')
            self.config['artifacts'] = [{'path': str(path), 'sha256': runner.digest(path)}]
            self.assertEqual(self.row(self.run_profile(), 'G02')['status'], 'blocked')
            if sys.platform != 'win32':
                (self.root / 'link.bin').symlink_to(path)
                self.config['artifacts'][0]['path'] = 'link.bin'
                self.assertEqual(self.row(self.run_profile(), 'G02')['status'], 'blocked')

    def test_command_requires_explicit_execution_and_keeps_output_private(self):
        self.config['commands']['smoke'] = {'argv': [sys.executable, '-c', 'print("PRIVATE-OUTPUT-FIXTURE")'], 'timeout_seconds': 3}
        self.assertEqual(self.row(self.run_profile(), 'G03')['status'], 'not_run')
        report = self.run_profile(execute=True)
        self.assertEqual(self.row(report, 'G03')['status'], 'pass')
        self.assertNotIn('PRIVATE-OUTPUT-FIXTURE', json.dumps(report))
        self.assertEqual(self.row(report, 'G03')['evidence'][0]['adapter_output_sha256'], hashlib.sha256(b'PRIVATE-OUTPUT-FIXTURE\n').hexdigest())

    def test_failed_adapter_and_timeout_remain_failed(self):
        self.config['commands']['smoke'] = {'argv': [sys.executable, '-c', 'raise SystemExit(5)'], 'timeout_seconds': 3}
        self.assertEqual(self.row(self.run_profile(execute=True), 'G03')['status'], 'fail')
        self.config['commands']['smoke'] = {'argv': [sys.executable, '-c', 'import time; time.sleep(5)'], 'timeout_seconds': .05}
        self.assertEqual(self.row(self.run_profile(execute=True), 'G03')['status'], 'fail')

    def test_document_presence_cannot_close_external_gates(self):
        document = self.root / 'manual.txt'; document.write_text('fixture')
        self.config['documents']['operator_manual'] = {'path': document.name, 'sha256': runner.digest(document)}
        report = self.run_profile('gauntlet')
        self.assertEqual(self.row(report, 'Q02')['status'], 'pass')
        self.assertEqual(self.row(report, 'Q06')['status'], 'review_required')
        self.assertEqual(self.row(report, 'Q07')['status'], 'external_required')
        self.assertIs(report['program_acceptance'], False)
        self.assertIs(report['certification'], False)

    def test_rfs_cannot_be_replaced_with_vendor_supplied_digest(self):
        document = self.root / 'fake-rfs.pdf'; document.write_bytes(b'not-the-reviewed-rfs')
        self.config['documents']['gauntlet_rfs'] = {'path': document.name, 'sha256': runner.digest(document)}
        self.assertEqual(self.row(self.run_profile('gauntlet'), 'Q01')['status'], 'fail')

    def test_json_rejects_duplicate_and_nonfinite_values(self):
        path = self.root / 'bad.json'
        for body in ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}']:
            path.write_text(body)
            with self.assertRaises(ValueError): runner.read_json(path)

    def test_cli_never_overwrites_an_existing_report(self):
        config = self.root / 'system.json'; config.write_text(json.dumps(self.config))
        output = self.root / 'report.json'; output.write_text('retain-existing-evidence')
        command = [sys.executable, str(TOOLKIT / 'run_tests.py'), '--config', str(config), '--system-root', str(self.root), '--output', str(output)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(output.read_text(), 'retain-existing-evidence')
        output.unlink()
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(output.read_text())['summary']['blocked'], 7)

    def test_package_is_reproducible_and_excludes_unlisted_files(self):
        hashes = export_toolkit(ROOT / 'forge-source', self.root / 'one')
        again = export_toolkit(ROOT / 'forge-source', self.root / 'two')
        self.assertEqual(hashes, again)
        archive = self.root / 'one/system-tests/forge-system-tests.zip'
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(package.namelist(), list(FILES))
            for name in FILES:
                self.assertEqual(hashlib.sha256(package.read(name)).hexdigest(), hashes[name])
        self.assertEqual(len(CATALOG['profiles']['general']['checks']), 9)
        self.assertEqual(len(runner.selected_checks(CATALOG, 'gauntlet')), 16)
        self.assertEqual(len(runner.selected_checks(CATALOG, 'dow')), 16)


if __name__ == '__main__':
    unittest.main()
