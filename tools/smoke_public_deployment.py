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
from urllib.parse import urljoin
from urllib.request import Request, urlopen

USER_AGENT = "ForgePatternsProductionSmoke/1.0 (+https://uas-patterns.com/)"
REQUIRED_SECURITY_HEADERS = (
    "x-content-type-options",
    "referrer-policy",
    "x-permitted-cross-domain-policies",
)
BAD_CATALOG_STATUSES = {"unavailable", "invalid", "invalid-future"}
REQUIRED_DATASET_IDS = {
    "actor_fingerprints",
    "threat_scores",
    "ttp_counter_gap",
    "miner_health",
}


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
            "data-quality",
            urljoin(patterns, "miner-health/"),
            ("Data Quality &amp; Pipeline Health", "Public data control surface"),
            ("Live observability for the mining pipeline behind this site",),
        ),
        Target(
            "actors",
            urljoin(patterns, "actors/"),
            ("Threat Actor Signals", "open-source activity/exposure score"),
            ("composite threat scores",),
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


def unwrap_catalog(value: Any) -> dict[str, Any]:
    if isinstance(value, dict) and isinstance(value.get("data"), dict):
        return value["data"]
    if isinstance(value, dict):
        return value
    raise SmokeFailure("dataset catalog must be a JSON object")


def validate_catalog(
    snapshot: Snapshot,
    *,
    now: datetime | None = None,
    max_age: timedelta = timedelta(hours=72),
) -> list[str]:
    errors: list[str] = []
    if snapshot.status != 200:
        return [f"dataset-catalog: expected HTTP 200, got {snapshot.status}"]
    try:
        catalog = unwrap_catalog(json.loads(snapshot.body))
    except (json.JSONDecodeError, SmokeFailure) as exc:
        return [f"dataset-catalog: invalid payload: {exc}"]

    meta = catalog.get("meta")
    rows = catalog.get("datasets")
    if not isinstance(meta, dict):
        errors.append("dataset-catalog: meta must be an object")
        meta = {}
    if not isinstance(rows, list):
        return errors + ["dataset-catalog: datasets must be a list"]
    if len(rows) < 15:
        errors.append(f"dataset-catalog: expected at least 15 datasets, got {len(rows)}")

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

    generated = parse_timestamp(meta.get("generated_at"))
    check_now = (now or utc_now()).astimezone(timezone.utc)
    if generated is None:
        errors.append("dataset-catalog: meta.generated_at is missing or unparseable")
    else:
        age = check_now - generated
        if age < timedelta(minutes=-10):
            errors.append(
                f"dataset-catalog: generated_at is in the future by {-age.total_seconds()/60:.1f}m"
            )
        elif age > max_age:
            errors.append(
                f"dataset-catalog: stale by policy; age={age.total_seconds()/3600:.1f}h > {max_age.total_seconds()/3600:.1f}h"
            )
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

    try:
        catalog_snapshot, prior_failures = fetch_catalog(
            patterns_base, timeout=timeout, fetcher=fetcher
        )
        if prior_failures:
            print("Catalog endpoint fallbacks: " + " | ".join(prior_failures))
        errors.extend(
            validate_catalog(
                catalog_snapshot,
                now=now,
                max_age=timedelta(hours=max_catalog_age_hours),
            )
        )
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
