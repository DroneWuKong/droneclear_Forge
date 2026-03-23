#!/usr/bin/env python3
"""
mine_blueuas.py — Track Blue UAS Cleared List and Framework components.
Checks DIU and public DoD sources for updated platform/component listings.
"""

import json
import re
import sys
from urllib.request import urlopen, Request

# Known Blue UAS platforms from our DB + public sources
# This serves as ground truth — miners validate/expand this
KNOWN_BLUE_UAS = [
    {"name": "Skydio X2/X10", "manufacturer": "Skydio", "type": "sUAS"},
    {"name": "Teal Golden Eagle", "manufacturer": "Teal Drones / Red Cat", "type": "sUAS"},
    {"name": "Freefly Astro", "manufacturer": "Freefly Systems / Auterion", "type": "sUAS"},
    {"name": "Inspired Flight IF800/IF1200", "manufacturer": "Inspired Flight", "type": "sUAS"},
    {"name": "Vantage Robotics Trace", "manufacturer": "Vantage Robotics", "type": "sUAS"},
    {"name": "Parrot ANAFI USA", "manufacturer": "Parrot", "type": "sUAS"},
    {"name": "Altavian Nova F7200", "manufacturer": "Altavian", "type": "Fixed-wing"},
    {"name": "Aerostar/L3Harris UAS", "manufacturer": "L3Harris", "type": "Tactical"},
    {"name": "Shield AI Nova 2", "manufacturer": "Shield AI", "type": "sUAS"},
    {"name": "Ascent Aerosystems Spirit", "manufacturer": "Ascent Aerosystems", "type": "Coaxial"},
    {"name": "Red Cat FANG F7", "manufacturer": "Red Cat Holdings", "type": "FPV"},
    {"name": "ModalAI Seeker/Stinger", "manufacturer": "ModalAI", "type": "FPV/sUAS"},
    {"name": "Titan Dynamics Raptor", "manufacturer": "Titan Dynamics", "type": "sUAS"},
    {"name": "Hoverfly LiveSky/Spectre", "manufacturer": "Hoverfly Technologies", "type": "Tethered"},
    {"name": "Skyfish Osprey", "manufacturer": "Skyfish", "type": "sUAS"},
    {"name": "Watts Innovations Prism", "manufacturer": "Watts Innovations", "type": "sUAS"},
    {"name": "UAS Nexus Platform One", "manufacturer": "UAS Nexus", "type": "sUAS"},
    {"name": "Zone 5 Technologies Paladin", "manufacturer": "Zone 5 Technologies", "type": "sUAS"},
    {"name": "AeroVironment VAPOR 55", "manufacturer": "AeroVironment", "type": "Tactical"},
    {"name": "AeroVironment Switchblade 300/600", "manufacturer": "AeroVironment", "type": "Loitering munition"},
    {"name": "Textron Aerosonde", "manufacturer": "Textron Systems", "type": "Tactical"},
    {"name": "Textron Nightwarden", "manufacturer": "Textron Systems", "type": "Tactical"},
    {"name": "General Atomics MQ-9", "manufacturer": "General Atomics", "type": "MALE"},
    {"name": "Northrop Grumman MQ-4C Triton", "manufacturer": "Northrop Grumman", "type": "HALE"},
    {"name": "BRINC Lemur", "manufacturer": "BRINC", "type": "Indoor tactical"},
    {"name": "Easy Aerial Osprey", "manufacturer": "Easy Aerial", "type": "Tethered"},
]

# Framework components (not full platforms — these are approved subsystems)
KNOWN_FRAMEWORK_COMPONENTS = [
    {"name": "ModalAI VOXL2", "manufacturer": "ModalAI", "type": "Companion computer", "note": "16 Blue UAS listings"},
    {"name": "ARK Electronics FMUv6X", "manufacturer": "ARK Electronics", "type": "Flight controller", "note": "Pixhawk ecosystem"},
    {"name": "Silvus StreamCaster", "manufacturer": "Silvus Technologies", "type": "Mesh radio"},
    {"name": "Persistent Systems MPU5", "manufacturer": "Persistent Systems", "type": "Mesh radio"},
    {"name": "Rajant Peregrine", "manufacturer": "Rajant", "type": "Mesh radio"},
    {"name": "Doodle Labs Helix", "manufacturer": "Doodle Labs", "type": "Mesh radio"},
    {"name": "Lumenier LUX H743", "manufacturer": "Lumenier", "type": "Flight controller", "note": "NDAA compliant"},
    {"name": "Orqa QuadCore H7", "manufacturer": "Orqa", "type": "Flight controller", "note": "NDAA compliant"},
]

# DIU public pages to check for updates
DIU_URLS = [
    "https://www.diu.mil/blue-uas",
]


def check_diu_page():
    """Fetch DIU Blue UAS page and look for updates."""
    for url in DIU_URLS:
        print(f"  Checking {url}")
        req = Request(url, headers={'User-Agent': 'Forge-Intel-Miner/1.0'})
        try:
            with urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8', errors='replace')
                
                # Extract any platform names mentioned
                # DIU page typically lists platform names in structured HTML
                found_names = set()
                for platform in KNOWN_BLUE_UAS:
                    name_parts = platform['name'].split('/')
                    for part in name_parts:
                        if part.strip().lower() in html.lower():
                            found_names.add(platform['name'])
                
                print(f"    Matched {len(found_names)} known platforms on page")
                return html, found_names
        except Exception as e:
            print(f"    WARN: Failed to fetch {url}: {e}", file=sys.stderr)
    
    return '', set()


def generate_defense_entries():
    """Generate defense intel entries from known Blue UAS data."""
    entries = []
    
    for platform in KNOWN_BLUE_UAS:
        entries.append({
            'name': platform['name'],
            'manufacturer': platform['manufacturer'],
            'type': platform['type'],
            'status': 'Blue UAS Cleared List',
            'ndaa_compliant': True,
            'blue_uas': True,
        })
    
    for comp in KNOWN_FRAMEWORK_COMPONENTS:
        entries.append({
            'name': comp['name'],
            'manufacturer': comp['manufacturer'],
            'type': comp['type'],
            'status': 'Blue UAS Framework',
            'ndaa_compliant': True,
            'blue_uas_framework': True,
            'note': comp.get('note', ''),
        })
    
    return entries


def mine_blueuas():
    """Mine Blue UAS data — combines known list with DIU page check."""
    print("  Generating from known Blue UAS list...")
    entries = generate_defense_entries()
    
    print(f"  Checking DIU page for updates...")
    html, matched = check_diu_page()
    
    return {
        'platforms': [e for e in entries if e.get('blue_uas')],
        'framework': [e for e in entries if e.get('blue_uas_framework')],
        'total_platforms': len(KNOWN_BLUE_UAS),
        'total_framework': len(KNOWN_FRAMEWORK_COMPONENTS),
        'diu_matched': len(matched),
    }


if __name__ == '__main__':
    print("Mining Blue UAS data...")
    result = mine_blueuas()
    
    print(f"\nResults:")
    print(f"  Cleared List platforms: {result['total_platforms']}")
    print(f"  Framework components: {result['total_framework']}")
    print(f"  DIU page matches: {result['diu_matched']}")
    
    print(json.dumps(result, indent=2))
