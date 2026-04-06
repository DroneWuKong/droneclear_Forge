"""
DFR Normalization + Tagging Pipeline
Loads all raw DFR miner outputs, normalizes schema, deduplicates,
tags by data_category, and writes to canonical dfr_master.json.

Usage:
  python scripts/dfr/normalize.py
  python scripts/dfr/normalize.py --date 2026-04-06
  python scripts/dfr/normalize.py --dry-run
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

RAW_DIR = Path("data/dfr/raw")
NORMALIZED_DIR = Path("data/dfr/normalized")
MASTER_PATH = Path("data/dfr/dfr_master.json")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# Category inference rules — applied if data_category missing or ambiguous
CATEGORY_RULES = [
    ("regulatory", ["faa", "beyond", "bvlos", "waiver", "part 107", "part 108", "ael", "asda",
                    "ndaa", "blue uas", "authorization", "rulemaking", "federal register",
                    "compliance", "grant eligib", "fema", "dhs"]),
    ("grant", ["grant", "cops program", "homeland security grant", "bsir", "fema bric",
               "budget", "rfp", "procurement", "funding", "award", "allocation"]),
    ("platform_intel", ["skydio", "brinc", "flock alpha", "parrot anafi", "inspired flight",
                        "teal drone", "red cat", "freefly", "drone dock", "aerodome",
                        "platform", "drone-in-a-box", "dock", "hextronics", "avss"]),
    ("vendor_intel", ["flying lion", "skyfireai", "axon air", "droneresponders",
                      "nokia drone", "dronesense", "votix", "airspace link", "matrixspace",
                      "uavionix", "echodyne"]),
    ("market_signal", []),  # fallback
]

REQUIRED_FIELDS = {"id", "title", "source", "vertical_tag", "data_category", "mined_at"}


def infer_category(record: dict) -> str:
    """Infer data_category from title + summary + source if not set."""
    existing = record.get("data_category", "")
    if existing and existing != "market_signal":
        return existing  # trust explicit category unless it's the generic fallback

    combined = " ".join([
        record.get("title", ""),
        record.get("summary", ""),
        record.get("full_text_preview", ""),
        record.get("source", ""),
    ]).lower()

    for category, keywords in CATEGORY_RULES:
        if any(kw in combined for kw in keywords):
            return category
    return "market_signal"


def normalize_record(raw: dict, source_file: str) -> dict | None:
    """Normalize a single raw record to canonical schema."""
    if not raw.get("title") and not raw.get("id"):
        return None

    # Build canonical ID
    title_slug = re.sub(r"[^a-z0-9]", "_", raw.get("title", raw.get("id", "unknown")).lower())[:60]
    source_slug = re.sub(r"[^a-z0-9]", "_", raw.get("source", "unknown").lower())
    date_slug = raw.get("pub_date", TODAY)[:10].replace("-", "")
    canonical_id = f"{source_slug}_{title_slug}_{date_slug}"

    # Normalize pub_date
    pub_date = raw.get("pub_date", "")
    if pub_date and len(pub_date) > 10:
        pub_date = pub_date[:10]

    record = {
        "id": canonical_id,
        "raw_id": raw.get("id", ""),
        "title": raw.get("title", "").strip(),
        "url": raw.get("url", ""),
        "source": raw.get("source", "unknown"),
        "source_file": source_file,
        "pub_date": pub_date,
        "summary": (raw.get("summary") or raw.get("full_text_preview") or "")[:600].strip(),
        "vertical_tag": raw.get("vertical_tag", "dfr"),
        "data_category": infer_category(raw),
        "mined_at": raw.get("mined_at", datetime.now(timezone.utc).isoformat()),
        "normalized_at": datetime.now(timezone.utc).isoformat(),
    }

    # Carry over extra fields without overwriting canonical schema
    extra_keys = {
        "tags", "categories", "relevance_matched", "content_blocks",
        "version_hash", "version_changed", "dfr_ael_items_found",
        "data", "snapshot_date", "doc_type", "platforms", "ndaa_status",
    }
    for key in extra_keys:
        if key in raw:
            record[key] = raw[key]

    return record


def load_raw_files(date_filter: str | None = None) -> list[tuple[dict, str]]:
    """Load all raw JSON files from RAW_DIR. Optionally filter by date."""
    raw_records = []
    if not RAW_DIR.exists():
        print(f"[WARN] Raw dir {RAW_DIR} does not exist — nothing to normalize", file=sys.stderr)
        return raw_records

    for f in sorted(RAW_DIR.glob("*.json")):
        if date_filter and date_filter not in f.name:
            continue
        try:
            data = json.loads(f.read_text())
            if isinstance(data, list):
                for item in data:
                    raw_records.append((item, f.name))
            elif isinstance(data, dict):
                raw_records.append((data, f.name))
        except Exception as e:
            print(f"[WARN] Could not parse {f.name}: {e}", file=sys.stderr)

    print(f"[INFO] Loaded {len(raw_records)} raw records from {RAW_DIR}")
    return raw_records


def load_master() -> dict:
    """Load existing master database."""
    if MASTER_PATH.exists():
        try:
            return json.loads(MASTER_PATH.read_text())
        except Exception as e:
            print(f"[WARN] Could not load master: {e} — starting fresh", file=sys.stderr)
    return {"records": [], "meta": {}}


def save_master(master: dict):
    MASTER_PATH.parent.mkdir(parents=True, exist_ok=True)
    MASTER_PATH.write_text(json.dumps(master, indent=2))


def run(date_filter: str | None = None, dry_run: bool = False):
    raw_records = load_raw_files(date_filter)
    if not raw_records:
        print("[INFO] No raw records to process.")
        return

    # Normalize
    normalized = []
    skipped = 0
    for raw, source_file in raw_records:
        record = normalize_record(raw, source_file)
        if record:
            normalized.append(record)
        else:
            skipped += 1

    print(f"[INFO] Normalized: {len(normalized)} | Skipped: {skipped}")

    # Deduplicate against master
    master = load_master()
    existing_ids = {r["id"] for r in master.get("records", [])}
    existing_urls = {r["url"] for r in master.get("records", []) if r.get("url")}

    new_records = []
    dupes = 0
    for r in normalized:
        if r["id"] in existing_ids:
            dupes += 1
            continue
        if r.get("url") and r["url"] in existing_urls:
            dupes += 1
            continue
        new_records.append(r)
        existing_ids.add(r["id"])
        if r.get("url"):
            existing_urls.add(r["url"])

    print(f"[INFO] New records: {len(new_records)} | Duplicates skipped: {dupes}")

    # Write normalized batch
    if not dry_run:
        NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)
        batch_path = NORMALIZED_DIR / f"dfr_{TODAY}.json"
        batch_path.write_text(json.dumps(new_records, indent=2))
        print(f"[INFO] Wrote normalized batch → {batch_path}")

    # Update master
    if not dry_run:
        master["records"] = master.get("records", []) + new_records
        master["meta"] = {
            "total_records": len(master["records"]),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "vertical": "dfr",
            "sources": list({r["source"] for r in master["records"]}),
            "categories": list({r["data_category"] for r in master["records"]}),
        }
        save_master(master)
        print(f"[DONE] Master updated → {MASTER_PATH} ({master['meta']['total_records']} total records)")
    else:
        print(f"[DRY-RUN] Would add {len(new_records)} records to master (currently {len(master.get('records', []))} records)")

    # Print category breakdown
    from collections import Counter
    cats = Counter(r["data_category"] for r in new_records)
    print("\n[INFO] Category breakdown (new records):")
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DFR normalization pipeline")
    parser.add_argument("--date", help="Filter raw files by date string (e.g. 2026-04-06)")
    parser.add_argument("--dry-run", action="store_true", help="Run without writing output")
    args = parser.parse_args()
    run(date_filter=args.date, dry_run=args.dry_run)
