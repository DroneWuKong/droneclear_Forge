"""Fail a Pages build before upload if any generated asset is too large."""
from pathlib import Path

PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024


def validate_pages_asset_sizes(directory, maximum=PAGES_MAX_ASSET_BYTES):
    root = Path(directory)
    oversized = []
    for asset in sorted(root.rglob('*')):
        if asset.is_file() and asset.stat().st_size > maximum:
            oversized.append(f'{asset.relative_to(root).as_posix()} ({asset.stat().st_size} bytes)')
    if oversized:
        raise ValueError(f'Pages assets exceed the {maximum}-byte limit: ' + ', '.join(oversized))
