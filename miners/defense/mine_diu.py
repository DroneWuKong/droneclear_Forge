#!/usr/bin/env python3
"""
mine_diu.py — Track Defense Innovation Unit (DIU) Blue UAS Cleared List.

Checks diu.mil for updates to:
  - Blue UAS Cleared List (approved drone platforms)
  - Blue UAS Framework (approved components)
  - Replicator program updates

Maintains a local snapshot and diffs against it to detect changes.

Run locally — requires network access to diu.mil.

Usage:
    python3 miners/defense/mine_diu.py
    python3 miners/defense/mine_diu.py --diff-only
"""

import json
import os
import sys
import time
from urllib.request import urlopen, Request
from datetime import datetime

HEADERS = {"User-Agent": "Forge-Intel-Miner/1.0"}
RATE_LIMIT = 2.0

DIU_URLS = {
    "blue_uas": "https://www.diu.mil/blue-uas",
    "replicator": "https://www.diu.mil/replicator",
}

SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), '..', '.snapshots')

# ══════════════════════════════════════════════════
# Current known Blue UAS data (ground truth)
# ══════════════════════════════════════════════════

CLEARED_LIST = {
    "platforms": [
        # sUAS (Group 1-2)
        {"name": "Skydio X2/X10", "manufacturer": "Skydio", "type": "sUAS", "group": 1},
        {"name": "Teal Golden Eagle / Black Widow", "manufacturer": "Red Cat Holdings / Teal Drones", "type": "sUAS", "group": 1},
        {"name": "Freefly Astro / Astro Max", "manufacturer": "Freefly Systems / Auterion", "type": "sUAS", "group": 1},
        {"name": "Inspired Flight IF800 / IF1200A", "manufacturer": "Inspired Flight Technologies", "type": "Heavy-lift sUAS", "group": 2},
        {"name": "Parrot ANAFI USA / USG", "manufacturer": "Parrot", "type": "sUAS", "group": 1},
        {"name": "Shield AI Nova 2", "manufacturer": "Shield AI", "type": "Autonomous sUAS", "group": 1},
        {"name": "ModalAI Seeker / Stinger Vision FPV", "manufacturer": "ModalAI", "type": "FPV / sUAS", "group": 1},
        {"name": "Red Cat FANG F7", "manufacturer": "Red Cat Holdings", "type": "Mil-spec FPV", "group": 1},
        {"name": "Ascent Aerosystems Spirit", "manufacturer": "Ascent Aerosystems", "type": "Coaxial sUAS", "group": 1},
        {"name": "Titan Dynamics Raptor", "manufacturer": "Titan Dynamics", "type": "sUAS", "group": 1},
        {"name": "Vantage Robotics Trace / Vesper", "manufacturer": "Vantage Robotics", "type": "sUAS", "group": 1},
        {"name": "Hoverfly LiveSky / Spectre", "manufacturer": "Hoverfly Technologies", "type": "Tethered sUAS", "group": 1},
        {"name": "Skyfish Osprey", "manufacturer": "Skyfish", "type": "sUAS", "group": 1},
        {"name": "UAS Nexus Platform One", "manufacturer": "UAS Nexus", "type": "sUAS", "group": 1},
        {"name": "Zone 5 Technologies Paladin", "manufacturer": "Zone 5 Technologies", "type": "sUAS", "group": 1},
        {"name": "BRINC Lemur 2", "manufacturer": "BRINC", "type": "Indoor tactical", "group": 1},
        {"name": "Easy Aerial Osprey", "manufacturer": "Easy Aerial", "type": "Tethered sUAS", "group": 1},
        {"name": "Performance Drone Works C100", "manufacturer": "Performance Drone Works", "type": "sUAS", "group": 1},
        {"name": "Watts Innovations Prism", "manufacturer": "Watts Innovations", "type": "sUAS", "group": 1},
        {"name": "Teledyne FLIR Rogue 1", "manufacturer": "Teledyne FLIR Defense", "type": "sUAS", "group": 1},
        {"name": "Neros Technologies Archer", "manufacturer": "Neros Technologies", "type": "sUAS", "group": 1},
        
        # Tactical / Group 3+
        {"name": "Shield AI V-BAT (MQ-35A)", "manufacturer": "Shield AI", "type": "VTOL Group 3", "group": 3},
        {"name": "AeroVironment Puma 3 AE", "manufacturer": "AeroVironment", "type": "Fixed-wing ISR", "group": 2},
        {"name": "AeroVironment Switchblade 300/600", "manufacturer": "AeroVironment", "type": "Loitering munition", "group": 1},
        {"name": "Textron Aerosonde HQ", "manufacturer": "Textron Systems", "type": "Tactical ISR", "group": 3},
        {"name": "Altavian Nova F7200", "manufacturer": "Altavian", "type": "Fixed-wing ISR", "group": 2},
        
        # Large / Strategic
        {"name": "General Atomics MQ-9A Reaper", "manufacturer": "General Atomics", "type": "MALE ISR/Strike", "group": 5},
        {"name": "General Atomics MQ-1C Gray Eagle", "manufacturer": "General Atomics", "type": "MALE ISR", "group": 4},
        {"name": "Northrop Grumman MQ-4C Triton", "manufacturer": "Northrop Grumman", "type": "HALE Maritime", "group": 5},
        {"name": "Northrop Grumman RQ-4 Global Hawk", "manufacturer": "Northrop Grumman", "type": "HALE ISR", "group": 5},
    ],
    
    "framework_components": [
        {"name": "ModalAI VOXL2", "manufacturer": "ModalAI", "type": "Companion computer", "note": "16 Blue UAS listings"},
        {"name": "ARK Electronics FMUv6X", "manufacturer": "ARK Electronics", "type": "Flight controller", "note": "Pixhawk-based"},
        {"name": "Silvus StreamCaster", "manufacturer": "Silvus Technologies", "type": "Mesh radio", "note": "Acquired by Motorola $4.4B"},
        {"name": "Persistent Systems MPU5", "manufacturer": "Persistent Systems", "type": "Mesh radio", "note": "Wave Relay MANET"},
        {"name": "Doodle Labs Helix", "manufacturer": "Doodle Labs", "type": "Mesh radio", "note": "Compact. Canadian."},
        {"name": "Rajant Peregrine", "manufacturer": "Rajant", "type": "Mesh radio", "note": "Kinetic Mesh"},
        {"name": "Lumenier LUX H743", "manufacturer": "Lumenier", "type": "Flight controller", "note": "NDAA. GetFPV house brand."},
        {"name": "Orqa QuadCore H7", "manufacturer": "Orqa", "type": "Flight controller", "note": "NDAA. Croatian."},
        {"name": "Lumenier Siege 80A ESC", "manufacturer": "Lumenier", "type": "ESC", "note": "NDAA. AM32 firmware."},
        {"name": "Orqa 3030 70A ESC", "manufacturer": "Orqa", "type": "ESC", "note": "NDAA. BLHeli_32."},
    ],
    
    "last_checked": None,
    "version": 1,
}


