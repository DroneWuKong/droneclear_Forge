"""
G-06 | Municipal Budget / RFP Crawler
Scans public procurement portals for DFR-related RFPs and budget items.
Targets public bid aggregators and known active DFR municipality portals.
Cadence: weekly
Output: data/dfr/raw/municipal_rfp_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

DFR_KEYWORDS = {
    "drone as first responder", "dfr", "unmanned aircraft", "uas", "suas",
    "drone program", "drone services", "drone procurement", "aerial drone",
    "bvlos", "beyond visual line", "drone dock", "drone in a box",
    "public safety drone", "police drone", "fire department drone",
    "skydio", "brinc", "flock", "parrot anafi",
    "drone pilot", "remote pilot", "aerial surveillance",
}

# Public bid/RFP aggregator RSS feeds and search endpoints
PROCUREMENT_SOURCES = [
    {
        "name": "OpenGovUS",
        "rss": "https://procurement.opengov.com/rss/opportunities",
        "search_url": None,
        "notes": "OpenGov public procurement platform"
    },
    {
        "name": "PublicPurchase",
        "rss": None,
        "search_url": "https://www.publicpurchase.com/gems/bid/bidList?agencyId=0&keywords=drone",
        "notes": "Public purchase bid platform"
    },
    {
        "name": "BidNet",
        "rss": "https://www.bidnetdirect.com/rss/public-bids?keywords=drone+public+safety",
        "search_url": None,
        "notes": "BidNet government procurement"
    },
    {
        "name": "DemandStar",
        "rss": "https://network.demandstar.com/rss/solicitations?q=drone",
        "search_url": None,
        "notes": "DemandStar government solicitations"
    },
]

# Known active DFR city/county procurement portals — monitor directly
KNOWN_DFR_AGENCIES = [
    {
        "name": "San Bernardino County CA",
        "portal": "https://www.sbcounty.gov/purchasing",
        "notes": "Allocated $562K for DFR program (2025)",
        "state": "CA"
    },
    {
        "name": "Sterling Heights MI",
        "portal": "https://www.sterlingheights.gov/bids",
        "notes": "$678K DFR program over 5 years (2026)",
        "state": "MI"
    },
    {
        "name": "Yonkers NY",
        "portal": "https://www.yonkersny.gov/bids",
        "notes": "Permanent DFR program 2026 post-pilot",
        "state": "NY"
    },
    {
        "name": "Denver CO",
        "portal": "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Finance/Purchasing",
        "notes": "Active DFR pilot — Skydio + Flock Aerodome",
        "state": "CO"
    },
    {
        "name": "Scottsdale AZ",
        "portal": "https://www.scottsdaleaz.gov/purchasing",
        "notes": "Active Flock Aerodome DFR program",
        "state": "AZ"
    },
    {
        "name": "Rockwall County TX",
        "portal": "https://www.rockwallcountytexas.com/bids",
        "notes": "Active BVLOS DFR program (Jan 2026 launch)",
        "state": "TX"
    },
]


def is_dfr_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DFR_KEYWORDS)


def mine_rss_source(source: dict) -> list[dict]:
    if not source.get("rss"):
        return []
    records = []
    try:
        feed = feedparser.parse(source["rss"])
        for entry in feed.entries:
            title = entry.get("title", "")
            summary = entry.get("summary", "") or ""
            link = entry.get("link", "")
            pub = entry.get("published", "") or entry.get("updated", "")
            combined = f"{title} {summary}"
            if not is_dfr_relevant(combined):
                continue
            records.append({
                "id": f"rfp_{re.sub(r'[^a-z0-9]', '_', title.lower())[:60]}_{TODAY.replace('-','')}",
                "title": title,
                "url": link,
                "source": source["name"].lower().replace(" ", "_"),
                "pub_date": pub[:10] if pub else TODAY,
                "summary": BeautifulSoup(summary, "html.parser").get_text(strip=True)[:500],
                "procurement_type": "rfp_bid",
                "vertical_tag": "dfr",
                "data_category": "grant",
                "mined_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[WARN] RSS {source['name']}: {e}", file=sys.stderr)
    return records


def mine_agency_portal(agency: dict) -> list[dict]:
    """Check known DFR agency portals for active bids."""
    records = []
    try:
        r = requests.get(agency["portal"], headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        items = (
            soup.select("a[href*='bid']")
            + soup.select("a[href*='rfp']")
            + soup.select("a[href*='solicitation']")
            + soup.select(".bid-item, .rfp-item, .solicitation")
        )
        for el in items:
            text = el.get_text(strip=True)
            href = el.get("href", "")
            if not text or not is_dfr_relevant(text):
                continue
            if href and not href.startswith("http"):
                base = re.match(r"https?://[^/]+", agency["portal"])
                href = (base.group(0) if base else "") + href
            records.append({
                "id": f"rfp_{agency['name'].lower().replace(' ', '_')}_{re.sub(r'[^a-z0-9]', '_', text.lower())[:40]}",
                "title": text,
                "url": href,
                "source": "municipal_portal",
                "agency_name": agency["name"],
                "state": agency.get("state", ""),
                "agency_notes": agency.get("notes", ""),
                "pub_date": TODAY,
                "vertical_tag": "dfr",
                "data_category": "grant",
                "mined_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[WARN] Portal {agency['name']}: {e}", file=sys.stderr)
    return records


def build_known_agency_signals() -> list[dict]:
    """
    Curated signals for known active DFR procurement agencies.
    Baseline reference — updated as new programs are confirmed.
    """
    return [
        {
            "id": f"dfr_agency_signal_{agency['name'].lower().replace(' ', '_')}",
            "title": f"Known DFR Program: {agency['name']}",
            "url": agency["portal"],
            "source": "dfr_agency_curated",
            "agency_name": agency["name"],
            "state": agency.get("state", ""),
            "procurement_notes": agency.get("notes", ""),
            "pub_date": TODAY,
            "procurement_type": "active_program",
            "vertical_tag": "dfr",
            "data_category": "grant",
            "mined_at": datetime.now(timezone.utc).isoformat(),
        }
        for agency in KNOWN_DFR_AGENCIES
    ]


def run():
    all_records = []

    # RSS procurement feeds
    for source in PROCUREMENT_SOURCES:
        print(f"[INFO] Mining {source['name']} RSS...")
        records = mine_rss_source(source)
        print(f"[INFO]  → {len(records)} DFR-relevant bids")
        all_records.extend(records)

    # Known agency portals
    for agency in KNOWN_DFR_AGENCIES:
        print(f"[INFO] Checking {agency['name']} portal...")
        records = mine_agency_portal(agency)
        print(f"[INFO]  → {len(records)} DFR bids found")
        all_records.extend(records)

    # Always include curated agency signals
    curated = build_known_agency_signals()
    all_records.extend(curated)
    print(f"[INFO] Added {len(curated)} curated agency signal records")

    # Deduplicate
    seen = set()
    deduped = []
    for r in all_records:
        key = r.get("url") or r["id"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"municipal_rfp_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
