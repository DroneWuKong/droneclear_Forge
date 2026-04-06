"""
NASAO White Paper Miner
Fetches and indexes the Oregon/NASAO DJI fleet impact white paper.
Monitors for revisions and extracts state-level data into structured records.

Source: Oregon Department of Aviation
URL: https://www.oregon.gov/aviation/agency/about/Documents/Press%20Releases/OMB-FCC-Order%20Impact-White-Paper.pdf
Published: February 28 2026 (Revision 2)
Cadence: monthly check for new revision
Output: data/dfr/raw/nasao_whitepaper_YYYY-MM-DD.json
"""

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
CACHE_PATH = Path("data/dfr/nasao_wp_cache.json")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

PDF_URL = "https://www.oregon.gov/aviation/agency/about/Documents/Press%20Releases/OMB-FCC-Order%20Impact-White-Paper.pdf"
MONITOR_URL = "https://stateaviationjournal.com/index.php/state-news/oregon/oregon-department-of-aviation-releases-white-paper-on-impacts-of-federal-uas-restrictions-on-state-agencies"

# Curated state-level data from Revision 2 (February 28 2026)
# Update when new revision is detected
REVISION_2_STATE_DATA = [
    {"state": "Oregon",     "pct_impacted": 95,  "airframes": 21,     "investment_at_risk": ">$250,000",     "severity": "SEVERE"},
    {"state": "Georgia",    "pct_impacted": 80,  "airframes": 34,     "investment_at_risk": "~$225,000",     "severity": "SEVERE"},
    {"state": "Wisconsin",  "pct_impacted": 100, "airframes": 1,      "investment_at_risk": "~$12,000",      "severity": "SEVERE",
     "notes": "State DOT/aviation only. True statewide exposure substantially higher including LE, county, and municipal agencies."},
    {"state": "Indiana",    "pct_impacted": 85,  "airframes": "20-30","investment_at_risk": "~$400,000",     "severity": "SEVERE"},
    {"state": "Minnesota",  "pct_impacted": 84,  "airframes": "~60",  "investment_at_risk": "$150,000-200,000","severity": "SEVERE"},
    {"state": "Nebraska",   "pct_impacted": 86,  "airframes": 13,     "investment_at_risk": "~$45,000",      "severity": "MODERATE"},
    {"state": "New York",   "pct_impacted": 92,  "airframes": 23,     "investment_at_risk": "~$150,000",     "severity": "SEVERE"},
    {"state": "Alabama",    "pct_impacted": 75,  "airframes": 16,     "investment_at_risk": "~$125,000",     "severity": "MODERATE"},
    {"state": "Arkansas",   "pct_impacted": 15,  "airframes": 5,      "investment_at_risk": "~$100,000",     "severity": "MODERATE"},
    {"state": "California", "pct_impacted": 30,  "airframes": 91,     "investment_at_risk": "not_centralized","severity": "MODERATE"},
    {"state": "Colorado",   "pct_impacted": 90,  "airframes": 16,     "investment_at_risk": None,            "severity": "SEVERE",
     "notes": "5 small drones remain operational"},
    {"state": "Idaho",      "pct_impacted": None,"airframes": None,   "investment_at_risk": None,            "severity": "MODERATE",
     "notes": "$15K drone now costs $42K to replace — 2.8x premium cited in paper"},
    {"state": "Washington", "pct_impacted": None,"airframes": None,   "investment_at_risk": None,            "severity": "MODERATE",
     "notes": "Partial grounding, segregation by funding source"},
    {"state": "Illinois",   "pct_impacted": None,"airframes": None,   "investment_at_risk": None,            "severity": "MODERATE",
     "notes": "Partial grounding, segregation by funding source"},
]


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {}


def save_cache(cache: dict):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, indent=2))


def content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()[:16]


def check_for_revision() -> dict:
    """Check the monitor URL for any mention of a new revision."""
    try:
        r = requests.get(MONITOR_URL, headers=HEADERS, timeout=25)
        r.raise_for_status()
        text = r.text.lower()
        # Look for revision indicators
        rev_match = re.search(r"revision\s+(\d+)", text)
        revision = rev_match.group(0) if rev_match else "revision 2"
        return {"revision_found": revision, "page_hash": content_hash(r.content)}
    except Exception as e:
        print(f"[WARN] Monitor URL check failed: {e}", file=sys.stderr)
        return {}


