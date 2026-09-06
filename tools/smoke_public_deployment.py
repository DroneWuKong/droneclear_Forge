#!/usr/bin/env python3
"""Smoke-test the deployed Forge and Patterns trust surfaces.

The normal mode performs read-only HTTPS checks against production. ``--dry-run``
is the explicit no-network simulation path: it validates configuration without
opening a socket. No physical hardware is required.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

USER_AGENT = "ForgePatternsProductionSmoke/1.1 (+https://uas-patterns.com/)"
REQUIRED_SECURITY_HEADERS = (
    "x-content-type-options",
    "referrer-policy",
    "x-permitted-cross-domain-policies",
)
BAD_CATALOG_STATUSES = {"unavailable", "invalid", "invalid-future"}
REQUIRED_DATASET_IDS = {
    "actor_fingerprints",
    "article_event_clusters",
    "threat_scores",
    "ttp_counter_gap",
    "miner_health",
    "source_coverage_matrix",
    "data_quality_score",
}
EVENT_GENERATOR = "services/pipeline/article_event_clusters_quality.py"


@dataclass(frozen=True)
class Target:
    name: str
    url: str
    required_markers: tuple[str, ...]
    forbidden_markers: tuple[str, ...] = ()
    require_security_headers: bool = True


@dataclass(frozen=True)
class Snapshot:
    url: str
    status: int
    headers: Mapping[str, str]
    body: str


class SmokeFailure(RuntimeError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    candidate = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def normalize_base(url: str) -> str:
    value = url.strip()
    if not value.startswith(("https://", "http://")):
        raise ValueError(f"base URL must use http(s): {url!r}")
    return value.rstrip("/") + "/"


def build_targets(patterns_base: str, forge_base: str) -> list[Target]:
    patterns = normalize_base(patterns_base)
    forge = normalize_base(forge_base)
    return [
        Target(
            "patterns-home",
            urljoin(patterns, "patterns-home/"),
            ("UAS intelligence with the evidence, coverage, and uncertainty attached.",),
            ("56-day series", "composite threat score", "no money flowing"),
        ),
        Target(
            "priority-view",
            urljoin(patterns, "priorities/"),
            (
                "Local-only Priority Intelligence Requirement view",
                "Put the signals you care about first—without hiding the rest.",
                "No LLM participates in the ranking.",
            ),
            ("profile match is proof",),
        ),
        Target(
            "ask-pie",
            urljoin(patterns, "ask-pie/"),
            (
                "Cited retrieval · no generated conclusion",
                "Ask PIE for the evidence—not a confident-sounding answer.",
                "No LLM writes the answer or changes the ranking.",
            ),
            ("automatic conclusion", "incident count"),
        ),
        Target(
            "data-quality",
            urljoin(patterns, "miner-health/"),
            ("Data Quality &amp; Pipeline Health", "Public data control surface", "data_quality_score"),
            ("Live observability for the mining pipeline behind this site",),
        ),
        Target(
            "actors",
            urljoin(patterns, "actors/"),
            (
                "Threat Actor Signals",
                "activity/exposure score",
                "Duplicate-adjusted reporting and candidate events",
                "Candidate-event clusters",
                "not confirmed incidents, attribution, or proof",
            ),
            ("composite threat scores", "candidate events are confirmed incidents"),
        ),
        Target(
            "ttps",
            urljoin(patterns, "ttps/"),
            ("TTP Defense-Gap Signals", "does not prove"),
            ("no money flowing",),
        ),
        Target(
            "forge-home",
            forge,
            ("Forge",),
            (),
        ),
    ]


def fetch_snapshot(url: str, timeout: float = 15.0) -> Snapshot:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
            body = raw.decode(charset, errors="replace")
            headers = {key.lower(): value for key, value in response.headers.items()}
            status = getattr(response, "status", response.getcode())
            return Snapshot(response.geturl(), int(status), headers, body)
    except HTTPError as exc:
        detail = exc.read(600).decode("utf-8", errors="replace")
        raise SmokeFailure(f"{url}: HTTP {exc.code}: {detail[:300]!r}") from exc
    except URLError as exc:
        raise SmokeFailure(f"{url}: network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise SmokeFailure(f"{url}: timed out after {timeout:g}s") from exc


def validate_html(snapshot: Snapshot, target: Target) -> list[str]:
    errors: list[str] = []
    if snapshot.status != 200:
        errors.append(f"{target.name}: expected HTTP 200, got {snapshot.status}")
    for marker in target.required_markers:
        if marker not in snapshot.body:
            errors.append(f"{target.name}: required marker missing: {marker!r}")
    lowered = snapshot.body.lower()
    for phrase in target.forbidden_markers:
        if phrase.lower() in lowered:
            errors.append(f"{target.name}: retired phrase still deployed: {phrase!r}")
    if target.require_security_headers:
        for header in REQUIRED_SECURITY_HEADERS:
            if not snapshot.headers.get(header):
                errors.append(f"{target.name}: missing response header {header}")
    return errors


def unwrap_data(value: Any, label: str) -> dict[str, Any]:
    if isinstance(value, dict) and isinstance(value.get("data"), dict):
        return value["data"]
    if isinstance(value, dict):
        return value
    raise SmokeFailure(f"{label} must be a JSON object")


def parse_json_snapshot(snapshot: Snapshot, label: str) -> dict[str, Any]:
    if snapshot.status != 200:
        raise SmokeFailure(f"{label}: expected HTTP 200, got {snapshot.status}")
    try:
        return unwrap_data(json.loads(snapshot.body), label)
    except json.JSONDecodeError as exc:
        raise SmokeFailure(f"{label}: invalid JSON: {exc}") from exc


def validate_fresh_timestamp(
    raw: Any,
    *,
    label: str,
    now: datetime,
    max_age: timedelta,
) -> list[str]:
    parsed = parse_timestamp(raw)
    if parsed is None:
        return [f"{label}: generated_at is missing or unparseable"]
    age = now - parsed
    if age < timedelta(minutes=-10):
        return [f"{label}: generated_at is in the future by {-age.total_seconds()/60:.1f}m"]
    if age > max_age:
        return [
            f"{label}: stale by policy; age={age.total_seconds()/3600:.1f}h > "
            f"{max_age.total_seconds()/3600:.1f}h"
        ]
    return []


def validate_catalog(
    snapshot: Snapshot,
    *,
    now: datetime | None = None,
    max_age: timedelta = timedelta(hours=72),
) -> list[str]:
    errors: list[str] = []
    try:
        catalog = parse_json_snapshot(snapshot, "dataset-catalog")
    except SmokeFailure as exc:
        return [str(exc)]

    meta = catalog.get("meta")
    rows = catalog.get("datasets")
    if not isinstance(meta, dict):
        errors.append("dataset-catalog: meta must be an object")
        meta = {}
    if not isinstance(rows, list):
        return errors + ["dataset-catalog: datasets must be a list"]
    if len(rows) < 19:
        errors.append(f"dataset-catalog: expected at least 19 datasets, got {len(rows)}")

    ids: list[str] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"dataset-catalog: row {index} is not an object")
            continue
        dataset_id = row.get("id")
        if isinstance(dataset_id, str) and dataset_id:
            ids.append(dataset_id)
        else:
            errors.append(f"dataset-catalog: row {index} lacks an id")
        if row.get("required") and row.get("status") in BAD_CATALOG_STATUSES:
            errors.append(
                f"dataset-catalog: required dataset {dataset_id!r} is {row.get('status')!r}"
            )

    if len(ids) != len(set(ids)):
        errors.append("dataset-catalog: duplicate dataset ids")
    missing = sorted(REQUIRED_DATASET_IDS - set(ids))
    if missing:
        errors.append(f"dataset-catalog: missing required dataset ids: {', '.join(missing)}")

    check_now = (now or utc_now()).astimezone(timezone.utc)
    errors.extend(
        validate_fresh_timestamp(
            meta.get("generated_at"),
            label="dataset-catalog",
            now=check_now,
            max_age=max_age,
        )
    )
    return errors


def validate_event_summary(
    snapshot: Snapshot,
    *,
    now: datetime | None = None,
    max_age: timedelta = timedelta(hours=72),
) -> tuple[list[str], str | None]:
    errors: list[str] = []
    try:
        data = parse_json_snapshot(snapshot, "article-event-summary")
    except SmokeFailure as exc:
        return [str(exc)], None
    meta = data.get("meta")
    summaries = data.get("actor_summary")
    if not isinstance(meta, dict):
        return ["article-event-summary: meta must be an object"], None
    if not isinstance(summaries, list) or not summaries:
        errors.append("article-event-summary: actor_summary must be a non-empty list")
        summaries = []

    if meta.get("version") != "1.1":
        errors.append(f"article-event-summary: expected version 1.1, got {meta.get('version')!r}")
    if meta.get("generator") != EVENT_GENERATOR:
        errors.append("article-event-summary: hardened generator is not active")
    controls = meta.get("quality_controls")
    if not isinstance(controls, dict):
        errors.append("article-event-summary: quality_controls must be an object")
        controls = {}
    if controls.get("shared_url_requires_title_and_time_agreement") is not True:
        errors.append("article-event-summary: shared-URL control missing")
    if controls.get("same_source_shared_url_different_title_merge_allowed") is not False:
        errors.append("article-event-summary: rolling-URL guard missing")
    if controls.get("same_single_source_candidate_pair_allowed") is not False:
        errors.append("article-event-summary: same-source candidate guard missing")
    if float(controls.get("largest_serialized_reporting_cluster_span_days") or 0) > 5.01:
        errors.append("article-event-summary: reporting span exceeds five days")
    if float(controls.get("largest_serialized_candidate_event_span_days") or 0) > 3.01:
        errors.append("article-event-summary: candidate-event span exceeds three days")
    if int(meta.get("reporting_cluster_count") or 0) < int(meta.get("candidate_event_cluster_count") or 0):
        errors.append("article-event-summary: candidate events exceed reporting groups")
    if int(meta.get("candidate_event_cluster_count") or 0) < 1:
        errors.append("article-event-summary: no candidate-event clusters")

    check_now = (now or utc_now()).astimezone(timezone.utc)
    errors.extend(
        validate_fresh_timestamp(
            meta.get("generated_at"),
            label="article-event-summary",
            now=check_now,
            max_age=max_age,
        )
    )
    actor = None
    if summaries:
        ranked = sorted(
            (row for row in summaries if isinstance(row, dict) and row.get("actor")),
            key=lambda row: int(row.get("candidate_event_count") or 0),
            reverse=True,
        )
        if ranked:
            actor = str(ranked[0]["actor"])
    return errors, actor


def validate_event_actor_sample(snapshot: Snapshot, actor: str) -> list[str]:
    try:
        data = parse_json_snapshot(snapshot, "article-event-actor-sample")
    except SmokeFailure as exc:
        return [str(exc)]
    errors: list[str] = []
    query = data.get("query")
    events = data.get("candidate_events")
    if not isinstance(query, dict):
        errors.append("article-event-actor-sample: query must be an object")
        query = {}
    if query.get("actor") != actor:
        errors.append("article-event-actor-sample: exact actor echo mismatch")
    if not isinstance(events, list):
        return errors + ["article-event-actor-sample: candidate_events must be a list"]
    if int(query.get("returned_event_count") or 0) != len(events):
        errors.append("article-event-actor-sample: returned count mismatch")
    if int(query.get("limit") or 0) != 1:
        errors.append("article-event-actor-sample: projection limit was not honored")
    for event in events:
        if actor not in (event.get("actors_mentioned") or []):
            errors.append("article-event-actor-sample: event leaked from another actor")
    return errors


def fetch_catalog(
    patterns_base: str,
    *,
    timeout: float,
    fetcher: Callable[[str, float], Snapshot] = fetch_snapshot,
) -> tuple[Snapshot, list[str]]:
    base = normalize_base(patterns_base)
    candidates = (
        urljoin(base, "api/data?type=dataset_catalog"),
        urljoin(base, "static/dataset_catalog.json"),
        urljoin(base, "dataset_catalog.json"),
    )
    failures: list[str] = []
    for url in candidates:
        try:
            snapshot = fetcher(url, timeout)
        except SmokeFailure as exc:
            failures.append(str(exc))
            continue
        if snapshot.status == 200:
            return snapshot, failures
        failures.append(f"{url}: HTTP {snapshot.status}")
    raise SmokeFailure("no dataset-catalog endpoint succeeded: " + " | ".join(failures))


def check_once(
    patterns_base: str,
    forge_base: str,
    *,
    timeout: float,
    max_catalog_age_hours: float,
    fetcher: Callable[[str, float], Snapshot] = fetch_snapshot,
    now: datetime | None = None,
) -> list[str]:
    errors: list[str] = []
    for target in build_targets(patterns_base, forge_base):
        try:
            snapshot = fetcher(target.url, timeout)
        except SmokeFailure as exc:
            errors.append(str(exc))
            continue
        errors.extend(validate_html(snapshot, target))

    max_age = timedelta(hours=max_catalog_age_hours)
    try:
        catalog_snapshot, prior_failures = fetch_catalog(
            patterns_base, timeout=timeout, fetcher=fetcher
        )
        if prior_failures:
            print("Catalog endpoint fallbacks: " + " | ".join(prior_failures))
        errors.extend(validate_catalog(catalog_snapshot, now=now, max_age=max_age))
    except SmokeFailure as exc:
        errors.append(str(exc))

    patterns = normalize_base(patterns_base)
    try:
        summary_url = urljoin(
            patterns,
            "api/data?type=article_event_clusters&view=summary",
        )
        summary_snapshot = fetcher(summary_url, timeout)
        summary_errors, actor = validate_event_summary(
            summary_snapshot,
            now=now,
            max_age=max_age,
        )
        errors.extend(summary_errors)
        if actor and not summary_errors:
            actor_url = urljoin(
                patterns,
                "api/data?type=article_event_clusters&actor="
                + quote(actor, safe="")
                + "&offset=0&limit=1",
            )
            errors.extend(validate_event_actor_sample(fetcher(actor_url, timeout), actor))
    except SmokeFailure as exc:
        errors.append(str(exc))
    return errors


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--patterns-base", default="https://uas-patterns.com/")
    p.add_argument("--forge-base", default="https://uas-forge.com/")
    p.add_argument("--attempts", type=int, default=12)
    p.add_argument("--delay-seconds", type=float, default=30.0)
    p.add_argument("--timeout-seconds", type=float, default=20.0)
    p.add_argument("--max-catalog-age-hours", type=float, default=72.0)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="validate target configuration without making network requests",
    )
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.attempts < 1:
        print("ERROR: --attempts must be at least 1", file=sys.stderr)
        return 2
    try:
        targets = build_targets(args.patterns_base, args.forge_base)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        print("Production smoke dry run: no network requests")
        for target in targets:
            print(f"  {target.name:16} {target.url}")
        print("  dataset-catalog  API/static fallback chain configured")
        print("  event-summary    projected API and exact-actor sample configured")
        return 0

    for attempt in range(1, args.attempts + 1):
        errors = check_once(
            args.patterns_base,
            args.forge_base,
            timeout=args.timeout_seconds,
            max_catalog_age_hours=args.max_catalog_age_hours,
        )
        if not errors:
            print(f"Production smoke: PASS on attempt {attempt}/{args.attempts}")
            return 0
        print(f"Production smoke attempt {attempt}/{args.attempts}: FAIL", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        if attempt < args.attempts:
            time.sleep(args.delay_seconds)

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
