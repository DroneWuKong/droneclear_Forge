"""
R-01 | FAA BEYOND Waiver Tracker
Tracks FAA Part 107.145 / BEYOND authorization approvals.
Targets:
  https://www.faa.gov/uas/advanced_operations/beyond_visual_line_of_sight
  https://faadronezone.faa.gov (public waiver data where available)
Cadence: weekly
Output: data/dfr/raw/faa_beyond_YYYY-MM-DD.json

NOTE: FAA does not publish a live machine-readable BEYOND approval list.
This miner pulls publicly available waiver data from:
  1. FAA BEYOND page for policy updates and aggregate counts
  2. FAA UAS Data Delivery System (public CSV exports when available)
  3. FR (Federal Register) for new rulemakings (Part 108 monitoring)
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

FAA_TARGETS = [
    {
        "url": "https://www.faa.gov/uas/advanced_operations/beyond_visual_line_of_sight",
        "label": "FAA BEYOND main page",
        "data_category": "regulatory",
    },
    {
        "url": "https://www.faa.gov/uas/advanced_operations/part107_waivers",
        "label": "FAA Part 107 Waivers",
        "data_category": "regulatory",
    },
    {
        "url": "https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107",
        "label": "FAA Part 107 Newsroom",
        "data_category": "regulatory",
    },
]

# Federal Register — monitor for Part 108 NPRM / Final Rule
FEDERAL_REGISTER_TARGETS = [
    {
        "url": "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagency_ids%5D%5B%5D=FAA&conditions%5Bterm%5D=unmanned+aircraft+BVLOS&per_page=10&order=newest",
        "label": "Federal Register FAA BVLOS",
        "data_category": "regulatory",
    },
]

REGULATORY_KEYWORDS = {
    "beyond visual line of sight", "bvlos", "part 107.145", "part 108",
    "waiver", "authorization", "remote operations", "drone as first responder",
    "dfr", "public safety", "beyond authorization", "rulemaking", "nprm",
    "final rule", "parachute requirement", "anti-collision", "detect and avoid",
    "daa", "coa", "certificate of authorization"
}


def fetch_html(url: str, label: str) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=25)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"[WARN] {label} fetch failed: {e}", file=sys.stderr)
        return None


def extract_faa_page(html: str, meta: dict) -> list[dict]:
    """Extract policy updates, counts, and key facts from FAA pages."""
    records = []
    soup = BeautifulSoup(html, "html.parser")

    # Extract main content paragraphs
    content_area = (
        soup.select_one("main")
        or soup.select_one("#main-content")
        or soup.select_one(".main-content")
        or soup.body
    )
    if not content_area:
        return records

    # Grab all meaningful paragraphs and headings
    elements = content_area.select("h1, h2, h3, h4, p, li")
    content_blocks = []
    for el in elements:
        text = el.get_text(strip=True)
        if len(text) > 30 and any(kw in text.lower() for kw in REGULATORY_KEYWORDS):
            content_blocks.append(text)

    if content_blocks:
        records.append({
            "id": f"faa_beyond_{re.sub(r'[^a-z0-9]', '_', meta['label'].lower())}_{TODAY}",
            "title": meta["label"],
            "url": meta["url"],
            "source": "faa_gov",
            "pub_date": TODAY,
            "content_blocks": content_blocks[:20],  # cap at 20 blocks
            "full_text_preview": " ".join(content_blocks)[:1000],
            "vertical_tag": "dfr",
            "data_category": meta["data_category"],
            "mined_at": datetime.now(timezone.utc).isoformat(),
        })
    return records


def fetch_federal_register(target: dict) -> list[dict]:
    """Pull NPRM/Final Rule notices from Federal Register API."""
    records = []
    try:
        r = requests.get(target["url"], headers=HEADERS, timeout=25)
        r.raise_for_status()
        data = r.json()
        for doc in data.get("results", []):
            title = doc.get("title", "")
            doc_type = doc.get("type", "")
            pub_date = doc.get("publication_date", "")
            html_url = doc.get("html_url", "")
            abstract = doc.get("abstract", "") or ""
            combined = f"{title} {abstract}"
            if not any(kw in combined.lower() for kw in REGULATORY_KEYWORDS):
                continue
            records.append({
                "id": f"fr_{doc.get('document_number', '')}",
                "title": title,
                "url": html_url,
                "source": "federal_register",
                "doc_type": doc_type,
                "pub_date": pub_date,
                "summary": abstract[:500],
                "vertical_tag": "dfr",
                "data_category": "regulatory",
                "mined_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[WARN] Federal Register fetch failed: {e}", file=sys.stderr)
    return records


def build_waiver_status_snapshot() -> dict:
    """
    Build a structured status snapshot of known BEYOND waiver data.
    Manually curated baseline — update as FAA publishes new aggregate data.
    """
    return {
        "id": f"faa_beyond_status_{TODAY}",
        "source": "faa_gov_curated",
        "snapshot_date": TODAY,
        "data": {
            "process_change_date": "2025-05",
            "old_approval_timeline_months": 11,
            "new_approval_timeline_days": 7,
            "fastest_approval_hours": 2,
            "submissions_as_of_june_2025": 300,
            "approved_as_of_june_2025": 214,
            "pending_as_of_june_2025": 78,
            "pending_needs_agency_action": 58,
            "pending_needs_review": 20,
            "yoy_growth_multiplier": 6,
            "required_equipment": [
                "parachute system",
                "anti-collision lighting",
                "detect and avoid (DAA) capability"
            ],
            "part_108_status": "expected_mid_2026",
            "part_108_description": "Will replace case-by-case waivers with standardized national BVLOS framework",
            "notes": "Data sourced from Police1 / DRONERESPONDERS June 2025 reporting. Update when FAA publishes new aggregate figures."
        },
        "vertical_tag": "dfr",
        "data_category": "regulatory",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    }


def run():
    all_records = []

    # FAA page scrapes
    for target in FAA_TARGETS:
        print(f"[INFO] Fetching {target['label']}...")
        html = fetch_html(target["url"], target["label"])
        if html:
            records = extract_faa_page(html, target)
            print(f"[INFO]  → {len(records)} regulatory records")
            all_records.extend(records)

    # Federal Register API
    for target in FEDERAL_REGISTER_TARGETS:
        print(f"[INFO] Querying Federal Register: {target['label']}...")
        records = fetch_federal_register(target)
        print(f"[INFO]  → {len(records)} FR documents")
        all_records.extend(records)

    # Curated status snapshot
    snapshot = build_waiver_status_snapshot()
    all_records.append(snapshot)
    print(f"[INFO] Added BEYOND waiver status snapshot")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"faa_beyond_{TODAY}.json"
    out_path.write_text(json.dumps(all_records, indent=2))
    print(f"[DONE] {len(all_records)} records → {out_path}")
    return len(all_records)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
