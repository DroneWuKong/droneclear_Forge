#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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
    ids = [
        "actor_fingerprints",
        "article_event_clusters",
        "threat_scores",
        "ttp_counter_gap",
        "miner_health",
    ]
    ids += [f"extra_{i}" for i in range(14)]
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


def event_meta(generated="2026-07-31T11:00:00+00:00"):
    return {
        "generated_at": generated,
        "generator": smoke.EVENT_GENERATOR,
        "version": "1.1",
        "reporting_cluster_count": 100,
        "candidate_event_cluster_count": 20,
        "quality_controls": {
            "shared_url_requires_title_and_time_agreement": True,
            "same_source_shared_url_different_title_merge_allowed": False,
            "same_single_source_candidate_pair_allowed": False,
            "largest_serialized_reporting_cluster_span_days": 5,
            "largest_serialized_candidate_event_span_days": 3,
        },
    }


def event_summary_payload():
    return {
        "meta": event_meta(),
        "actor_summary": [
            {
                "actor": "Actor A",
                "article_mention_count": 20,
                "reporting_cluster_count": 15,
                "candidate_event_count": 4,
                "multi_source_candidate_event_count": 2,
            }
        ],
        "query": {"view": "summary"},
    }


def event_actor_payload(actor="Actor A"):
    return {
        "meta": event_meta(),
        "actor_summary": [{"actor": actor, "candidate_event_count": 4}],
        "candidate_events": [
            {
                "candidate_event_id": "EVT-1",
                "actors_mentioned": [actor],
                "publication_start": "2026-07-30T00:00:00+00:00",
                "publication_end": "2026-07-30T00:00:00+00:00",
            }
        ],
        "query": {
            "actor": actor,
            "offset": 0,
            "limit": 1,
            "returned_event_count": 1,
            "total_candidate_event_count": 4,
            "has_more": True,
        },
    }


class SmokeTests(unittest.TestCase):
    def test_html_markers_and_headers(self):
        target = smoke.build_targets("https://p.example/", "https://f.example/")[0]
        body = " ".join(target.required_markers)
        snapshot = smoke.Snapshot(target.url, 200, HEADERS, body)
        self.assertEqual(smoke.validate_html(snapshot, target), [])

    def test_html_rejects_retired_phrase_and_missing_header(self):
        target = smoke.build_targets("https://p.example/", "https://f.example/")[0]
        snapshot = smoke.Snapshot(
            target.url,
            200,
            {"x-content-type-options": "nosniff"},
            " ".join(target.required_markers) + " no money flowing",
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

    def test_event_summary_accepts_hardened_current_payload(self):
        snapshot = smoke.Snapshot(
            "https://p.example/api/events",
            200,
            {},
            json.dumps({"data": event_summary_payload()}),
        )
        errors, actor = smoke.validate_event_summary(snapshot, now=NOW)
        self.assertEqual(errors, [])
        self.assertEqual(actor, "Actor A")

    def test_event_summary_rejects_v1_rolling_url_output(self):
        payload = event_summary_payload()
        payload["meta"]["version"] = "1.0"
        payload["meta"]["generator"] = "services/pipeline/article_event_clusters.py"
        payload["meta"]["quality_controls"][
            "same_source_shared_url_different_title_merge_allowed"
        ] = True
        payload["meta"]["quality_controls"][
            "largest_serialized_reporting_cluster_span_days"
        ] = 118
        snapshot = smoke.Snapshot(
            "https://p.example/api/events", 200, {}, json.dumps(payload)
        )
        errors, _ = smoke.validate_event_summary(snapshot, now=NOW)
        self.assertTrue(any("version 1.1" in error for error in errors))
        self.assertTrue(any("generator" in error for error in errors))
        self.assertTrue(any("rolling-URL" in error for error in errors))
        self.assertTrue(any("five days" in error for error in errors))

    def test_event_actor_projection_checks_exact_actor_and_limit(self):
        snapshot = smoke.Snapshot(
            "https://p.example/api/events?actor=Actor%20A",
            200,
            {},
            json.dumps({"data": event_actor_payload()}),
        )
        self.assertEqual(
            smoke.validate_event_actor_sample(snapshot, "Actor A"),
            [],
        )

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
        pages = {
            target.url: smoke.Snapshot(
                target.url,
                200,
                HEADERS,
                " ".join(target.required_markers),
            )
            for target in targets
        }

        def fake_fetch(url, timeout):
            if url in pages:
                return pages[url]
            parsed = urlparse(url)
            query = parse_qs(parsed.query)
            data_type = (query.get("type") or [""])[0]
            if data_type == "dataset_catalog":
                return smoke.Snapshot(
                    url, 200, {}, json.dumps({"data": catalog_payload()})
                )
            if data_type == "article_event_clusters" and query.get("view") == ["summary"]:
                return smoke.Snapshot(
                    url, 200, {}, json.dumps({"data": event_summary_payload()})
                )
            if data_type == "article_event_clusters" and query.get("actor") == ["Actor A"]:
                return smoke.Snapshot(
                    url, 200, {}, json.dumps({"data": event_actor_payload()})
                )
            raise AssertionError(f"unexpected URL {url}")

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
