"""
Normalizer: SAM.gov raw records → solicitations.json

Reads  tools/mining/output/raw/sam_gov-*.jsonl
Merges into  DroneClear Components Visualizer/solicitations.json

New entries are added with source='sam'. Existing sam entries are updated
in-place by notice_id. usaspending/news entries are never touched.

ID scheme: 'sol-sam-' + first 10 hex chars of sha1(notice_id)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

RAW_DIR  = Path("tools/mining/output/raw")
SOL_FILE = Path("DroneClear Components Visualizer/solicitations.json")

# NAICS codes associated with UAS/drone procurement
DRONE_NAICS = {
    "336411",  # Aircraft manufacturing
    "336413",  # Other aircraft parts
    "334511",  # Search/navigation/guidance instruments
    "541330",  # Engineering services
    "541715",  # Research and development
    "336992",  # Military armored vehicle parts
    "334220",  # Radio/TV broadcast equipment
    "517110",  # Wired telecommunications
    "517210",  # Wireless telecommunications
}

# Blue UAS signals in title/description
BLUE_UAS_SIGNALS = {"blue uas", "blue list", "diu cleared", "blue suas", "ndaa 848", "section 848"}

# Gray zone signals
GRAY_ZONE_SIGNALS = {"dji", "autel", "parrot", "yuneec", "skydio", "chinese", "prc", "foreign"}


def _sol_id(notice_id: str) -> str:
    h = hashlib.sha1(notice_id.encode()).hexdigest()[:10]
    return f"sol-sam-{h}"


def _is_blue_uas(title: str) -> bool:
    t = title.lower()
    return any(sig in t for sig in BLUE_UAS_SIGNALS)


def _is_gray_zone(title: str) -> bool:
    t = title.lower()
    return any(sig in t for sig in GRAY_ZONE_SIGNALS)


def load_raw() -> list[dict]:
    records = []
    for p in sorted(RAW_DIR.glob("sam_gov-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("record_type") == "federal_opportunity":
                    records.append(r)
            except json.JSONDecodeError:
                continue
    return records


def normalize(raw: list[dict]) -> list[dict]:
    """Convert SAM.gov raw records to solicitations.json entries."""
    seen_ids: set[str] = set()
    entries = []
    for rec in raw:
        d = rec.get("data", {})
        notice_id = d.get("notice_id", "")
        if not notice_id or notice_id in seen_ids:
            continue
        seen_ids.add(notice_id)

        title = d.get("title", "")
        naics  = d.get("naics", "")
        amount = d.get("award_amount")

        entry = {
            "id":           _sol_id(notice_id),
            "source":       "sam",
            "source_label": "SAM.gov",
            "type":         "solicitation" if not d.get("award_date") else "award",
            "title":        title,
            "agency":       d.get("agency", ""),
            "sub_agency":   d.get("sub_agency", ""),
            "office":       d.get("office", ""),
            "recipient":    d.get("awardee") or "",
            "amount":       float(amount.replace("$","").replace(",","")) if isinstance(amount, str) else amount,
            "award_id":     notice_id,
            "posted_date":  d.get("posted", ""),
            "deadline":     d.get("response_deadline") or None,
            "naics":        naics or None,
            "set_aside":    d.get("set_aside") or None,
            "url":          rec.get("url", ""),
            "gray_zone_flag": _is_gray_zone(title),
            "blue_uas_flag":  _is_blue_uas(title),
            "naics_match":    naics[:6] in DRONE_NAICS if naics else False,
            "award_date":     d.get("award_date") or None,
        }
        entries.append(entry)
    return entries


def merge(existing: dict, new_entries: list[dict]) -> dict:
    """Merge new SAM entries into solicitations.json, dedup by award_id."""
    sols = existing.get("solicitations", [])

    # Index existing sam entries by award_id
    existing_sam: dict[str, int] = {}
    for i, s in enumerate(sols):
        if s.get("source") == "sam" and s.get("award_id"):
            existing_sam[s["award_id"]] = i

    added, updated = 0, 0
    for entry in new_entries:
        aid = entry["award_id"]
        if aid in existing_sam:
            sols[existing_sam[aid]] = entry
            updated += 1
        else:
            sols.append(entry)
            added += 1

    # Rebuild meta
    by_source: dict[str, int] = {}
    for s in sols:
        src = s.get("source", "unknown")
        by_source[src] = by_source.get(src, 0) + 1

    existing["solicitations"] = sols
    existing["meta"] = {
        "generated_at":       datetime.now(timezone.utc).isoformat(),
        "total_solicitations": len(sols),
        "by_source":          by_source,
        "gray_zone_count":    sum(1 for s in sols if s.get("gray_zone_flag")),
        "blue_uas_count":     sum(1 for s in sols if s.get("blue_uas_flag")),
        "open_count":         sum(1 for s in sols if s.get("deadline")),
    }
    print(f"  SAM.gov: +{added} new, {updated} updated, {len(sols)} total solicitations")
    return existing


def main():
    raw = load_raw()
    if not raw:
        print("  SAM.gov normalizer: no raw records found — skipping (need SAM_GOV_API_KEY run)")
        return

    new_entries = normalize(raw)
    if not raw:
        print("  SAM.gov: 0 records after normalization")
        return

    if SOL_FILE.exists():
        existing = json.loads(SOL_FILE.read_text(encoding="utf-8"))
    else:
        existing = {"meta": {}, "solicitations": []}

    merged = merge(existing, new_entries)
    SOL_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {SOL_FILE}")


if __name__ == "__main__":
    main()
