#!/usr/bin/env python3
"""Fail a deployment when the gated workspace is incomplete or contradictory."""

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "private"

EXPECTED = {
    ("Deep Strike", 1): ("Perennial Autonomy", 80.1),
    ("Deep Strike", 2): ("Hyperscale", 70.9),
    ("Deep Strike", 3): ("Neros", 69.8),
    ("Deep Strike", 4): ("Skycutter", 66.6),
    ("Deep Strike", 5): ("Swarm Defense Technologies", 66.0),
    ("Close Quarters Battle", 1): ("Neros", 88.1),
    ("Close Quarters Battle", 2): ("ORQA US LLC", 82.8),
    ("Close Quarters Battle", 3): ("XTEND Reality Inc.", 80.2),
    ("Close Quarters Battle", 4): ("Vector", 78.2),
    ("Close Quarters Battle", 5): ("ModalAI Inc.", 74.3),
}

ROUTES = (
    "/private/ddg/",
    "/private/dossiers/",
    "/private/supply-web/",
    "/private/data/",
    "/private/components-bom/",
    "/private/drone-config/",
)


def load(path):
    if not path.is_file() or path.stat().st_size == 0:
        raise AssertionError(f"missing build artifact: {path.relative_to(ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


def canon(value):
    value = re.sub(r"[^a-z0-9]+", " ", str(value).lower())
    value = re.sub(r"\b(inc|llc|corp|corporation|technologies|technology|reality|us)\b", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def main():
    release = load(BUILD / "release.json")
    rows = release.get("official_results", [])
    actual = {(r["mission"], r["rank"]): (r["company"], float(r["points"])) for r in rows}
    assert actual == EXPECTED, "official G-II result set does not match the published leaderboard"
    assert release.get("published") == "2026-09-17"
    assert release.get("placements") == 10
    assert release.get("unique_companies") == 9
    assert re.fullmatch(r"[0-9a-f]{40}", release.get("upstream_ref", ""))

    data_index = load(BUILD / "data" / "index.json")
    assert data_index, "private data index is empty"
    for row in data_index:
        for field in ("source_path", "path", "bytes", "sha256", "upstream_ref"):
            assert row.get(field), f"{row.get('file')} lacks provenance field {field}"
        assert re.fullmatch(r"[0-9a-f]{64}", row["sha256"])

    dossier_index = load(BUILD / "dossiers" / "index.json")
    titles = [canon(d.get("title")) for d in dossier_index]
    for company, _points in EXPECTED.values():
        key = canon(company)
        assert any(t == key or t.startswith(key) or key.startswith(t) for t in titles), (
            f"official finalist lacks dossier or result brief: {company}"
        )

    ddg = (BUILD / "ddg" / "index.html").read_text(encoding="utf-8")
    assert "COMPLETE · RESULTS PUBLISHED" in ddg
    assert "Ten Top-5 placements" in ddg
    assert "rs.action_needed && rs.banner && !resultRows.length" in ddg

    for page in ("dossiers", "supply-web", "data", "components-bom", "drone-config"):
        html = (BUILD / page / "index.html").read_text(encoding="utf-8")
        for route in ROUTES:
            assert route in html, f"{page} navigation lacks {route}"

    print(
        "private release audit passed: 10 placements / 9 companies, "
        f"{len(dossier_index)} dossiers, {len(data_index)} datasets, complete provenance"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"private release audit failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
