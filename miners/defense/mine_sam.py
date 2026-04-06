#!/usr/bin/env python3
"""
mine_sam.py — Search SAM.gov for UAS/drone-related federal contract awards.

SAM.gov is the System for Award Management — all US federal contracts.
Uses the public Contract Opportunities API + Award Data API.

API docs: https://open.gsa.gov/api/sam-entity-management-api/
Rate limit: No auth needed for public data. 100 req/min recommended.

Run locally — requires network access to api.sam.gov.

Usage:
    python3 miners/defense/mine_sam.py
    python3 miners/defense/mine_sam.py --vendor "Shield AI"
    python3 miners/defense/mine_sam.py --dry-run
"""

import json
import re
import sys
import os
import time
from urllib.request import urlopen, Request
from urllib.parse import urlencode

# SAM.gov APIs
SAM_OPPORTUNITIES_API = "https://api.sam.gov/opportunities/v2/search"
SAM_ENTITY_API = "https://api.sam.gov/entity-information/v3/entities"

# USAspending.gov is actually better for awarded contracts
USASPENDING_API = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
USASPENDING_KEYWORD = "https://api.usaspending.gov/api/v2/autocomplete/awarding_agency/"

HEADERS = {
    "User-Agent": "Forge-Intel-Miner/1.0",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

RATE_LIMIT = 0.5  # seconds between requests

# Tracked companies — search for their contract awards
TRACKED_VENDORS = [
    "Shield AI", "Fortem Technologies", "Skydio", "AeroVironment",
    "L3Harris", "Textron Systems", "General Atomics", "Northrop Grumman",
    "Boeing", "Kratos Defense", "Anduril Industries", "Red Cat",
    "Teal Drones", "ModalAI", "Inspired Flight", "Freefly Systems",
    "Parrot", "DroneShield", "Teledyne FLIR", "Heven Drones",
    "Ascent Aerosystems", "Watts Innovations", "Vantage Robotics",
    "Titan Dynamics", "Performance Drone Works", "Firestorm Labs",
    "Silvus Technologies", "Persistent Systems", "Doodle Labs",
    "Obsidian Sensors", "Joby Aviation", "Zipline",
]

# UAS-related keywords for broader search
UAS_KEYWORDS = [
    "unmanned aerial system",
    "unmanned aircraft",
    "counter-UAS",
    "counter unmanned",
    "small drone",
    "sUAS",
    "VTOL unmanned",
    "autonomous aerial",
]

# UAS-related NAICS codes
UAS_NAICS = [
    "336411",  # Aircraft Manufacturing
    "334511",  # Search, Detection, Navigation, and Guidance Systems
    "334220",  # Radio & TV Broadcasting and Wireless Communications
    "541715",  # R&D in Physical, Engineering, and Life Sciences
    "336413",  # Other Aircraft Parts and Auxiliary Equipment
]


def search_usaspending_awards(keyword, min_amount=100000, limit=50):
    """Search USAspending.gov for awarded contracts by keyword."""
    payload = {
        "filters": {
            "keywords": [keyword],
            "award_type_codes": ["A", "B", "C", "D"],  # Contracts only
            "time_period": [
                {"start_date": "2024-01-01", "end_date": "2026-12-31"}
            ],
            "award_amounts": [
                {"lower_bound": min_amount}
            ],
        },
        "fields": [
            "Award ID", "Recipient Name", "Award Amount",
            "Description", "Start Date", "End Date",
            "Awarding Agency", "Awarding Sub Agency",
            "NAICS Code", "Contract Award Type",
        ],
        "limit": limit,
        "page": 1,
        "sort": "Award Amount",
        "order": "desc",
    }
    
    time.sleep(RATE_LIMIT)
    req = Request(USASPENDING_API, 
                  data=json.dumps(payload).encode('utf-8'),
                  headers=HEADERS,
                  method='POST')
    
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('results', [])
    except Exception as e:
        print(f"  WARN: USAspending search failed for '{keyword}': {e}", file=sys.stderr)
        return []


def search_usaspending_vendor(vendor_name, min_amount=50000, limit=25):
    """Search USAspending.gov for contracts awarded to a specific vendor."""
    payload = {
        "filters": {
            "recipient_search_text": [vendor_name],
            "award_type_codes": ["A", "B", "C", "D"],
            "time_period": [
                {"start_date": "2023-01-01", "end_date": "2026-12-31"}
            ],
            "award_amounts": [
                {"lower_bound": min_amount}
            ],
        },
        "fields": [
            "Award ID", "Recipient Name", "Award Amount",
            "Description", "Start Date", "End Date",
            "Awarding Agency", "Awarding Sub Agency",
            "NAICS Code",
        ],
        "limit": limit,
        "page": 1,
        "sort": "Award Amount",
        "order": "desc",
    }
    
    time.sleep(RATE_LIMIT)
    req = Request(USASPENDING_API,
                  data=json.dumps(payload).encode('utf-8'),
                  headers=HEADERS,
                  method='POST')
    
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('results', [])
    except Exception as e:
        print(f"  WARN: USAspending vendor search failed for '{vendor_name}': {e}", file=sys.stderr)
        return []


def award_to_intel(award):
    """Convert USAspending award record to forge_intel contract format."""
    amount = award.get('Award Amount')
    amount_str = f"${amount:,.0f}" if amount else "Undisclosed"
    
    return {
        'program': (award.get('Description') or 'Undisclosed')[:80],
        'awardee': award.get('Recipient Name', 'Unknown'),
        'value': amount_str,
        'date': award.get('Start Date', '')[:10],
        'type': _classify_contract(award.get('Description', '')),
        'source': 'usaspending.gov',
        'note': f"Agency: {award.get('Awarding Agency', '')}. {award.get('Description', '')[:150]}",
        'agency': award.get('Awarding Agency', ''),
        'sub_agency': award.get('Awarding Sub Agency', ''),
        'naics': award.get('NAICS Code', ''),
        'award_id': award.get('Award ID', ''),
    }


def _classify_contract(description):
    """Classify contract type from description text."""
    d = (description or '').lower()
    if 'counter' in d and ('uas' in d or 'drone' in d or 'unmanned' in d):
        return 'C-UAS'
    if 'autonomous' in d or 'autonomy' in d:
        return 'Autonomous systems'
    if 'surveillance' in d or 'isr' in d or 'reconnaissance' in d:
        return 'ISR'
    if 'loitering' in d or 'munition' in d:
        return 'Loitering munition'
    if 'mesh' in d or 'radio' in d or 'communication' in d:
        return 'Communications'
    if 'sensor' in d or 'thermal' in d or 'infrared' in d:
        return 'Sensors'
    if 'sbir' in d or 'sttr' in d:
        return 'SBIR/STTR'
    return 'Defense'


def mine_sam():
    """Run the full SAM/USAspending mining pipeline."""
    all_awards = []
    seen_ids = set()
    
    # 1. Search by tracked vendors
    for vendor in TRACKED_VENDORS:
        print(f"  Vendor: {vendor}")
        awards = search_usaspending_vendor(vendor)
        for a in awards:
            aid = a.get('Award ID', '')
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                intel = award_to_intel(a)
                all_awards.append(intel)
        if awards:
            print(f"    → {len(awards)} awards found")
    
    # 2. Search by UAS keywords
    for keyword in UAS_KEYWORDS:
        print(f"  Keyword: {keyword}")
        awards = search_usaspending_awards(keyword)
        for a in awards:
            aid = a.get('Award ID', '')
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                intel = award_to_intel(a)
                all_awards.append(intel)
        if awards:
            print(f"    → {len(awards)} awards found")
    
    # Sort by amount descending
    all_awards.sort(key=lambda a: float(a.get('value', '0').replace('$', '').replace(',', '') or 0), reverse=True)
    
    return all_awards


def merge_into_intel(awards, intel_path, dry_run=False):
    """Merge awards into forge_intel.json."""
    with open(intel_path) as f:
        intel = json.load(f)
    
    existing = set()
    for c in intel.get('contracts', []):
        key = (c.get('awardee', '').lower()[:20], c.get('value', ''))
        existing.add(key)
    
    added = 0
    for a in awards:
        key = (a['awardee'].lower()[:20], a['value'])
        if key not in existing:
            intel['contracts'].append(a)
            existing.add(key)
            added += 1
    
    print(f"\n  Added {added} new contracts (skipped {len(awards) - added} duplicates)")
    print(f"  Total contracts in intel: {len(intel['contracts'])}")
    
    if not dry_run:
        with open(intel_path, 'w') as f:
            json.dump(intel, f, indent=2)
        print(f"  Written to {intel_path}")
    
    return added


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Mine SAM.gov / USAspending for UAS contracts')
    parser.add_argument('--vendor', help='Search specific vendor only')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    
    intel_path = os.path.join(os.path.dirname(__file__), '..', '..', 
                              'DroneClear Components Visualizer', 'forge_intel.json')
    
    print("Mining USAspending.gov for UAS contract awards...")
    
    if args.vendor:
        print(f"  Single vendor: {args.vendor}")
        awards = search_usaspending_vendor(args.vendor)
        awards = [award_to_intel(a) for a in awards]
    else:
        awards = mine_sam()
    
    print(f"\nTotal awards: {len(awards)}")
    for a in awards[:10]:
        print(f"  {a['date'][:10]:10} | {a['awardee'][:25]:25} | {a['value']:>15} | {a['type']}")
    
    if awards:
        merge_into_intel(awards, intel_path, dry_run=args.dry_run)