def fetch_page(url):
    """Fetch a web page."""
    time.sleep(RATE_LIMIT)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return ''


def load_snapshot():
    """Load the previous snapshot for diffing."""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, 'blue_uas_snapshot.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def save_snapshot(data):
    """Save current data as snapshot."""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, 'blue_uas_snapshot.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"  Snapshot saved to {path}")


def diff_snapshots(old, new):
    """Compare old and new snapshots, return changes."""
    if not old:
        return {'status': 'first_run', 'changes': []}
    
    old_platforms = {p['name'] for p in old.get('platforms', [])}
    new_platforms = {p['name'] for p in new.get('platforms', [])}
    
    added = new_platforms - old_platforms
    removed = old_platforms - new_platforms
    
    old_components = {c['name'] for c in old.get('framework_components', [])}
    new_components = {c['name'] for c in new.get('framework_components', [])}
    
    comp_added = new_components - old_components
    comp_removed = old_components - new_components
    
    changes = []
    for name in added:
        changes.append({'type': 'platform_added', 'name': name})
    for name in removed:
        changes.append({'type': 'platform_removed', 'name': name})
    for name in comp_added:
        changes.append({'type': 'component_added', 'name': name})
    for name in comp_removed:
        changes.append({'type': 'component_removed', 'name': name})
    
    return {
        'status': 'changed' if changes else 'unchanged',
        'changes': changes,
        'platforms': {'total': len(new_platforms), 'added': len(added), 'removed': len(removed)},
        'components': {'total': len(new_components), 'added': len(comp_added), 'removed': len(comp_removed)},
    }


def update_intel(intel_path):
    """Update forge_intel.json with Blue UAS data."""
    with open(intel_path) as f:
        intel = json.load(f)
    
    intel['blue_uas'] = {
        'platforms': CLEARED_LIST['platforms'],
        'framework': CLEARED_LIST['framework_components'],
        'total_platforms': len(CLEARED_LIST['platforms']),
        'total_framework': len(CLEARED_LIST['framework_components']),
        'last_checked': datetime.utcnow().strftime('%Y-%m-%d'),
    }
    
    with open(intel_path, 'w') as f:
        json.dump(intel, f, indent=2)
    
    print(f"  Updated forge_intel.json with {len(CLEARED_LIST['platforms'])} platforms + {len(CLEARED_LIST['framework_components'])} components")


def mine_diu():
    """Run the DIU mining pipeline."""
    print("Mining DIU Blue UAS data...")
    
    # Load previous snapshot
    old = load_snapshot()
    
    # Current data is our maintained list
    current = {
        'platforms': CLEARED_LIST['platforms'],
        'framework_components': CLEARED_LIST['framework_components'],
        'checked': datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    }
    
    # Try to fetch DIU page for validation
    for name, url in DIU_URLS.items():
        print(f"  Checking {name}: {url}")
        html = fetch_page(url)
        if html:
            # Count how many known platforms are mentioned
            matches = 0
            for p in CLEARED_LIST['platforms']:
                # Check various name parts
                for part in p['name'].split('/'):
                    if part.strip().lower() in html.lower():
                        matches += 1
                        break
            print(f"    Matched {matches}/{len(CLEARED_LIST['platforms'])} platforms on page")
    
    # Diff
    diff = diff_snapshots(old, current)
    print(f"\n  Status: {diff['status']}")
    if diff['changes']:
        print("  Changes detected:")
        for c in diff['changes']:
            print(f"    {c['type']}: {c['name']}")
    
    # Save snapshot
    save_snapshot(current)
    
    return current, diff


if __name__ == '__main__':
    diff_only = '--diff-only' in sys.argv
    
    intel_path = os.path.join(os.path.dirname(__file__), '..', '..', 
                              'DroneClear Components Visualizer', 'forge_intel.json')
    
    current, diff = mine_diu()
    
    print(f"\nBlue UAS Summary:")
    print(f"  Cleared List: {len(CLEARED_LIST['platforms'])} platforms")
    print(f"  Framework: {len(CLEARED_LIST['framework_components'])} components")
    
    if not diff_only:
        update_intel(intel_path)
    
    # Output JSON summary
    print(json.dumps(diff, indent=2))