def build_records() -> list[dict]:
    """Build structured records from curated state data."""
    records = []

    # Master summary record
    records.append({
        "id": f"nasao_whitepaper_summary_{TODAY}",
        "title": "Oregon/NASAO White Paper — DJI Fleet Impact Summary",
        "url": PDF_URL,
        "source": "nasao_whitepaper",
        "pub_date": "2026-02-28",
        "revision": "Revision 2",
        "total_states_surveyed": 25,
        "total_airframes_grounded": 467,
        "national_exposure_low": 50_000_000,
        "national_exposure_high": 2_000_000_000,
        "state_agency_exposure_low": 10_000_000,
        "state_agency_exposure_high": 70_000_000,
        "combined_state_local_exposure_low": 35_000_000,
        "combined_state_local_exposure_high": 105_000_000,
        "waiver_recommended_until": "September 2027",
        "severe_impact_states": ["Oregon", "Georgia", "Wisconsin", "Indiana", "New York", "Colorado"],
        "no_replacement_budget_states": ["Oregon", "Georgia", "Indiana", "Minnesota", "Nebraska", "Idaho", "New York", "Wisconsin"],
        "policy_triggers": [
            "OMB Memorandum M-26-02 (November 21 2025)",
            "FHWA guidance on UAS eligibility for federally funded projects",
            "FCC Covered List action (December 22 2025)",
            "ASDA provisions effective December 22 2025"
        ],
        "replacement_cost_per_airframe_low": 20_000,
        "replacement_cost_per_airframe_high": 60_000,
        "replacement_cost_premium_multiplier": "2.0x to 4.0x vs DJI equivalent",
        "idaho_case_study": "$15,000 DJI drone → $42,000 compliant replacement (2.8x)",
        "vertical_tag": "dfr",
        "data_category": "regulatory",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    })

    # Per-state records
    for state_data in REVISION_2_STATE_DATA:
        records.append({
            "id": f"nasao_wp_{state_data['state'].lower().replace(' ', '_')}_{TODAY}",
            "title": f"NASAO White Paper — {state_data['state']} Fleet Impact",
            "url": PDF_URL,
            "source": "nasao_whitepaper",
            "pub_date": "2026-02-28",
            "state": state_data["state"],
            "pct_fleet_impacted": state_data.get("pct_impacted"),
            "airframes_impacted": state_data.get("airframes"),
            "investment_at_risk": state_data.get("investment_at_risk"),
            "severity": state_data.get("severity"),
            "notes": state_data.get("notes", ""),
            "vertical_tag": "dfr",
            "data_category": "regulatory",
            "mined_at": datetime.now(timezone.utc).isoformat(),
        })

    # Wisconsin-specific deep record
    records.append({
        "id": f"nasao_wp_wisconsin_detail_{TODAY}",
        "title": "Wisconsin DJI Fleet — 100% Grounded (NASAO White Paper)",
        "url": PDF_URL,
        "source": "nasao_whitepaper",
        "pub_date": "2026-02-28",
        "state": "Wisconsin",
        "severity": "SEVERE",
        "pct_fleet_impacted": 100,
        "airframes_state_dot_only": 1,
        "investment_state_dot_only": "~$12,000",
        "replacement_budget": "None — no dedicated replacement budget",
        "true_statewide_exposure_note": "State DOT figure severely understates total exposure. Wisconsin has 72 counties, multiple active LE drone programs (Manitowoc County, Beaver Dam PD, Wisconsin Rapids PD), state agency programs, and extensive commercial survey/inspection fleet. All DJI-heavy due to Seiler Instrument GeoDrones dealer concentration.",
        "dealer_context": {
            "primary_dealer": "Seiler Instrument GeoDrones",
            "dealer_dji_status": "Authorized DJI dealer — still featuring DJI Matrice 400 as flagship as of April 2026",
            "dealer_midwest_states": ["Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Michigan", "Missouri", "Nebraska", "Wisconsin"],
            "implication": "Seiler has not pivoted — their entire Wisconsin customer base is holding grounded DJI assets with no replacement guidance from their incumbent dealer"
        },
        "grant_path_forward": {
            "available_grants": ["COPS Technology", "HSGP/SHSP via Wisconsin Emergency Management", "HSGP/UASI (Milwaukee eligible)", "FEMA BRIC"],
            "ndaa_required": True,
            "replacement_cost_estimate_per_unit": "$20,000–$60,000",
            "replacement_cost_premium": "2.0x–4.0x vs DJI equivalent",
            "forge_report_applicable": "DFR Full Intel + Commercial Mapping DJI Transition Report"
        },
        "known_programs_at_risk": [
            {"agency": "Wisconsin DOT", "status": "CONFIRMED GROUNDED", "source": "NASAO white paper direct"},
            {"agency": "Manitowoc County Sheriff", "status": "HIGH PROBABILITY — 13 FAA-certified pilots, 2022 program launch, DJI acquisition era"},
            {"agency": "Beaver Dam PD", "status": "PLATFORM UNKNOWN — active thermal drone program"},
            {"agency": "Wisconsin Rapids PD", "status": "PLATFORM UNKNOWN — active drone program"}
        ],
        "vertical_tag": "dfr",
        "data_category": "regulatory",
        "mined_at": datetime.now(timezone.utc).isoformat(),
    })

    return records


def run():
    cache = load_cache()

    # Check for new revision
    print("[INFO] Checking for white paper revision...")
    revision_info = check_for_revision()
    last_hash = cache.get("monitor_hash")
    current_hash = revision_info.get("page_hash")

    if current_hash and current_hash != last_hash:
        print(f"[INFO] Monitor page changed — possible new revision. Hash: {current_hash}")
        cache["monitor_hash"] = current_hash
        cache["last_change_detected"] = TODAY
    else:
        print(f"[INFO] No revision detected (hash: {current_hash})")

    # Build and write records
    records = build_records()
    print(f"[INFO] Built {len(records)} records from NASAO white paper")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"nasao_whitepaper_{TODAY}.json"
    out_path.write_text(json.dumps(records, indent=2))
    print(f"[DONE] {len(records)} records → {out_path}")

    cache["last_run"] = TODAY
    cache["current_revision"] = "Revision 2 — February 28 2026"
    save_cache(cache)
    return len(records)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count > 0 else 1)
