#!/usr/bin/env python3
"""Software-only tests for the Forge/Patterns public-site audit."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "audit_public_site.py"
SPEC = importlib.util.spec_from_file_location("audit_public_site", MODULE_PATH)
assert SPEC and SPEC.loader
site_audit = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = site_audit
SPEC.loader.exec_module(site_audit)

NOW = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
VALID_HTML = """<!doctype html><html lang='en'><head><title>T</title></head><body><main id='main'><h1>Title</h1><a href='/brief/'>Brief</a><button aria-label='Open'>+</button><script>const ok = true;</script></main></body></html>"""
VALID_HEADERS = """/*
  Strict-Transport-Security: max-age=31536000
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Permitted-Cross-Domain-Policies: none
  Permissions-Policy: camera=(self)
/static/dataset_catalog.json
  Cache-Control: no-store
"""


def catalog(rows=None):
    return {
        "meta": {"generated_at": NOW.isoformat(), "dataset_count": 1, "status_definitions": {}},
        "datasets": rows or [{
            "id": "flags", "label": "Flags", "purpose": "Current signals", "role": "current",
            "required": True, "status": "fresh", "provenance": ["data/flags.json"],
            "quality": {}, "caveat": "Heuristic", "generated_at": NOW.isoformat(),
            "coverage_start": "2026-07-01T00:00:00+00:00", "coverage_end": "2026-07-31T00:00:00+00:00",
        }],
    }


def fixture(root: Path) -> Path:
    source = root / "forge-source"
    source.mkdir(parents=True)
    (root / "build_static.py").write_text("PAGES={'patterns-home.html':'patterns-home/index.html','miner-health.html':'miner-health/index.html','brief.html':'brief/index.html'}\n", encoding="utf-8")
    (root / "_headers").write_text(VALID_HEADERS, encoding="utf-8")
    (root / "README.md").write_text("# Site\n\nPublic metadata: `dataset_catalog.json`.\n", encoding="utf-8")
    (source / "patterns-home.html").write_text(VALID_HTML, encoding="utf-8")
    (source / "miner-health.html").write_text(VALID_HTML.replace("id='main'", "id='quality-main'"), encoding="utf-8")
    (source / "dataset_catalog.json").write_text(json.dumps(catalog()), encoding="utf-8")
    return source


class PublicSiteAuditTests(unittest.TestCase):
    def run_fixture(self, mutate=None):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        source = fixture(root)
        if mutate:
            mutate(root, source)
        return site_audit.run_audit(root, source, require_catalog=True, check_js=False, now=NOW)

    def test_clean_fixture_passes(self):
        report = self.run_fixture()
        self.assertEqual(report.errors, [])
        self.assertEqual(report.catalog_datasets, 1)

    def test_duplicate_id_is_blocking(self):
        def mutate(root, source):
            (source / "patterns-home.html").write_text(VALID_HTML.replace("</main>", "<div id='main'></div></main>"), encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "duplicate-id" for item in report.errors))

    def test_unsafe_and_unisolated_links_are_blocking(self):
        def mutate(root, source):
            value = VALID_HTML.replace("</main>", "<a href='javascript:alert(1)'>bad</a><a href='https://example.com' target='_blank'>new</a></main>")
            (source / "patterns-home.html").write_text(value, encoding="utf-8")
        report = self.run_fixture(mutate)
        codes = {item.code for item in report.errors}
        self.assertIn("unsafe-link", codes)
        self.assertIn("new-window-isolation", codes)

    def test_broken_internal_route_is_blocking(self):
        def mutate(root, source):
            (source / "patterns-home.html").write_text(VALID_HTML.replace("/brief/", "/not-a-route/"), encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "broken-internal-route" for item in report.errors))

    def test_duplicate_catalog_id_is_blocking(self):
        def mutate(root, source):
            row = catalog()["datasets"][0]
            (source / "dataset_catalog.json").write_text(json.dumps(catalog([row, dict(row)])), encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "catalog-duplicate-id" for item in report.errors))

    def test_missing_security_header_is_blocking(self):
        def mutate(root, source):
            (root / "_headers").write_text(VALID_HEADERS.replace("  Referrer-Policy: strict-origin-when-cross-origin\n", ""), encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "security-header-missing" for item in report.errors))

    def test_retired_claim_is_blocking(self):
        def mutate(root, source):
            (root / "README.md").write_text("# Site\n\nPIE v0.9\n", encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "retired-public-claim" for item in report.errors))

    def test_relative_parent_link_resolves_to_root(self):
        self.assertEqual(site_audit.normalize_route("../"), "/")
        self.assertEqual(site_audit.normalize_route("../brief/"), "/brief/")

    def test_required_invalid_dataset_is_blocking(self):
        def mutate(root, source):
            row = catalog()["datasets"][0]
            row = dict(row, status="invalid")
            (source / "dataset_catalog.json").write_text(json.dumps(catalog([row])), encoding="utf-8")
        report = self.run_fixture(mutate)
        self.assertTrue(any(item.code == "required-dataset-broken" for item in report.errors))


if __name__ == "__main__":
    unittest.main()
