"""Release reuse must never overwrite or bless changed recorder inputs."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch
import zipfile

from tools import publish_session_desktop as publisher


class DesktopPublicationTests(unittest.TestCase):
    def make_artifacts(self, directory):
        for platform in ('windows', 'linux'):
            stem = 'forge-uas-recorder-' + platform + '-x64'
            executable = b'native-test-fixture'
            metadata = {
                'source_revision': 'new-source', 'source_dirty': False,
                'version': publisher.VERSION, 'platform': platform,
                'exe_sha256': hashlib.sha256(executable).hexdigest(),
            }
            package = directory / (stem + '.zip')
            with zipfile.ZipFile(package, 'w') as archive:
                archive.writestr('Forge-UAS-Recorder' + ('.exe' if platform == 'windows' else ''), executable)
                archive.writestr('BUILD.json', json.dumps(metadata))
            digest = hashlib.sha256(package.read_bytes()).hexdigest()
            metadata['zip_sha256'] = digest
            (directory / (stem + '.json')).write_text(json.dumps(metadata))
            (directory / (stem + '.sha256')).write_text(digest + '  ' + package.name)

    def invoke_existing(self, unchanged, draft=False):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.make_artifacts(directory)
            existing = {'assets': [], 'isDraft': draft, 'targetCommitish': 'old-source'}
            with patch.dict(publisher.os.environ, RELEASE_COMMIT='new-source', GH_REPO='owner/repo'), \
                 patch.object(publisher.subprocess, 'run', return_value=CompletedProcess([], 0, json.dumps(existing))) as run, \
                 patch.object(publisher.subprocess, 'check_output', return_value='old-source\n'), \
                 patch.object(publisher, 'recorder_sources_unchanged', return_value=unchanged) as compare:
                publisher.main(directory)
                self.assertEqual(run.call_count, 1)  # view only: no upload/edit/create
                compare.assert_called_once_with('old-source', 'new-source')

    def test_unchanged_release_is_preserved_without_writes(self):
        self.invoke_existing(unchanged=True)

    def test_changed_sources_require_a_new_version(self):
        with self.assertRaisesRegex(SystemExit, 'increment VERSION'):
            self.invoke_existing(unchanged=False)

    def test_draft_cannot_be_blessed_as_unchanged(self):
        with self.assertRaisesRegex(SystemExit, 'increment VERSION'):
            self.invoke_existing(unchanged=True, draft=True)

    def test_git_comparison_errors_fail_closed(self):
        with patch.object(publisher.subprocess, 'run', side_effect=[CompletedProcess([], 0), CompletedProcess([], 128)]):
            with self.assertRaisesRegex(SystemExit, 'Could not compare'):
                publisher.recorder_sources_unchanged('old', 'new')


if __name__ == '__main__':
    unittest.main()
