import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('selector', ROOT / 'tools/select_lens_snapshot.py')
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.validator = self.root / 'validator.py'
        self.validator.write_text("import argparse,json,pathlib,sys\np=argparse.ArgumentParser()\np.add_argument('--data-dir');p.add_argument('--max-age-hours');p.add_argument('--max-source-age-days');p.add_argument('--sentinel');a=p.parse_args()\nr=pathlib.Path(a.data_dir)\nn=len(json.loads((r/'intel-db/articles.json').read_text()))\nsys.exit(0 if all(json.loads((r/(x+'.json')).read_text())['count']==n for x in " + repr(selector.NAMES) + ") else 1)\n")
        self.output = self.root / 'output'
        self.receipt = self.root / 'receipt.json'

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, count, *, derived=None):
        for path in selector.INPUTS:
            p = self.repo / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps([{}] * count if 'articles.json' in path else {'count': count if derived is None else derived}))
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@local', 'commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def test_current_consistent_snapshot_is_used(self):
        sha = self.commit(2)
        result = selector.select_snapshot(self.repo, self.validator, self.output, self.receipt)
        self.assertEqual(result['selected_revision'], sha)
        self.assertEqual(result['selection'], 'head')

    def test_partial_newer_input_keeps_earlier_complete_snapshot_and_discloses_it(self):
        good = self.commit(2)
        bad = self.commit(3, derived=2)
        result = selector.select_snapshot(self.repo, self.validator, self.output, self.receipt)
        self.assertEqual(result['selected_revision'], good)
        self.assertEqual(result['head_revision'], bad)
        self.assertEqual(self.git('rev-parse', 'HEAD'), bad)
        self.assertEqual(len(result['rejected_snapshots']), 1)
        self.assertEqual(json.loads((self.output/'actor_fingerprints.json').read_text())['count'], 2)

    def test_no_valid_snapshot_preserves_existing_files(self):
        self.commit(3, derived=2)
        self.output.mkdir()
        old = self.output/'actor_fingerprints.json'
        old.write_text('retained bytes')
        with self.assertRaisesRegex(RuntimeError, 'No fresh, consistent'):
            selector.select_snapshot(self.repo, self.validator, self.output, self.receipt)
        self.assertEqual(old.read_text(), 'retained bytes')
        self.assertFalse(self.receipt.exists())

    def test_missing_artifact_rejects_snapshot(self):
        self.commit(2)
        (self.repo/selector.INPUTS[0]).unlink()
        self.git('add', '.')
        self.git('-c','user.name=Fixture','-c','user.email=fixture@local','commit','-qm','missing')
        result = selector.select_snapshot(self.repo, self.validator, self.output, self.receipt)
        self.assertEqual(result['selection'], 'retained_validated_snapshot')


if __name__ == '__main__':
    unittest.main()
