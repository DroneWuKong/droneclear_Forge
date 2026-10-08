"""Build the allowlisted, reproducible local recorder and stdlib helper."""
import hashlib
import re
from pathlib import Path
import zipfile

ASSETS = ('workspace.css', 'session-recorder.css', 'session-recorder.js',
          'session-evidence.js', 'session-reports.js', 'session-store.js',
          'test-lab.js', 'session-recorder-icon.svg')


def export_recorder(source, output):
    source, output = Path(source), Path(output) / 'session-recorder'
    output.mkdir(parents=True, exist_ok=True)
    contents = {
        'bridge.py': (source / 'session-helper/bridge.py').read_bytes(),
        'desktop.py': (source / 'session-helper/desktop.py').read_bytes(),
        'Start-Recorder.cmd': (source / 'session-helper/Start-Recorder.cmd').read_bytes(),
        'start-recorder.sh': (source / 'session-helper/start-recorder.sh').read_bytes(),
        'LIVE_TEAM_GUIDE.txt': (source / 'session-helper/LIVE_TEAM_GUIDE.txt').read_bytes(),
        'README.txt': (source / 'session-helper/README.txt').read_bytes(),
        'LICENSE.txt': (source / 'system-tests/LICENSE.txt').read_bytes(),
        'session-recorder.html': (source / 'session-recorder.html').read_bytes(),
        'profiles.json': (source / 'system-tests/profiles.json').read_bytes(),
        'app.webmanifest': (source / 'session-helper/app.webmanifest').read_bytes(),
        'sw.js': (source / 'session-helper/sw.js').read_bytes(),
        **{'static/' + name: (source / name).read_bytes() for name in ASSETS},
    }
    sop = (Path(__file__).resolve().parents[1] / 'docs/UAS_TEST_SESSION_SOP.md').read_text()
    sop = re.sub(r'\]\((SESSION_RECORDER.md|UAS_TOOLING_AND_FORMATS_2026-10-07.md)\)',
                 r'](https://github.com/DroneWuKong/droneclear_Forge/blob/master/docs/\1)', sop)
    contents['SOP.md'] = sop.encode()
    # The downloaded recorder runs on localhost; other Forge tools stay online.
    local_html = contents['session-recorder.html'].decode()
    for route in ('audit', 'pid-tuning', 'test-lab', 'guide', 'software-library',
                  'tools-home', 'privacy'):
        local_html = local_html.replace(f'href="/{route}/"', f'href="https://uas-forge.com/{route}/"')
    local_html = local_html.replace('href="/session-recorder/forge-session-helper.zip"',
                                   'href="https://uas-forge.com/session-recorder/forge-session-helper.zip"')
    contents['session-recorder.html'] = local_html.encode()
    contents = {name: data.replace(b'\r\n', b'\n') for name, data in contents.items()}
    for name in ('README.txt', 'LICENSE.txt', 'app.webmanifest', 'sw.js', 'SOP.md', 'LIVE_TEAM_GUIDE.txt'):
        (output / name).write_bytes(contents[name])
    path = output / 'forge-session-helper.zip'
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 7, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if name.endswith('.sh') else 0o644) << 16
            archive.writestr(info, data)
    hashes = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
              for name in ('README.txt', 'LICENSE.txt', 'app.webmanifest', 'sw.js', 'SOP.md', 'LIVE_TEAM_GUIDE.txt', path.name)}
    (output / 'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in hashes.items()))
    return hashes
