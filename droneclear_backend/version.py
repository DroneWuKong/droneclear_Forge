"""
DroneClear build version — auto-populated from git at server startup.

Provides a Django context processor that injects version info into every
template so the sidebar always shows the current build.

Usage in templates:
    {{ dc_version }}        →  "v1.0.0 | Build 62 · 52305b2"
    {{ dc_version_short }}  →  "v1.0.0 | Build 62"
    {{ dc_build_number }}   →  62
    {{ dc_commit_hash }}    →  "52305b2"
"""

import subprocess
from pathlib import Path

# ---------------------------------------------------------------------------
# Semantic version — bump manually on milestone releases
# ---------------------------------------------------------------------------
VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Git info — read ONCE at import time (i.e. server startup)
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent


def _git(cmd: list[str]) -> str:
    """Run a git command in the project root, return stripped stdout or ''."""
    try:
        result = subprocess.run(
            ["git"] + cmd,
            cwd=_BASE_DIR,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


BUILD_NUMBER = _git(["rev-list", "--count", "HEAD"]) or "?"
COMMIT_HASH = _git(["rev-parse", "--short", "HEAD"]) or "unknown"

# Pre-format the display strings once
VERSION_FULL = f"v{VERSION} | Build {BUILD_NUMBER} · {COMMIT_HASH}"
VERSION_SHORT = f"v{VERSION} | Build {BUILD_NUMBER}"


# ---------------------------------------------------------------------------
# Django context processor
# ---------------------------------------------------------------------------
def version_context(request):
    """Inject DroneClear version info into every template context."""
    return {
        "dc_version": VERSION_FULL,
        "dc_version_short": VERSION_SHORT,
        "dc_build_number": BUILD_NUMBER,
        "dc_commit_hash": COMMIT_HASH,
    }
