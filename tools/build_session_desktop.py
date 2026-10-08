"""Bundle the field recorder on its target OS; no runtime downloads in the field.

PyInstaller runtime/data layout: https://pyinstaller.org/en/stable/runtime-information.html
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import zipfile

from tools.build_session_recorder import export_recorder

VERSION = '1.1.0'
ROOT = Path(__file__).resolve().parents[1]


def build(output):
    operating_system = {'Windows': 'windows', 'Linux': 'linux'}.get(platform.system())
    if operating_system is None or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise SystemExit('Build on Windows or Linux x64. Cross-compilation is not supported.')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    export_recorder(ROOT / 'forge-source', output / 'assets')
    package = output / 'app'
    package.mkdir(exist_ok=True)
    with zipfile.ZipFile(output / 'assets/session-recorder/forge-session-helper.zip') as archive:
        archive.extractall(package)
    name = 'Forge-UAS-Recorder'
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
                    '--onefile', '--console', '--name', name,
                    '--distpath', str(output / 'native'), '--workpath', str(output / 'work'),
                    '--specpath', str(output / 'spec'),
                    '--paths', str(ROOT / 'forge-source/session-helper'),
                    '--add-data', str(package) + ':app',
                    str(ROOT / 'forge-source/session-helper/desktop.py')], check=True, cwd=ROOT)
    executable = output / 'native' / (name + ('.exe' if operating_system == 'windows' else ''))
    stem = 'forge-uas-recorder-' + operating_system + '-x64'
    asset = output / (stem + '.zip')
    import PyInstaller
    licenses = {'LICENSE.txt': (package / 'LICENSE.txt').read_bytes()}
    distribution = importlib.metadata.distribution('PyInstaller')
    pyinstaller_license = next(distribution.locate_file(f) for f in distribution.files
                               if str(f).endswith('/licenses/COPYING.txt'))
    licenses['licenses/PyInstaller.txt'] = pyinstaller_license.read_bytes()
    # Python.org Windows/setup-python builds ship LICENSE.txt; Debian packages
    # keep their combined copyright/license notices under /usr/share/doc.
    python_minor = str(sys.version_info.major) + '.' + str(sys.version_info.minor)
    candidates = [Path(sys.base_prefix) / 'LICENSE.txt',
                  Path(sys.base_prefix) / 'lib' / ('python' + python_minor) / 'LICENSE.txt',
                  Path('/usr/share/doc') / ('python' + python_minor) / 'copyright']
    python_license = next((p for p in candidates if p.is_file()), None)
    if python_license is None:
        raise SystemExit('Python license was not found; include its notice before distributing this build.')
    licenses['licenses/Python.txt'] = python_license.read_bytes()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, text=True).strip())
    metadata = {'tool': 'forge-uas-recorder-desktop', 'version': VERSION,
                'source_revision': revision, 'source_dirty': dirty, 'platform': operating_system,
                'architecture': 'x64', 'python': platform.python_version(),
                'pyinstaller': PyInstaller.__version__, 'code_signed': False,
                'linux_baseline': platform.libc_ver() if operating_system == 'linux' else None,
                'exe_sha256': hashlib.sha256(executable.read_bytes()).hexdigest()}
    with zipfile.ZipFile(asset, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for filename, data in [(executable.name, executable.read_bytes()),
                               ('README.txt', (package / 'README.txt').read_bytes()),
                               ('LIVE_TEAM_GUIDE.txt', (package / 'LIVE_TEAM_GUIDE.txt').read_bytes()),
                               ('SOP.md', (package / 'SOP.md').read_bytes()),
                               ('BUILD.json', (json.dumps(metadata, indent=2) + '\n').encode()),
                               *licenses.items()]:
            info = zipfile.ZipInfo(filename, date_time=(2026, 10, 7, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if filename == executable.name else 0o644) << 16
            archive.writestr(info, data)
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    (output / (stem + '.sha256')).write_text(digest + '  ' + asset.name + '\n')
    (output / (stem + '.json')).write_text(json.dumps({**metadata, 'zip_sha256': digest}, indent=2) + '\n')
    print(json.dumps({'asset': str(asset), 'executable': str(executable), 'sha256': digest}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'build/session-desktop')
    build(parser.parse_args().output)
