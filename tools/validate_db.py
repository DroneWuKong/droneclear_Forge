#!/usr/bin/env python3
"""Build-time data integrity validator for DroneClear Forge.

Loads forge_database.json (or a directory of parts-db/*.json) into an
in-memory SQLite database and runs integrity checks that are awkward to
express as Python loops: duplicates, orphan references, type drift,
and per-category statistics.

Exits 0 by default. Pass --strict to fail (exit 1) on any warning.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_DB_PATH = Path("DroneClear Components Visualizer/forge_database.json")

# Heuristic: uppercase prefix + dash + digits
PID_REF_RE = re.compile(r"^[A-Z]{2,6}-\d{3,6}$")

CORE_FIELDS = ("pid", "name", "manufacturer")


def load_source(path: Path) -> dict[str, list[dict]]:
    if path.is_dir():
        categories: dict[str, list[dict]] = {}
        for f in sorted(path.glob("*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data, list):
                categories[f.stem] = data
        return categories

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {path.stem: data}
    if isinstance(data, dict):
        return {
            k: v for k, v in data.items()
            if isinstance(v, list) and v and isinstance(v[0], dict)
        }
    raise SystemExit(f"Unsupported JSON shape in {path}")


def load_into_sqlite(categories: dict[str, list[dict]]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # Single table keeps cross-category queries cheap
    conn.execute("""
        CREATE TABLE parts (
            category TEXT NOT NULL,
            pid TEXT,
            name TEXT,
            manufacturer TEXT,
            manufacturer_country TEXT,
            price_usd REAL,
            weight_g REAL,
            tag_count INTEGER,
            raw_json TEXT NOT NULL
        )
    """)
    rows = []
    for cat, parts in categories.items():
        for p in parts:
            if not isinstance(p, dict):
                continue
            rows.append((
                cat,
                p.get("pid"),
                p.get("name"),
                p.get("manufacturer"),
                p.get("manufacturer_country"),
                _to_float(p.get("price_usd")),
                _to_float(p.get("weight_g")),
                len(p.get("tags") or []),
                json.dumps(p, ensure_ascii=False),
            ))
    conn.executemany("INSERT INTO parts VALUES (?,?,?,?,?,?,?,?,?)", rows)
    conn.execute("CREATE INDEX idx_pid ON parts(pid)")
    conn.execute("CREATE INDEX idx_cat ON parts(category)")
    conn.commit()
    return conn


def _to_float(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def run_checks(conn: sqlite3.Connection, categories: dict[str, list[dict]]):
    issues: list[str] = []
    ok: list[str] = []

    dup_intra = conn.execute("""
        SELECT category, pid, COUNT(*) AS n
        FROM parts WHERE pid IS NOT NULL
        GROUP BY category, pid HAVING n > 1
        ORDER BY n DESC, category, pid
    """).fetchall()
    if dup_intra:
        for r in dup_intra[:20]:
            issues.append(f"duplicate PID within {r['category']}: {r['pid']} ({r['n']} copies)")
        if len(dup_intra) > 20:
            issues.append(f"... and {len(dup_intra) - 20} more intra-category duplicates")
    else:
        ok.append("no intra-category duplicate PIDs")

    dup_cross = conn.execute("""
        SELECT pid, GROUP_CONCAT(DISTINCT category) AS cats,
               COUNT(DISTINCT category) AS n
        FROM parts WHERE pid IS NOT NULL
        GROUP BY pid HAVING n > 1
        ORDER BY n DESC, pid
    """).fetchall()
    if dup_cross:
        for r in dup_cross[:20]:
            issues.append(f"PID {r['pid']} appears in {r['n']} categories: {r['cats']}")
        if len(dup_cross) > 20:
            issues.append(f"... and {len(dup_cross) - 20} more cross-category duplicates")
    else:
        ok.append("no cross-category duplicate PIDs")

    for field in CORE_FIELDS:
        missing = conn.execute(
            f"SELECT category, COUNT(*) AS n FROM parts "
            f"WHERE {field} IS NULL OR {field} = '' "
            f"GROUP BY category HAVING n > 0 ORDER BY n DESC"
        ).fetchall()
        if missing:
            for r in missing:
                issues.append(f"{r['n']} parts missing '{field}' in {r['category']}")
        else:
            ok.append(f"all parts have '{field}'")

    for field in ("price_usd", "weight_g"):
        bad = _count_unparseable(categories, field)
        if bad:
            top = sorted(bad.items(), key=lambda kv: -kv[1])[:5]
            preview = ", ".join(f"{c}:{n}" for c, n in top)
            issues.append(
                f"{sum(bad.values())} parts have non-numeric '{field}' (top: {preview})"
            )
        else:
            ok.append(f"'{field}' parses as numeric everywhere")

    all_pids = {
        r["pid"]
        for r in conn.execute(
            "SELECT pid FROM parts WHERE pid IS NOT NULL"
        ).fetchall()
    }
    orphans: dict[str, int] = defaultdict(int)
    for cat, parts in categories.items():
        for p in parts:
            if not isinstance(p, dict):
                continue
            for val in _walk_strings(p):
                if PID_REF_RE.match(val) and val not in all_pids:
                    orphans[val] += 1
    if orphans:
        for ref, n in sorted(orphans.items(), key=lambda kv: -kv[1])[:20]:
            issues.append(f"orphan PID reference '{ref}' ({n} occurrences)")
        extra = len(orphans) - 20
        if extra > 0:
            issues.append(f"... and {extra} more orphan references")
    else:
        ok.append("no orphan PID references found")

    return ok, issues


def _walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_strings(v)


def _count_unparseable(categories, field):
    bad: dict[str, int] = defaultdict(int)
    for cat, parts in categories.items():
        for p in parts:
            if not isinstance(p, dict) or field not in p:
                continue
            v = p[field]
            if v is None or isinstance(v, (int, float)) and not isinstance(v, bool):
                continue
            if _to_float(v) is None:
                bad[cat] += 1
    return bad


def print_report(conn, ok, issues):
    counts = conn.execute(
        "SELECT category, COUNT(*) AS n FROM parts "
        "GROUP BY category ORDER BY category"
    ).fetchall()
    total = sum(r["n"] for r in counts)

    print(f"Loaded {len(counts)} categories, {total} parts into SQLite (in-memory).\n")
    print("Checks passed:")
    for line in ok:
        print(f"  [OK]   {line}")
    print()
    if issues:
        print(f"Warnings ({len(issues)}):")
        for line in issues:
            print(f"  [WARN] {line}")
    else:
        print("No warnings.")
    print()
    print("Per-category counts:")
    for r in counts:
        print(f"  {r['category']:<28} {r['n']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "path", nargs="?", type=Path, default=DEFAULT_DB_PATH,
        help=f"forge_database.json, single category JSON, or a directory "
             f"of parts-db/*.json files (default: {DEFAULT_DB_PATH})",
    )
    ap.add_argument(
        "--strict", action="store_true",
        help="exit 1 if any warning is found",
    )
    args = ap.parse_args()

    if not args.path.exists():
        print(f"error: {args.path} not found", file=sys.stderr)
        return 2

    categories = load_source(args.path)
    conn = load_into_sqlite(categories)
    ok, issues = run_checks(conn, categories)
    print_report(conn, ok, issues)
    return 1 if args.strict and issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
