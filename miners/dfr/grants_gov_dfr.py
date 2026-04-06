"""
G-01 | Grants.gov DFR Keyword Monitor
Queries the Grants.gov public API for UAS/DFR-relevant grant opportunities.
API docs: https://www.grants.gov/web/grants/search-grants.html
Cadence: weekly
Output: data/dfr/raw/grants_gov_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# Grants.gov search API endpoint
GRANTS_API = "https://apply07.grants.gov/grantsws/rest/opportunities/search/"

DFR_KEYWORDS = [
    "drone as first responder",
    "unmanned aircraft",
    "small unmanned aircraft",
    "UAS public safety",
    "drone public safety",
    "first responder drone",
    "BVLOS",
    "unmanned aerial vehicle",
    "drone technology",
    "drone program",
]

# Agency codes most likely to fund DFR
TARGET_AGENCIES = [
    "DHS",   # Dept of Homeland Security
    "DOJ",   # Dept of Justice (COPS)
    "DOT",   # Dept of Transportation
    "DOD",   # Dept of Defense
    "FEMA",  # FEMA (under DHS)
]

GRANT_CATEGORIES = {
    "O": "Other",
    "RA": "Recovery Act",
    "ED": "Education",
    "EN": "Environment",
    "HL": "Health",
    "HU": "Humanities",
    "IIJ": "Infrastructure Investment and Jobs",
    "IS": "Income Security and Social Services",
    "LJL": "Law, Justice and Legal Services",
    "NR": "Natural Resources",
    "RD": "Regional Development",
    "ST": "Science and Technology and other Research and Development",
    "T": "Transportation",
    "ACA": "Affordable Care Act",
    "AG": "Agriculture",
    "AR": "Arts",
    "BC": "Business and Commerce",
    "CD": "Community Development",
    "CP": "Consumer Protection",
    "DPR": "Disaster Prevention and Relief",
    "ELT": "Employment, Labor and Training",
    "EN": "Energy",
    "FN": "Food and Nutrition",
    "HL": "Health",
    "HO": "Housing",
}


def search_grants(keyword: str) -> list[dict]:
    """Query Grants.gov API for a single keyword."""
    payload = {
        "keyword": keyword,
        "oppStatuses": "forecasted|posted",
        "rows": 25,
        "sortBy": "openDate|desc",
    }
    try:
        r = requests.post(
            GRANTS_API,
            json=payload,
            headers={**HEADERS, "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("oppHits", []) or []
    except Exception as e:
        print(f"[WARN] Grants.gov search '{keyword}' failed: {e}", file=sys.stderr)
        return []


def normalize_grant(hit: dict, keyword: str) -> dict:
    """Normalize a Grants.gov result to canonical schema."""
    title = hit.get("title", "")
    agency = hit.get("agencyName", "") or hit.get("agency", "")
    opp_number = hit.get("number", "") or hit.get("id", "")
    close_date = hit.get("closeDate", "") or hit.get("closeDateStr", "")
    open_date = hit.get("openDate", "") or hit.get("openDateStr", "")
    synopsis = hit.get("synopsis", "") or hit.get("description", "")
    award_ceiling = hit.get("awardCeiling", "")
    award_floor = hit.get("awardFloor", "")
    category = hit.get("oppCategory", {}).get("description", "") if isinstance(hit.get("oppCategory"), dict) else ""
    cfda = hit.get("cfdaList", [])

    return {
        "id": f"grants_gov_{re.sub(r'[^a-z0-9]', '_', opp_number.lower() or title.lower()[:40])}",
        "title": title,
        "url": f"https://www.grants.gov/web/grants/view-opportunity.html?oppId={hit.get('id', '')}",
        "source": "grants_gov",
        "agency": agency,
        "opportunity_number": opp_number,
        "open_date": open_date,
        "close_date": close_date,
        "award_ceiling": award_ceiling,
        "award_floor": award_floor,
        "category": category,
        "cfda_numbers": cfda,
        "synopsis": str(synopsis)[:600],
        "matched_keyword": keyword,
        "pub_date": open_date[:10] if open_date else TODAY,
        "vertical_tag": "dfr",
        "data_category": "grant",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    }


def run():
    all_hits = {}  # keyed by opp_number to dedupe

    for keyword in DFR_KEYWORDS:
        print(f"[INFO] Searching: '{keyword}'...")
        hits = search_grants(keyword)
        print(f"[INFO]  → {len(hits)} results")
        for hit in hits:
            key = hit.get("number") or hit.get("id") or hit.get("title", "")
            if key and key not in all_hits:
                all_hits[key] = normalize_grant(hit, keyword)

    records = list(all_hits.values())
    print(f"[INFO] Total unique grants: {len(records)}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"grants_gov_{TODAY}.json"
    out_path.write_text(json.dumps(records, indent=2))
    print(f"[DONE] {len(records)} records → {out_path}")
    return len(records)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
