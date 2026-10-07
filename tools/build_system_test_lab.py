"""Publish only the newly authored, allowlisted System Test Lab toolkit."""
import hashlib
from pathlib import Path
import zipfile

FILES = ("run_tests.py", "profiles.json", "config.example.json", "README.txt", "LICENSE.txt")


def export_toolkit(source, output):
    destination = Path(output) / "system-tests"
    destination.mkdir(parents=True, exist_ok=True)
    source = Path(source) / "system-tests"
    contents = {name: (source / name).read_bytes().replace(b"\r\n", b"\n") for name in FILES}
    for name, data in contents.items():
        (destination / name).write_bytes(data)
    archive = destination / "forge-system-tests.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for name, data in contents.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 7, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            package.writestr(info, data)
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
    hashes[archive.name] = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / "SHA256SUMS.txt").write_text("".join(f"{digest}  {name}\n" for name, digest in hashes.items()), encoding="utf-8")
    return hashes
