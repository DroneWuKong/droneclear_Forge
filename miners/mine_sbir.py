#!/usr/bin/env python3
"""
mine_sbir.py — Search sbir.gov for SBIR/STTR awards related to UAS/drone companies.
Outputs structured contract data for forge_intel.json.
"""

import json
import re
import sys
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from html.parser import HTMLParser

# Companies we track in the Forge DB — search for their SBIR awards
TRACKED_COMPANIES = [
    "Obsidian Sensors", "Shield AI", "Skydio", "Fortem Technology",
    "DroneShield", "Heven Drones", "ModalAI", "Ascent Aerosystems",
    "Red Cat", "Teal Drones", "Vantage Robotics", "Titan Dynamics",
    "Freefly Systems", "Inspired Flight", "Watts Innovations",
    "Firestorm Labs", "Neros Technologies", "Zepher Flight Labs",
    "ARK Electronics", "Inertial Labs", "Silvus Technologies",
    "Persistent Systems", "Doodle Labs", "Rajant",
]

# Broader keyword searches
UAS_KEYWORDS = [
    "unmanned aerial", "UAS", "drone", "counter-UAS",
    "microbolometer", "thermal imaging UAV",
    "autonomous aerial", "FPV",
]

SBIR_API_BASE = "https://www.sbir.gov/api/awards.json"


def search_sbir_awards(keyword, max_results=20):
    """Search SBIR.gov API for awards matching a keyword."""
    params = {
        'keyword': keyword,
        'rows': max_results,
        'start': 0,
    }
    url = f"{SBIR_API_BASE}?{urlencode(params)}"
    req = Request(url, headers={'User-Agent': 'Forge-Intel-Miner/1.0', 'Accept': 'application/json'})
    
    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data if isinstance(data, list) else data.get('results', [])
    except Exception as e:
        print(f"  WARN: SBIR API failed for '{keyword}': {e}", file=sys.stderr)
        return []


def search_sbir_company(company_name, max_results=10):
    """Search SBIR.gov for awards to a specific company."""
    params = {
        'firm': company_name,
        'rows': max_results,
        'start': 0,
    }
    url = f"{SBIR_API_BASE}?{urlencode(params)}"
    req = Request(url, headers={'User-Agent': 'Forge-Intel-Miner/1.0', 'Accept': 'application/json'})
    
    try:
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data if isinstance(data, list) else data.get('results', [])
    except Exception as e:
        print(f"  WARN: SBIR API failed for firm '{company_name}': {e}", file=sys.stderr)
        return []


def award_to_intel(award):
    """Convert an SBIR award record to forge_intel contract format."""
    return {
        'program': f"SBIR {award.get('program', '')} — {award.get('award_title', '')[:60]}",
        'awardee': award.get('firm', 'Unknown'),
        'value': f"${award['award_amount']:,.0f}" if award.get('award_amount') else 'Undisclosed',
        'date': award.get('award_year', ''),
        'type': 'SBIR' if 'SBIR' in award.get('program', '') else 'STTR',
        'source': 'sbir.gov',
        'note': award.get('abstract', '')[:200] if award.get('abstract') else award.get('award_title', ''),
        'agency': award.get('agency', ''),
        'phase': award.get('phase', ''),
        'url': f"https://www.sbir.gov/node/{award['award_id']}" if award.get('award_id') else None,
    }


def mine_sbir():
    """Mine SBIR.gov for drone-related awards."""
    all_awards = {}
    
    # Search by tracked companies
    for company in TRACKED_COMPANIES:
        print(f"  Searching SBIR for: {company}")
        awards = search_sbir_company(company)
        for a in awards:
            aid = a.get('award_id', id(a))
            if aid not in all_awards:
                all_awards[aid] = a
    
    # Search by UAS keywords
    for keyword in UAS_KEYWORDS:
        print(f"  Searching SBIR for keyword: {keyword}")
        awards = search_sbir_awards(keyword)
        for a in awards:
            aid = a.get('award_id', id(a))
            if aid not in all_awards:
                all_awards[aid] = a
    
    print(f"  Total unique awards: {len(all_awards)}")
    
    # Convert to intel format
    contracts = []
    for award in all_awards.values():
        intel_entry = award_to_intel(award)
        contracts.append(intel_entry)
    
    # Sort by year descending
    contracts.sort(key=lambda c: c.get('date', ''), reverse=True)
    
    return contracts


if __name__ == '__main__':
    print("Mining SBIR.gov...")
    contracts = mine_sbir()
    
    print(f"\nResults: {len(contracts)} awards")
    
    # Show top 10
    for c in contracts[:10]:
        print(f"  {c['date']} | {c['awardee'][:25]:25} | {c['value']:>12} | {c['program'][:50]}")
    
    # Output full JSON
    result = {'contracts': contracts}
    print(json.dumps(result, indent=2))
