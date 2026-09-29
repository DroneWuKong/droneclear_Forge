#!/usr/bin/env python3
"""Fail a deployment when the gated workspace is incomplete or contradictory."""

import json
import hashlib
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
EXPECTED_FINALISTS = tuple(dict.fromkeys(company for company, _points in EXPECTED.values()))

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


def audit_relationships(build, release):
    path = build / 'relationships.json'
    data = load(path)
    manifest = release.get('artifacts', {}).get('relationships', {})
    assert data.get('schema_version') == 1
    assert data.get('upstream_ref') == release['upstream_ref'], 'relationship input revision differs from release'
    assert manifest.get('sha256') == hashlib.sha256(path.read_bytes()).hexdigest(), 'relationship artifact hash mismatch'
    assert manifest.get('records') == len(data['relationships'])
    node_ids = {n['id'] for n in data['nodes']}
    ids = {r['id'] for r in data['relationships']}
    assert len(ids) == len(data['relationships']), 'duplicate relationship identities'
    for row in data['relationships']:
        assert row['source'] in node_ids and row['target'] in node_ids
        assert all(ident in ids for ident in row['conflicting_record_ids'])
        if row['review_status'] in {'needs_review', 'stale_review'}:
            assert row['verified_on'] is None, 'unreviewed claim acquired a verification date'
    graph_path = build / 'graphify.json'
    graph = load(graph_path)
    graph_manifest = release['artifacts']['graphify']
    assert graph_manifest['sha256'] == hashlib.sha256(graph_path.read_bytes()).hexdigest(), 'Graphify artifact hash mismatch'
    assert graph['graph']['upstream_ref'] == data['upstream_ref']
    expected = {r['id'] for r in data['relationships'] if r['active'] and r['assertion'] == 'affirmed'
                and r['review_status'] == 'supported' and r.get('review_type') == 'source_checked'}
    assert {r['id'] for r in graph['links']} == expected, 'Query graph includes unreviewed claims or omits reviewed ones'
    assert graph_manifest['records'] == len(graph['links'])
    for public_path in (build.parent/'relationships.json', build.parent/'static/relationships.json',
                        build.parent/'graphify.json', build.parent/'static/graphify.json'):
        assert not public_path.exists(), 'private relationship data copied to a public route'


def main():
    release = load(BUILD / "release.json")
    rows = release.get("official_results", [])
    actual = {(r["mission"], r["rank"]): (r["company"], float(r["points"])) for r in rows}
    assert actual == EXPECTED, "official G-II result set does not match the published leaderboard"
    assert release.get("published") == "2026-09-17"
    assert release.get("placements") == 10
    assert release.get("unique_companies") == 9
    assert tuple(release.get("official_finalists", [])) == EXPECTED_FINALISTS
    assert re.fullmatch(r"[0-9a-f]{40}", release.get("upstream_ref", ""))
    audit_relationships(BUILD, release)

    update = load(BUILD / "data" / "ddg_program_update.json")
    phase3 = load(BUILD / "data" / "ddg3.json")
    assert update.get("revision") == "phase3-rev3-2026-09-29", "DDG update is stale"
    assert phase3["program_update"]["revision"] == update["revision"]
    assert phase3["program_status"]["final_rfs_published"] is True
    assert len(set(update["phase_2_5"]["invitees"])) == 17
    assert phase3["official_baseline"]["budget"]["value"] == "$450 million"
    assert (BUILD / "dossiers" / "ddg-program-update.md").is_file()
    for page in ("index.html", "ddg/index.html", "dossiers/index.html", "supply-web/index.html", "data/index.html", "components-bom/index.html", "drone-config/index.html"):
        assert "ddg-program-update.js" in (BUILD / page).read_text(encoding="utf-8"), page

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
    for slug in ("perennial-autonomy", "hyperscale"):
        matches = [d for d in dossier_index if d.get("slug") == slug]
        assert len(matches) == 1 and matches[0].get("group") == "Company dossiers", (
            f"{slug} still uses a result-only brief rather than an upstream company profile"
        )

    roster = (BUILD / "dossiers" / "ddg2-roster.md").read_text(encoding="utf-8")
    assert "hyperscale.us" in roster, "gated roster still lacks the resolved Hyperscale program identity"

    perennial = (BUILD / "dossiers" / "perennial-autonomy.md").read_text(encoding="utf-8")
    assert "## September 27 verification pass:" in perennial, (
        "Perennial dossier lacks the latest verification record"
    )
    assert "Entered model remains UNKNOWN." in perennial, (
        "Perennial dossier must not assign an unverified Gauntlet aircraft"
    )
    assert "USPTO Trademark Status and Document Retrieval" in perennial, (
        "Perennial dossier lacks the verified U.S. entity record"
    )

    ddg = (BUILD / "ddg" / "index.html").read_text(encoding="utf-8")
    assert "COMPLETE · RESULTS PUBLISHED" in ddg
    assert "Ten Top-5 placements" in ddg
    assert "rs.action_needed && rs.banner && !resultRows.length" in ddg
    assert "Companies Focused — '+finalists.length+' Official G-II Finalists" in ddg
    assert "Vendor Standings — G-II Readiness" not in ddg
    focus = ddg.split("finalist_profiles:[", 1)[1].split("]\n};", 1)[0]
    assert focus.count('dossier:"') == 9, "company focus must contain exactly nine finalist profiles"
    for company in EXPECTED_FINALISTS:
        assert f'name:"{company}"' in focus, f"company focus lacks official finalist: {company}"
    for stale in ("AeroVironment", "Auterion", "Kratos", "Griffon Aerospace", "Napatree"):
        assert f'name:"{stale}"' not in focus, f"G-I forecast company leaked into current focus: {stale}"

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
