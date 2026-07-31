#!/usr/bin/env python3
"""Read-only quality gate for critical UAS Forge and UAS Patterns surfaces.

The audit runs entirely in software. It reads committed source or built output,
checks public metadata and HTML contracts, and never requires camera, radio, or
other physical hardware. ``--dry-run`` explicitly documents the no-write mode.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CRITICAL_ROUTES = (
    "patterns-home",
    "miner-health",
    "actors",
    "ttps",
    "adversary-bom",
    "mirroring",
    "evasion",
    "forecast-accountability",
)
REQUIRED_HEADERS = {
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "x-permitted-cross-domain-policies",
    "permissions-policy",
}
PUBLIC_HOSTS = {"uas-forge.com", "www.uas-forge.com", "uas-patterns.com", "www.uas-patterns.com"}
IGNORED_PREFIXES = ("/api/", "/static/", "/cdn-cgi/", "/.well-known/")
RETIRED_CLAIMS = (
    "composite threat scores",
    "no money flowing",
    "56-day series",
    "pie v0.9",
    "3,885+ drone components",
    "271 drone platforms",
)
UNSAFE_SCHEMES = {"javascript", "vbscript"}


@dataclass
class Finding:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class AuditReport:
    findings: list[Finding] = field(default_factory=list)
    files_checked: list[str] = field(default_factory=list)
    catalog_datasets: int = 0

    def add(self, severity: str, code: str, path: Path | str, message: str) -> None:
        self.findings.append(Finding(severity, code, str(path), message))

    @property
    def errors(self) -> list[Finding]:
        return [item for item in self.findings if item.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [item for item in self.findings if item.severity == "warning"]

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": not self.errors,
            "files_checked": self.files_checked,
            "catalog_datasets": self.catalog_datasets,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "findings": [item.__dict__ for item in self.findings],
        }


class DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.links: list[dict[str, str]] = []
        self.images: list[dict[str, str]] = []
        self.buttons: list[dict[str, Any]] = []
        self.main_count = 0
        self.h1_count = 0
        self._button_stack: list[dict[str, Any]] = []
        self._script_stack: list[dict[str, Any]] = []
        self.scripts: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): (value or "") for key, value in attrs}
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "a" and values.get("href"):
            self.links.append(values)
        elif tag == "img":
            self.images.append(values)
        elif tag == "main":
            self.main_count += 1
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "button":
            row: dict[str, Any] = {"attrs": values, "text": []}
            self.buttons.append(row)
            self._button_stack.append(row)
        elif tag == "script":
            row = {"attrs": values, "text": []}
            self._script_stack.append(row)

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._button_stack:
            self._button_stack.pop()
        elif tag == "script" and self._script_stack:
            row = self._script_stack.pop()
            attrs = row["attrs"]
            if not attrs.get("src"):
                self.scripts.append({
                    "type": attrs.get("type", ""),
                    "text": "".join(row["text"]),
                })

    def handle_data(self, data: str) -> None:
        if self._button_stack:
            self._button_stack[-1]["text"].append(data)
        if self._script_stack:
            self._script_stack[-1]["text"].append(data)


def load_routes(root: Path, report: AuditReport) -> set[str]:
    path = root / "build_static.py"
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        pages: dict[str, str] | None = None
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "PAGES" for target in node.targets):
                value = ast.literal_eval(node.value)
                if isinstance(value, dict):
                    pages = value
                    break
        if pages is None:
            raise ValueError("PAGES mapping not found")
    except Exception as exc:
        report.add("error", "routes-unreadable", path, f"Could not load route map: {exc}")
        return {"/"}

    routes = {"/"}
    for output in pages.values():
        output = str(output).replace("\\", "/")
        if output == "index.html":
            routes.add("/")
        elif output.endswith("/index.html"):
            routes.add("/" + output[: -len("index.html")])
        else:
            routes.add("/" + output.lstrip("/"))
    return routes


def critical_html_paths(site_dir: Path, built: bool, all_html: bool) -> list[Path]:
    if all_html:
        return sorted(site_dir.rglob("*.html"))
    paths: list[Path] = []
    for route in CRITICAL_ROUTES:
        path = site_dir / route / "index.html" if built else site_dir / f"{route}.html"
        if path.exists():
            paths.append(path)
    return paths


def normalize_route(href: str) -> str | None:
    href = href.strip()
    if not href or href.startswith(("#", "mailto:", "tel:")):
        return None
    parsed = urlparse(href)
    scheme = parsed.scheme.lower()
    if scheme and scheme not in {"http", "https"}:
        return None
    if parsed.netloc and parsed.hostname not in PUBLIC_HOSTS:
        return None
    path = parsed.path or "/"
    # Built pages live at /<route>/index.html, so links rewritten by the static
    # builder as ../ correctly resolve to the site root. Normalize any local
    # relative route into the same leading-slash form as the PAGES route map.
    if not parsed.netloc and not path.startswith("/"):
        while path.startswith("../"):
            path = path[3:]
        path = path.lstrip("./")
        path = "/" + path if path else "/"
    if path.startswith(IGNORED_PREFIXES):
        return None
    if path.endswith(".html") or "." in Path(path).name:
        return path
    if not path.endswith("/"):
        path += "/"
    return path


def check_inline_scripts(path: Path, scripts: list[dict[str, str]], report: AuditReport, node: str | None) -> None:
    if not node or path.stem not in {"patterns-home", "miner-health", "index"}:
        return
    for index, script in enumerate(scripts, start=1):
        text = script["text"].strip()
        if not text or script["type"].lower() in {"application/ld+json", "application/json"}:
            continue
        suffix = ".mjs" if script["type"].lower() == "module" else ".js"
        with tempfile.NamedTemporaryFile("w", suffix=suffix, encoding="utf-8", delete=False) as handle:
            handle.write(text)
            temp_path = Path(handle.name)
        try:
            result = subprocess.run([node, "--check", str(temp_path)], text=True, capture_output=True, timeout=20, check=False)
            if result.returncode:
                detail = (result.stderr or result.stdout).strip().splitlines()[-1] if (result.stderr or result.stdout).strip() else "node --check failed"
                report.add("error", "javascript-syntax", path, f"Inline script {index}: {detail}")
        except (OSError, subprocess.TimeoutExpired) as exc:
            report.add("warning", "javascript-check-unavailable", path, f"Could not run Node syntax check: {exc}")
        finally:
            temp_path.unlink(missing_ok=True)


def audit_html(path: Path, routes: set[str], report: AuditReport, node: str | None) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        report.add("error", "html-unreadable", path, str(exc))
        return
    report.files_checked.append(str(path))
    parser = DocumentParser()
    try:
        parser.feed(text)
    except Exception as exc:
        report.add("error", "html-parse", path, str(exc))
        return

    for value, count in Counter(parser.ids).items():
        if count > 1:
            report.add("error", "duplicate-id", path, f"id={value!r} occurs {count} times")

    if parser.main_count != 1:
        report.add("warning", "main-landmark", path, f"Expected one <main>; found {parser.main_count}")
    if parser.h1_count != 1:
        report.add("warning", "page-heading", path, f"Expected one <h1>; found {parser.h1_count}")

    for image in parser.images:
        if "alt" not in image:
            report.add("warning", "image-alt", path, f"Image missing alt text: {image.get('src', '(unknown src)')}")

    for button in parser.buttons:
        attrs = button["attrs"]
        text_value = "".join(button["text"]).strip()
        if not (text_value or attrs.get("aria-label") or attrs.get("title")):
            report.add("warning", "button-name", path, "Button has no text, aria-label, or title")

    for link in parser.links:
        href = link.get("href", "").strip()
        parsed = urlparse(href)
        if parsed.scheme.lower() in UNSAFE_SCHEMES or href.lower().startswith("data:text/html"):
            report.add("error", "unsafe-link", path, href)
        if link.get("target", "").lower() == "_blank":
            rel = set(link.get("rel", "").lower().split())
            if not {"noopener", "noreferrer"}.issubset(rel):
                report.add("error", "new-window-isolation", path, f"_blank link lacks rel=\"noopener noreferrer\": {href}")
        route = normalize_route(href)
        if route and route not in routes:
            report.add("error", "broken-internal-route", path, f"No built route for {href} (normalized {route})")

    lower = text.lower()
    for phrase in RETIRED_CLAIMS:
        if phrase in lower:
            report.add("error", "retired-public-claim", path, f"Retired claim found: {phrase!r}")

    check_inline_scripts(path, parser.scripts, report, node)


def audit_headers(root: Path, report: AuditReport) -> None:
    path = root / "_headers"
    try:
        text = path.read_text(encoding="utf-8").lower()
    except Exception as exc:
        report.add("error", "headers-unreadable", path, str(exc))
        return
    report.files_checked.append(str(path))
    present = {match.group(1).strip().lower() for match in re.finditer(r"^\s*([a-z0-9-]+)\s*:", text, flags=re.MULTILINE)}
    for header in sorted(REQUIRED_HEADERS - present):
        report.add("error", "security-header-missing", path, header)
    if "/static/dataset_catalog.json" not in text or "no-store" not in text:
        report.add("error", "catalog-cache-policy", path, "dataset_catalog.json must have an explicit no-store policy")


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def catalog_path(site_dir: Path, built: bool) -> Path:
    return site_dir / "static" / "dataset_catalog.json" if built else site_dir / "dataset_catalog.json"


def audit_catalog(site_dir: Path, built: bool, report: AuditReport, required: bool, now: datetime) -> None:
    path = catalog_path(site_dir, built)
    if not path.exists():
        if required:
            report.add("error", "catalog-missing", path, "Public dataset catalog is required")
        return
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        report.add("error", "catalog-invalid-json", path, str(exc))
        return
    report.files_checked.append(str(path))
    if not isinstance(doc, dict) or not isinstance(doc.get("meta"), dict) or not isinstance(doc.get("datasets"), list):
        report.add("error", "catalog-contract", path, "Expected object with meta object and datasets list")
        return
    rows = doc["datasets"]
    report.catalog_datasets = len(rows)
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    if len(ids) != len(rows) or any(not isinstance(value, str) or not value for value in ids):
        report.add("error", "catalog-id", path, "Every dataset must have a non-empty string id")
    for value, count in Counter(ids).items():
        if count > 1:
            report.add("error", "catalog-duplicate-id", path, f"Dataset id {value!r} occurs {count} times")

    required_fields = {"id", "label", "purpose", "role", "required", "status", "provenance", "quality", "caveat"}
    for row in rows:
        if not isinstance(row, dict):
            report.add("error", "catalog-row", path, "Dataset row must be an object")
            continue
        missing = sorted(required_fields - row.keys())
        if missing:
            report.add("error", "catalog-fields", path, f"{row.get('id', '?')}: missing {', '.join(missing)}")
        if row.get("required") and row.get("status") in {"unavailable", "invalid", "invalid-future"}:
            report.add("error", "required-dataset-broken", path, f"{row.get('id')}: {row.get('status')} — {row.get('status_reason', '')}")
        for field_name in ("generated_at", "coverage_start", "coverage_end"):
            raw = row.get(field_name)
            if raw and parse_iso(raw) is None:
                report.add("error", "catalog-date", path, f"{row.get('id')}: unparseable {field_name}={raw!r}")
            parsed = parse_iso(raw)
            if parsed and parsed > now + timedelta(hours=24):
                report.add("error", "catalog-future-date", path, f"{row.get('id')}: {field_name} extends into the future: {raw}")

    generated = parse_iso(doc["meta"].get("generated_at"))
    if generated is None:
        report.add("error", "catalog-generated-at", path, "meta.generated_at is missing or unparseable")
    elif generated > now + timedelta(hours=24):
        report.add("error", "catalog-future-date", path, f"meta.generated_at extends into the future: {generated.isoformat()}")


def audit_readme(root: Path, report: AuditReport) -> None:
    path = root / "README.md"
    try:
        text = path.read_text(encoding="utf-8").lower()
    except Exception as exc:
        report.add("error", "readme-unreadable", path, str(exc))
        return
    report.files_checked.append(str(path))
    for phrase in RETIRED_CLAIMS:
        if phrase in text:
            report.add("error", "retired-public-claim", path, f"Retired claim found: {phrase!r}")
    if "dataset_catalog.json" not in text:
        report.add("warning", "catalog-documentation", path, "README does not identify the public data catalog")


def run_audit(
    root: Path,
    site_dir: Path,
    *,
    built: bool = False,
    all_html: bool = False,
    require_catalog: bool = False,
    check_js: bool = True,
    now: datetime | None = None,
) -> AuditReport:
    report = AuditReport()
    routes = load_routes(root, report)
    node = shutil.which("node") if check_js else None
    for path in critical_html_paths(site_dir, built, all_html):
        audit_html(path, routes, report, node)
    if not critical_html_paths(site_dir, built, all_html):
        report.add("error", "critical-pages-missing", site_dir, "No critical public HTML pages were found")
    audit_headers(root, report)
    audit_readme(root, report)
    audit_catalog(site_dir, built, report, require_catalog, (now or datetime.now(timezone.utc)).astimezone(timezone.utc))
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--site-dir", type=Path, default=None, help="source or built site directory")
    parser.add_argument("--built", action="store_true", help="site-dir contains nested built route indexes")
    parser.add_argument("--all", action="store_true", help="audit every HTML file instead of the critical public surfaces")
    parser.add_argument("--require-catalog", action="store_true")
    parser.add_argument("--no-node", action="store_true", help="skip inline JavaScript syntax checks")
    parser.add_argument("--strict", action="store_true", help="return non-zero when blocking findings exist")
    parser.add_argument("--dry-run", action="store_true", help="explicit no-write/simulation mode (the audit is always read-only)")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report")
    parser.add_argument("--now", help="override current time for deterministic testing")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = args.root.resolve()
    site_dir = args.site_dir or (root / ("build" if args.built else "forge-source"))
    if not site_dir.is_absolute():
        site_dir = root / site_dir
    now = parse_iso(args.now) if args.now else datetime.now(timezone.utc)
    if now is None:
        print(f"ERROR: invalid --now value: {args.now!r}", file=sys.stderr)
        return 2

    report = run_audit(
        root,
        site_dir.resolve(),
        built=args.built,
        all_html=args.all,
        require_catalog=args.require_catalog,
        check_js=not args.no_node,
        now=now,
    )

    if args.json:
        print(json.dumps(report.as_dict(), indent=2, ensure_ascii=False))
    else:
        print(f"Public site audit: {len(report.files_checked)} files, {report.catalog_datasets} datasets")
        print(f"  blocking findings: {len(report.errors)}")
        print(f"  warnings:          {len(report.warnings)}")
        for item in report.findings:
            print(f"  {item.severity.upper():7} {item.code:28} {item.path}: {item.message}")
        if args.dry_run:
            print("Dry run: read-only audit; no repository files were modified")

    return 1 if args.strict and report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
