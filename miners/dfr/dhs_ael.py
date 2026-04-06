"""
R-03 | DHS AEL 03OE-07-SUAS Miner
Pulls the DHS Authorized Equipment List for small UAS / DFR systems.
AEL item: 03OE-07-SUAS — Systems, Small Unmanned Aircraft System (sUAS)
Targets:
  https://www.fema.gov/authorized-equipment-list
  https://www.dhs.gov/sites/default/files/... (DFR TechNote PDF reference)
Cadence: weekly (version-tracked)
Output: data/dfr/raw/dhs_ael_YYYY-MM-DD.json
"""

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
AEL_CACHE = Path("data/dfr/ael_version_cache.json")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

AEL_TARGETS = [
    {
        "url": "https://www.fema.gov/authorized-equipment-list",
        "label": "FEMA AEL Main Page",
    },
    {
        "url": "https://www.fema.gov/sites/default/files/documents/fema_ael-categories-items.pdf",
        "label": "FEMA AEL Full PDF",
        "is_pdf": True,
    },
]

# AEL item numbers relevant to DFR
DFR_AEL_ITEMS = {
    "03OE-07-SUAS": "Systems, Small Unmanned Aircraft System (sUAS) — primary DFR item",
    "03OE-07-UASC": "Small UAS Controller",
    "03OE-07-UASG": "Small UAS Ground Support Equipment",
    "03OP-04-CCTV": "Video Surveillance Systems (relevant for DFR ground stations)",
}

UAS_KEYWORDS = {
    "unmanned aircraft", "uas", "suas", "drone", "unmanned aerial",
    "first responder", "dfr", "uav", "remotely piloted"
}


def load_version_cache() -> dict:
    if AEL_CACHE.exists():
        return json.loads(AEL_CACHE.read_text())
    return {}


def save_version_cache(cache: dict):
    AEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
    AEL_CACHE.write_text(json.dumps(cache, indent=2))


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def fetch_ael_page(url: str, label: str) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"[WARN] {label}: {e}", file=sys.stderr)
        return None


def extract_ael_content(html: str, url: str, label: str) -> list[dict]:
    records = []
    soup = BeautifulSoup(html, "html.parser")
    content = soup.select_one("main, #main-content, .main-content") or soup.body
    if not content:
        return records

    text = content.get_text(separator="\n", strip=True)
    lines = [l.strip() for l in text.splitlines() if len(l.strip()) > 20]

    # Find UAS-relevant lines
    uas_lines = [l for l in lines if any(kw in l.lower() for kw in UAS_KEYWORDS)]

    # Check for specific AEL item numbers
    found_items = {}
    for item_num, description in DFR_AEL_ITEMS.items():
        if item_num.lower() in text.lower():
            found_items[item_num] = description

    chash = content_hash(text)
    cache = load_version_cache()
    version_changed = cache.get(url) != chash
    if version_changed:
        print(f"[INFO] AEL content changed since last run — new version hash: {chash}")
        cache[url] = chash
        save_version_cache(cache)
    else:
        print(f"[INFO] AEL content unchanged (hash: {chash})")

    records.append({
        "id": f"dhs_ael_{TODAY}",
        "title": label,
        "url": url,
        "source": "fema_ael",
        "pub_date": TODAY,
        "version_hash": chash,
        "version_changed": version_changed,
        "dfr_ael_items_found": found_items,
        "uas_relevant_lines": uas_lines[:30],
        "full_text_preview": "\n".join(uas_lines[:10]),
        "vertical_tag": "dfr",
        "data_category": "regulatory",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    })
    return records


def build_ael_reference() -> dict:
    """
    Curated AEL reference record for DFR-relevant items.
    Based on DHS DFR TechNote (25_0708_st_dfrtn.pdf) and FEMA AEL documentation.
    """
    return {
        "id": f"dhs_ael_reference_{TODAY}",
        "source": "dhs_fema_curated",
        "snapshot_date": TODAY,
        "primary_dfr_ael_item": {
            "number": "03OE-07-SUAS",
            "title": "Systems, Small Unmanned Aircraft System (sUAS)",
            "description": "Covers DFR drone-in-a-box systems eligible for DHS grant reimbursement",
            "grant_programs": ["HSGP", "BSIR", "COPS Technology"],
            "ndaa_requirement": True,
            "asda_requirement": True,
            "notes": "Agencies must use NDAA-compliant platforms to qualify. Blue UAS list is not required but simplifies procurement."
        },
        "related_ael_items": DFR_AEL_ITEMS,
        "ndaa_compliant_platforms_known": [
            "Skydio X10D", "Skydio R10", "Skydio F10",
            "BRINC Lemur 2",
            "Flock Alpha",
            "Parrot ANAFI USA",
            "Inspired Flight IF800", "Inspired Flight IF1200A",
            "Teal 2", "Red Cat Golden Eagle",
            "Freefly Astro", "Freefly Alta X"
        ],
        "blue_uas_cleared_dfr_platforms": [
            "Skydio X10D", "Skydio R10",
            "BRINC Lemur 2",
            "Parrot ANAFI USA",
            "Inspired Flight IF800", "Inspired Flight IF1200A",
        ],
        "grant_notes": "AEL items are eligible for reimbursement under HSGP/BSIR/COPS only when platform meets NDAA/ASDA compliance. Agencies must confirm eligibility with their state administrative agency (SAA) before purchase.",
        "vertical_tag": "dfr",
        "data_category": "regulatory",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    }


def run():
    all_records = []

    for target in AEL_TARGETS:
        if target.get("is_pdf"):
            print(f"[INFO] Skipping PDF target (requires PDF parser): {target['label']}")
            continue
        print(f"[INFO] Fetching {target['label']}...")
        html = fetch_ael_page(target["url"], target["label"])
        if html:
            records = extract_ael_content(html, target["url"], target["label"])
            all_records.extend(records)

    # Always include curated reference
    all_records.append(build_ael_reference())
    print(f"[INFO] Added curated AEL reference record")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"dhs_ael_{TODAY}.json"
    out_path.write_text(json.dumps(all_records, indent=2))
    print(f"[DONE] {len(all_records)} records → {out_path}")
    return len(all_records)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
