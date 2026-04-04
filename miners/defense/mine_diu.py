#!/usr/bin/env python3
"""
mine_diu.py — Track DIU programs: Blue UAS + Drone Dominance + Replicator.

Tracks three major DIU-executed programs:
  1. Blue UAS Cleared List — approved drone platforms & framework components
  2. Drone Dominance Program (DDP) — $1.1B one-way attack drone initiative
     - Phase I Gauntlet vendors (25 invited, 11 winners)
     - Company profiles, scores, specialties
     - Phase progression tracking
  3. Replicator program updates

Maintains local snapshots and diffs against them to detect changes.

Run locally — requires network access to diu.mil / war.gov.

Usage:
    python3 miners/defense/mine_diu.py
    python3 miners/defense/mine_diu.py --diff-only
    python3 miners/defense/mine_diu.py --ddg-only
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
    "ddg_announcement": "https://www.war.gov/News/Releases/Release/Article/4396462/war-department-announces-vendors-invited-to-compete-in-phase-i-of-the-drone-dom/",
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

# ══════════════════════════════════════════════════════════════
# Drone Dominance Program (DDP) — Ground Truth
# ══════════════════════════════════════════════════════════════
#
# Program overview:
#   - Sponsor: Office of the Secretary of War (Pete Hegseth)
#   - Executors: DIU, Test Resource Management Center, NSWC Crane
#   - Total budget: $1.1B across 4 phases
#   - Mission: rapidly field low-cost one-way attack drones at scale
#   - Goal: 300,000+ weaponized drones by 2027
#   - Phase structure: 4 Gauntlets → unit cost decreases, volume increases
#   - Phase I Gauntlet: Feb 18 – early March 2026 at Fort Moore (Benning), GA
#   - Phase I orders: ~$150M for 30,000 sUAS
#   - Up to 12 advance to production; must pass NDAA/Blue UAS via DCMA
#
# Notable absences from invited list: Anduril, Teledyne
# Key supplier: Doodle Labs radio modules in ≥7 entrants
# ══════════════════════════════════════════════════════════════

DRONE_DOMINANCE = {
    "program": {
        "name": "Drone Dominance Program (DDP)",
        "sponsor": "Office of the Secretary of War",
        "executors": [
            "Defense Innovation Unit (DIU)",
            "Test Resource Management Center (TRMC)",
            "Naval Surface Warfare Center, Crane Division (NSWC Crane)",
        ],
        "total_budget_usd": 1_100_000_000,
        "total_phases": 4,
        "goal": "300,000+ weaponized one-way attack drones by 2027",
        "mandate": "Unit prices decrease, production volumes increase, operational capability rises across phases",
        "phase_3_4_requirement": "More than one-to-one relationship between drone and operators (swarm control mandatory)",
        "announced": "2026-02-03",
    },

    # ── Phase I ──────────────────────────────────────────────
    "phase_1": {
        "name": "Gauntlet I",
        "status": "complete",
        "location": "Fort Moore (formerly Fort Benning), GA",
        "dates": {"start": "2026-02-18", "end": "2026-03-01"},
        "budget_usd": 150_000_000,
        "order_quantity": 30_000,
        "evaluation_criteria": [
            "Gauntlet flight performance",
            "Military operator evaluations",
            "Production & supply chain capability",
            "10 km range strike scenarios",
            "Urban target identification",
        ],
        "max_winners": 12,

        # 25 companies invited to compete
        "invited": [
            {"name": "ANNO.AI, Inc.", "hq": "USA", "specialty": "AI/autonomy", "note": ""},
            {"name": "Ascent Aerosystems Inc.", "hq": "USA", "specialty": "Coaxial-rotor tactical UAS", "note": "Also on Blue UAS list (Spirit)"},
            {"name": "Auterion Government Solutions Inc.", "hq": "Switzerland/USA", "specialty": "Open-architecture UAS software/avionics", "note": "AI-enabled guidance systems; European tech roots"},
            {"name": "DZYNE Technologies, LLC", "hq": "USA", "specialty": "Dronebuster C-UAS / drone platforms", "note": "Also makes the only DoD-authorized handheld jammer"},
            {"name": "Ewing Aerospace LLC", "hq": "USA", "specialty": "Drone platforms", "note": ""},
            {"name": "Farage Precision, LLC", "hq": "USA", "specialty": "Precision manufacturing", "note": ""},
            {"name": "Firestorm Labs, Inc.", "hq": "USA", "specialty": "Loitering munition / attritable UAS", "note": ""},
            {"name": "General Cherry Corp", "hq": "Ukraine", "specialty": "FPV attack drones", "note": "Well-known Ukrainian drone manufacturer; combat-proven"},
            {"name": "Greensight Inc.", "hq": "USA", "specialty": "Autonomous drone operations", "note": ""},
            {"name": "Griffon Aerospace, Inc.", "hq": "USA", "specialty": "Target drones / tactical UAS", "note": "Long history in unmanned targets"},
            {"name": "Halo Aeronautics, LLC", "hq": "USA", "specialty": "Attack UAS", "note": ""},
            {"name": "Kratos SRE, Inc.", "hq": "USA", "specialty": "Unmanned vehicles / defense electronics", "note": "Subsidiary of larger defense firm; XQ-58A Valkyrie heritage"},
            {"name": "ModalAI, Inc.", "hq": "USA", "specialty": "Flight computers / autonomy stacks", "note": "VOXL 2 companion computer; Blue UAS certified"},
            {"name": "Napatree Technology LLC", "hq": "USA", "specialty": "UAS technology", "note": ""},
            {"name": "Neros, Inc.", "hq": "USA", "specialty": "Low-cost expendable drones", "note": "Designed for military, rapid production"},
            {"name": "OKSI Ventures, Inc.", "hq": "USA", "specialty": "UAS ventures", "note": ""},
            {"name": "Paladin Defense Services LLC", "hq": "USA", "specialty": "Defense services / UAS", "note": ""},
            {"name": "Performance Drone Works LLC", "hq": "USA", "specialty": "Tactical sUAS", "note": "C100 on Blue UAS list; Blackwave radio for USSOCOM"},
            {"name": "Responsibly Ltd.", "hq": "International", "specialty": "UAS", "note": "Foreign firm"},
            {"name": "Swarm Defense Technologies, LLC", "hq": "Detroit, MI, USA", "specialty": "Swarm / mass production", "note": "8 years manufacturing; 20,000+ units built; deconfliction algorithm for thousands of drones"},
            {"name": "Teal Drones Inc.", "hq": "USA", "specialty": "Mil-spec sUAS", "note": "Red Cat Holdings subsidiary; Golden Eagle/Black Widow; Blue UAS"},
            {"name": "Ukrainian Defense Drones Tech Corp", "hq": "Ukraine", "specialty": "Combat-proven attack drones", "note": "Ukrainian defense manufacturer"},
            {"name": "Vector Defense, Inc.", "hq": "USA", "specialty": "Defense UAS", "note": ""},
            {"name": "W. S. Darley & Co.", "hq": "USA", "specialty": "Defense/first responder equipment", "note": "Established defense equipment supplier"},
            {"name": "XTEND Reality Inc.", "hq": "Israel", "specialty": "Human-machine teaming / tactical drones", "note": "XOS integrated into Lockheed Skunk Works MDCX C2 platform"},
        ],

        # 11 winners from Gauntlet I (ranked by score)
        "winners": [
            {"rank": 1, "name": "Skycutter", "score": 99.3, "hq": "United Kingdom", "note": "British startup; stunned US defense establishment; highest score by wide margin"},
            {"rank": 2, "name": "Neros", "score": 87.5, "hq": "USA", "note": "Low-cost expendable drone specialist"},
            {"rank": 3, "name": "Napatree", "score": 80.3, "hq": "USA", "note": ""},
            {"rank": 4, "name": "ModalAI", "score": 77.7, "hq": "USA", "note": "VOXL 2 autonomy stack; Blue UAS; already in SRR program"},
            {"rank": 5, "name": "Auterion", "score": 77.0, "hq": "Switzerland/USA", "note": "PX4-based open architecture; enterprise fleet management"},
            {"rank": 6, "name": "Ukrainian Defense Drones (UDD)", "score": 72.9, "hq": "Ukraine", "note": "Combat-proven in Russo-Ukrainian war"},
            {"rank": 7, "name": "Griffon Aerospace", "score": 72.0, "hq": "USA", "note": "Established target/tactical drone maker"},
            {"rank": 8, "name": "Nokturnal AI", "score": 70.3, "hq": "USA", "note": "AI-focused; not in original 25 invite list — may have entered via alternate path or name change"},
            {"rank": 9, "name": "Halo Aeronautics", "score": 70.2, "hq": "USA", "note": ""},
            {"rank": 10, "name": "Ascent Aerosystems", "score": 70.1, "hq": "USA", "note": "HELIUS nano-UAV; coaxial rotor specialist; Blue UAS"},
            {"rank": 11, "name": "Farage Precision", "score": 70.0, "hq": "USA", "note": "Precision manufacturing"},
        ],

        # Companies that competed but did not advance
        "non_advancing": [
            "Anno AI", "Draganfly", "DZYNE Technologies", "Ewing Aerospace",
            "Firestorm Labs", "General Cherry", "Greensight",
            "Paladin Defense Services", "Performance Drone Works",
            "Swarm Defense Technologies", "Teal Drones", "Titan Dynamics",
            "Vector Defense", "W.S. Darley", "XTEND Reality",
        ],

        # Notable observations
        "analysis": {
            "notable_absences_from_program": ["Anduril Industries", "Teledyne"],
            "notable_non_advancing": [
                "Teal Drones (Red Cat) — Blue UAS incumbent, did not advance",
                "XTEND Reality — despite Lockheed MDCX integration",
                "Performance Drone Works — Blue UAS C100, USSOCOM Blackwave",
                "General Cherry — well-known Ukrainian manufacturer",
                "Firestorm Labs — loitering munition specialist",
                "Kratos SRE — invited but not listed in winners or non-advancing (unclear status)",
            ],
            "key_supplier": "Doodle Labs radio modules confirmed in at least 7 entrants",
            "surprise_winner": "Skycutter (UK) scored 99.3 — 12 points above #2; British startup beat entire US defense industrial base",
            "foreign_winners": ["Skycutter (UK)", "Ukrainian Defense Drones (Ukraine)"],
            "compliance_requirement": "All winners must pass NDAA/Blue UAS compliance verification by DCMA before contract award",
        },
    },

    # ── Phase II-IV (future) ─────────────────────────────────
    "phase_2": {"name": "Gauntlet II", "status": "planned", "note": "Unit costs decrease, volumes increase"},
    "phase_3": {"name": "Gauntlet III", "status": "planned", "note": "Requires multi-drone operator control (swarm)"},
    "phase_4": {"name": "Gauntlet IV", "status": "planned", "note": "Final phase; hundreds of thousands of units; target completion Jan 2028"},
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


def load_snapshot(name='blue_uas_snapshot'):
    """Load a previous snapshot for diffing."""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, f'{name}.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def save_snapshot(data, name='blue_uas_snapshot'):
    """Save current data as snapshot."""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    path = os.path.join(SNAPSHOT_DIR, f'{name}.json')
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


def diff_ddg(old, new):
    """Compare DDG snapshots to detect phase changes or new winners."""
    if not old:
        return {'status': 'first_run', 'changes': []}

    changes = []

    # Check for new winners
    old_winners = {w['name'] for w in old.get('phase_1', {}).get('winners', [])}
    new_winners = {w['name'] for w in new.get('phase_1', {}).get('winners', [])}
    for name in new_winners - old_winners:
        changes.append({'type': 'ddg_winner_added', 'name': name})
    for name in old_winners - new_winners:
        changes.append({'type': 'ddg_winner_removed', 'name': name})

    # Check for phase status changes
    for phase_key in ['phase_1', 'phase_2', 'phase_3', 'phase_4']:
        old_status = old.get(phase_key, {}).get('status', '')
        new_status = new.get(phase_key, {}).get('status', '')
        if old_status != new_status:
            changes.append({'type': 'ddg_phase_change', 'phase': phase_key,
                            'from': old_status, 'to': new_status})

    return {
        'status': 'changed' if changes else 'unchanged',
        'changes': changes,
    }


def update_intel(intel_path):
    """Update forge_intel.json with Blue UAS + DDG data."""
    with open(intel_path) as f:
        intel = json.load(f)

    # Blue UAS
    intel['blue_uas'] = {
        'platforms': CLEARED_LIST['platforms'],
        'framework': CLEARED_LIST['framework_components'],
        'total_platforms': len(CLEARED_LIST['platforms']),
        'total_framework': len(CLEARED_LIST['framework_components']),
        'last_checked': datetime.utcnow().strftime('%Y-%m-%d'),
    }

    # Drone Dominance Program
    ddg = DRONE_DOMINANCE
    p1 = ddg['phase_1']
    intel['drone_dominance'] = {
        'program': ddg['program'],
        'phase_1': {
            'status': p1['status'],
            'location': p1['location'],
            'dates': p1['dates'],
            'budget_usd': p1['budget_usd'],
            'order_quantity': p1['order_quantity'],
            'invited_count': len(p1['invited']),
            'invited': p1['invited'],
            'winners_count': len(p1['winners']),
            'winners': p1['winners'],
            'non_advancing': p1['non_advancing'],
            'analysis': p1['analysis'],
        },
        'phase_2': ddg['phase_2'],
        'phase_3': ddg['phase_3'],
        'phase_4': ddg['phase_4'],
        'last_checked': datetime.utcnow().strftime('%Y-%m-%d'),
    }

    with open(intel_path, 'w') as f:
        json.dump(intel, f, indent=2)

    print(f"  Updated forge_intel.json:")
    print(f"    Blue UAS: {len(CLEARED_LIST['platforms'])} platforms + {len(CLEARED_LIST['framework_components'])} components")
    print(f"    DDG: {len(p1['invited'])} invited → {len(p1['winners'])} winners (Phase I)")


def mine_blue_uas():
    """Run the Blue UAS mining pipeline."""
    print("═══ Mining Blue UAS Cleared List ═══\n")

    old = load_snapshot('blue_uas_snapshot')
    current = {
        'platforms': CLEARED_LIST['platforms'],
        'framework_components': CLEARED_LIST['framework_components'],
        'checked': datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    }

    for name, url in DIU_URLS.items():
        if name in ('blue_uas', 'replicator'):
            print(f"  Checking {name}: {url}")
            html = fetch_page(url)
            if html:
                matches = sum(1 for p in CLEARED_LIST['platforms']
                              if any(part.strip().lower() in html.lower()
                                     for part in p['name'].split('/')))
                print(f"    Matched {matches}/{len(CLEARED_LIST['platforms'])} platforms")

    diff = diff_snapshots(old, current)
    print(f"\n  Status: {diff['status']}")
    if diff['changes']:
        for c in diff['changes']:
            print(f"    {c['type']}: {c['name']}")

    save_snapshot(current, 'blue_uas_snapshot')
    return diff


def mine_ddg():
    """Run the Drone Dominance Program mining pipeline."""
    print("\n═══ Mining Drone Dominance Program ═══\n")

    old = load_snapshot('ddg_snapshot')
    current = DRONE_DOMINANCE

    p1 = current['phase_1']
    print(f"  Program: {current['program']['name']}")
    print(f"  Total budget: ${current['program']['total_budget_usd']:,}")
    print(f"  Goal: {current['program']['goal']}")
    print(f"\n  Phase I — {p1['name']}:")
    print(f"    Status: {p1['status']}")
    print(f"    Location: {p1['location']}")
    print(f"    Dates: {p1['dates']['start']} → {p1['dates']['end']}")
    print(f"    Budget: ${p1['budget_usd']:,} for {p1['order_quantity']:,} sUAS")
    print(f"    Invited: {len(p1['invited'])} companies")
    print(f"    Winners: {len(p1['winners'])} companies")

    print(f"\n  ── Gauntlet I Winners (ranked by score) ──")
    for w in p1['winners']:
        note = f" — {w['note']}" if w.get('note') else ''
        print(f"    #{w['rank']:>2}  {w['score']:>5.1f}  {w['name']:<35} ({w['hq']}){note}")

    print(f"\n  ── Did Not Advance ({len(p1['non_advancing'])}) ──")
    for name in p1['non_advancing']:
        print(f"    • {name}")

    print(f"\n  ── Analysis ──")
    analysis = p1['analysis']
    print(f"    Surprise winner: {analysis['surprise_winner']}")
    print(f"    Foreign winners: {', '.join(analysis['foreign_winners'])}")
    print(f"    Key supplier: {analysis['key_supplier']}")
    print(f"    Notable absences from program: {', '.join(analysis['notable_absences_from_program'])}")
    print(f"    Notable non-advancing:")
    for item in analysis['notable_non_advancing']:
        print(f"      • {item}")

    # Diff against previous snapshot
    diff = diff_ddg(old, current)
    print(f"\n  Snapshot diff: {diff['status']}")
    if diff['changes']:
        for c in diff['changes']:
            print(f"    {c['type']}: {c.get('name', '')} {c.get('phase', '')} {c.get('from', '')}→{c.get('to', '')}")

    save_snapshot(current, 'ddg_snapshot')
    return diff


def mine_diu():
    """Run the full DIU mining pipeline (Blue UAS + DDG)."""
    blue_diff = mine_blue_uas()
    ddg_diff = mine_ddg()
    return blue_diff, ddg_diff


if __name__ == '__main__':
    diff_only = '--diff-only' in sys.argv
    ddg_only = '--ddg-only' in sys.argv

    intel_path = os.path.join(os.path.dirname(__file__), '..', '..',
                              'DroneClear Components Visualizer', 'forge_intel.json')

    if ddg_only:
        ddg_diff = mine_ddg()
    else:
        blue_diff, ddg_diff = mine_diu()

        print(f"\n{'═' * 50}")
        print(f"  SUMMARY")
        print(f"{'═' * 50}")
        print(f"  Blue UAS: {len(CLEARED_LIST['platforms'])} platforms, {len(CLEARED_LIST['framework_components'])} framework components")
        print(f"  DDG P1: {len(DRONE_DOMINANCE['phase_1']['invited'])} invited → {len(DRONE_DOMINANCE['phase_1']['winners'])} winners")

    if not diff_only:
        update_intel(intel_path)
