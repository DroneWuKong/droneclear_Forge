#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "tools" / "smoke_public_deployment.py"
SPEC = importlib.util.spec_from_file_location("smoke_public_deployment", MODULE)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = smoke
SPEC.loader.exec_module(smoke)

NOW = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-permitted-cross-domain-policies": "none",
}


def catalog_payload(status="fresh", generated="2026-07-31T11:00:00+00:00"):
    ids = ["actor_fingerprints", "threat_scores", "ttp_counter_gap", "miner_health"]
    ids += [f"extra_{i}" for i in range(12)]
    return {
        "meta": {"generated_at": generated},
        "datasets": [
            {
                "id": dataset_id,
                "required": dataset_id in smoke.REQUIRED_DATASET_IDS,
                "status": status,
            }
            for dataset_id in ids
        ],
    }


class SmokeTests(unittest.TestCase):
    def test_html_markers_and_headers(self):
        target = smoke.build_targets("https://p.example/", "https://f.example/")[0]
        body = target.required_markers[0]
        snapshot = smoke.Snapshot(target.url, 200, HEADERS, body)
        self.assertEqual(smoke.validate_html(snapshot, target), [])

    def test_html_rejects_retired_phrase_and_missing_header(self):
        target = smoke.build_targets("https://p.example/", "https://f.example/")[0]
        snapshot = smoke.Snapshot(
            target.url,
            200,
            {"x-content-type-options": "nosniff"},
            target.required_markers[0] + " no money flowing",
        )
        errors = smoke.validate_html(snapshot, target)
        self.assertTrue(any("retired phrase" in error for error in errors))
        self.assertTrue(any("referrer-policy" in error for error in errors))

    def test_catalog_accepts_wrapped_current_payload(self):
        body = json.dumps({"data": catalog_payload()})
        snapshot = smoke.Snapshot("https://p.example/api", 200, {}, body)
        self.assertEqual(smoke.validate_catalog(snapshot, now=NOW), [])

    def test_catalog_rejects_required_failure_duplicates_and_staleness(self):
        payload = catalog_payload(
            status="fresh", generated="2026-07-20T00:00:00+00:00"
        )
        payload["datasets"][0]["status"] = "unavailable"
        payload["datasets"].append(dict(payload["datasets"][0]))
        snapshot = smoke.Snapshot(
            "https://p.example/catalog", 200, {}, json.dumps(payload)
        )
        errors = smoke.validate_catalog(
            snapshot, now=NOW, max_age=timedelta(hours=72)
        )
        self.assertTrue(any("required dataset" in error for error in errors))
        self.assertTrue(any("duplicate" in error for error in errors))
        self.assertTrue(any("stale by policy" in error for error in errors))

    def test_catalog_fallback_uses_first_success(self):
        calls = []

        def fake_fetch(url, timeout):
            calls.append(url)
            if "api/data" in url:
                raise smoke.SmokeFailure("api unavailable")
            return smoke.Snapshot(url, 200, {}, json.dumps(catalog_payload()))

        snapshot, failures = smoke.fetch_catalog(
            "https://p.example/", timeout=1, fetcher=fake_fetch
        )
        self.assertIn("/static/dataset_catalog.json", snapshot.url)
        self.assertEqual(len(failures), 1)
        self.assertEqual(len(calls), 2)

    def test_check_once_with_fake_network(self):
        targets = smoke.build_targets("https://p.example/", "https://f.example/")
        by_url = {
            target.url: smoke.Snapshot(
                target.url,
                200,
                HEADERS,
                " ".join(target.required_markers),
            )
            for target in targets
        }
        by_url["https://p.example/api/data?type=dataset_catalog"] = smoke.Snapshot(
            "https://p.example/api/data?type=dataset_catalog",
            200,
            {},
            json.dumps(catalog_payload()),
        )

        def fake_fetch(url, timeout):
            return by_url[url]

        errors = smoke.check_once(
            "https://p.example/",
            "https://f.example/",
            timeout=1,
            max_catalog_age_hours=72,
            fetcher=fake_fetch,
            now=NOW,
        )
        self.assertEqual(errors, [])

    def test_dry_run_makes_no_network_call(self):
        self.assertEqual(
            smoke.main(
                [
                    "--patterns-base",
                    "https://p.example/",
                    "--forge-base",
                    "https://f.example/",
                    "--dry-run",
                ]
            ),
            0,
        )


if __name__ == "__main__":
    unittest.main()
