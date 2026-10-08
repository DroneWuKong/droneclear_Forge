"""Publish native CI artifacts only after checking both clean source revisions."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from tools.build_session_desktop import VERSION


def main(directory):
    directory = Path(directory)
    revision = os.environ['RELEASE_COMMIT']
    assets = []
    for platform in ('windows', 'linux'):
        stem = 'forge-uas-recorder-' + platform + '-x64'
        package = directory / (stem + '.zip')
        metadata = json.loads((directory / (stem + '.json')).read_text())
        digest = hashlib.sha256(package.read_bytes()).hexdigest()
        if (metadata['source_revision'] != revision or metadata['source_dirty']
                or metadata['version'] != VERSION or metadata['platform'] != platform
                or metadata['zip_sha256'] != digest
                or (directory / (stem + '.sha256')).read_text().split()[0] != digest):
            raise SystemExit('Artifact source/version/hash mismatch: ' + stem)
        with zipfile.ZipFile(package) as archive:
            name = 'Forge-UAS-Recorder' + ('.exe' if platform == 'windows' else '')
            if hashlib.sha256(archive.read(name)).hexdigest() != metadata['exe_sha256']:
                raise SystemExit('Executable hash mismatch: ' + stem)
            if json.loads(archive.read('BUILD.json')) != {k: v for k, v in metadata.items() if k != 'zip_sha256'}:
                raise SystemExit('Build metadata mismatch: ' + stem)
        assets.extend([package, directory / (stem + '.sha256'), directory / (stem + '.json')])
    tag = 'uas-recorder-v' + VERSION
    existing = subprocess.run(['gh', 'release', 'view', tag, '--json', 'assets,isDraft,targetCommitish'], capture_output=True, text=True)
    if existing.returncode == 0:
        # A version cannot be silently rebuilt from a different source commit.
        release = json.loads(existing.stdout)
        target = release['targetCommitish'] if release['isDraft'] else subprocess.check_output(
            ['gh', 'api', 'repos/' + os.environ['GH_REPO'] + '/git/ref/tags/' + tag,
             '--jq', '.object.sha'], text=True).strip()
        if target != revision:
            raise SystemExit('This release already belongs to another commit; increment VERSION and download links.')
        published = {asset['name'] for asset in release['assets']}
        with tempfile.TemporaryDirectory() as tmp:
            for asset in assets:
                if asset.name in published:
                    subprocess.run(['gh', 'release', 'download', tag, '--pattern', asset.name, '--dir', tmp], check=True)
                    if hashlib.sha256((Path(tmp) / asset.name).read_bytes()).digest() != hashlib.sha256(asset.read_bytes()).digest():
                        raise SystemExit('Existing asset differs; do not overwrite an immutable release: ' + asset.name)
        missing = [str(asset) for asset in assets if asset.name not in published]
        if missing:
            subprocess.run(['gh', 'release', 'upload', tag, *missing], check=True)
        if release['isDraft']:
            subprocess.run(['gh', 'release', 'edit', tag, '--draft=false'], check=True)
        return
    if 'release not found' not in existing.stderr.lower():
        raise SystemExit('Could not inspect release state: ' + existing.stderr)
    notes = f'''Free Forge UAS Session Recorder {VERSION} for Windows/Linux x64.

Extract the ZIP and run Forge-UAS-Recorder.exe (Windows), or chmod +x Forge-UAS-Recorder then ./Forge-UAS-Recorder (Linux). Keep the launcher open. Python and app assets are bundled; install Edge, Chrome or Chromium before field use. Linux is built on Ubuntu 22.04/glibc 2.35.

Record up to eight named windows/screens and cameras, one microphone and passive local MAVLink offline. Explicitly collect PX4/ArduPilot parameters and completed onboard logs over USB or bidirectional local UDP; signed or receive-only links use GCS exports. Wide/fullscreen windows use the available desktop space. Finished captures also save to .forge-uas-recorder/sessions under your home directory. Reopen disk copies, retain original logs and export support reports. PX4/Dronecode supports reviewed forum drafts; Betaflight provides official bug-form field copying and community routing. Select Live team view and share that window in your usual Teams/Google Meet meeting. Local recording continues when internet or the meeting drops.

Both native builds passed cold-start Chromium capture, three synthetic windows, two cameras, one audio stream, source interruption, local UDP parameter/log collection, fullscreen/reflow, disk save/update, fresh-profile reopen and replay with all non-loopback browser requests blocked. Packages include hashes, source/build metadata and runtime license notices. Executables are unsigned; physical hardware and live meeting/workspace integrations are not qualified by these software tests.

App and procedure: https://uas-forge.com/session-recorder/
Source commit: {revision}
'''
    with tempfile.TemporaryDirectory() as tmp:
        body = Path(tmp) / 'release.md'
        body.write_text(notes)
        subprocess.run(['gh', 'release', 'create', tag, *map(str, assets), '--target', revision,
                        '--title', 'UAS Session Recorder ' + VERSION + ' — multi-input offline recorder',
                        '--notes-file', str(body), '--latest=false', '--draft'], check=True)
        subprocess.run(['gh', 'release', 'edit', tag, '--draft=false'], check=True)


if __name__ == '__main__':
    main(sys.argv[1])
