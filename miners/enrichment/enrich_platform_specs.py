#!/usr/bin/env python3
"""
enrich_platform_specs.py — Fill missing platform specifications from known data.

Sources: manufacturer published specs, Wikipedia data, combat reports.
No network needed — uses embedded reference data.

Usage:
    python3 miners/enrichment/enrich_platform_specs.py
    python3 miners/enrichment/enrich_platform_specs.py --dry-run
"""

import json
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 
                       'DroneClear Components Visualizer', 'forge_database.json')

# ══════════════════════════════════════════════════
# Reference specs — sourced from manufacturer sites, Wikipedia infoboxes, Jane's
# Speeds in km/h, ranges in km, endurance in minutes, weights in kg
# ══════════════════════════════════════════════════

PLATFORM_SPECS = {
    # US Blue UAS / Tactical
    "Shield AI Nova 2": {"max_speed_kmh": 65, "max_range_km": 2, "max_endurance_min": 30, "max_payload_kg": 0.5, "mtow_kg": 2.5, "group": 1, "propulsion": "Electric quad"},
    "Skydio X2/X10": {"max_speed_kmh": 58, "max_range_km": 6, "max_endurance_min": 35, "max_payload_kg": 0.1, "mtow_kg": 1.5, "group": 1, "propulsion": "Electric quad"},
    "Freefly Astro": {"max_speed_kmh": 65, "max_range_km": 7, "max_endurance_min": 33, "max_payload_kg": 1.5, "mtow_kg": 4.5, "group": 1, "propulsion": "Electric quad"},
    "Inspired Flight IF1200A": {"max_speed_kmh": 55, "max_range_km": 5, "max_endurance_min": 30, "max_payload_kg": 5.5, "mtow_kg": 12, "group": 2, "propulsion": "Electric hex"},
    "Parrot ANAFI USA": {"max_speed_kmh": 55, "max_range_km": 4, "max_endurance_min": 32, "max_payload_kg": 0, "mtow_kg": 0.5, "group": 1, "propulsion": "Electric quad"},
    "Ascent Aerosystems Spirit": {"max_speed_kmh": 50, "max_range_km": 3, "max_endurance_min": 50, "max_payload_kg": 1.0, "mtow_kg": 4.0, "group": 1, "propulsion": "Electric coaxial"},
    "Red Cat Holdings FANG F7": {"max_speed_kmh": 120, "max_range_km": 3, "max_endurance_min": 15, "max_payload_kg": 0.3, "mtow_kg": 0.8, "group": 1, "propulsion": "Electric quad (FPV)"},
    "Teal Drones / Red Cat Holdings Teal Black Widow": {"max_speed_kmh": 65, "max_range_km": 5, "max_endurance_min": 30, "max_payload_kg": 0.2, "mtow_kg": 1.8, "group": 1, "propulsion": "Electric quad"},
    "Titan Dynamics Raptor [BLUE]": {"max_speed_kmh": 55, "max_range_km": 5, "max_endurance_min": 35, "max_payload_kg": 2.0, "mtow_kg": 6.0, "group": 1, "propulsion": "Electric quad"},
    "ModalAI Seeker Vision FPV": {"max_speed_kmh": 100, "max_range_km": 2, "max_endurance_min": 12, "max_payload_kg": 0.1, "mtow_kg": 0.6, "group": 1, "propulsion": "Electric quad (FPV)"},
    "ModalAI Stinger Vision FPV": {"max_speed_kmh": 120, "max_range_km": 3, "max_endurance_min": 10, "max_payload_kg": 0.2, "mtow_kg": 0.7, "group": 1, "propulsion": "Electric quad (FPV)"},
    "Hoverfly LiveSky/Spectre": {"max_speed_kmh": 0, "max_range_km": 0.1, "max_endurance_min": 480, "max_payload_kg": 3.0, "mtow_kg": 8.0, "group": 1, "propulsion": "Electric tethered quad", "note": "Tethered — unlimited endurance (8+ hrs rated)"},
    
    # AeroVironment
    "AeroVironment Switchblade 300": {"max_speed_kmh": 160, "max_range_km": 10, "max_endurance_min": 15, "max_payload_kg": 0, "mtow_kg": 2.5, "group": 1, "propulsion": "Electric (tube-launched)", "note": "Loitering munition"},
    "AeroVironment Switchblade 600": {"max_speed_kmh": 185, "max_range_km": 40, "max_endurance_min": 40, "max_payload_kg": 0, "mtow_kg": 23, "group": 3, "propulsion": "Electric (tube-launched)", "note": "Anti-armor loitering munition"},
    "AeroVironment Puma 3 AE": {"max_speed_kmh": 83, "max_range_km": 20, "max_endurance_min": 180, "max_payload_kg": 1.2, "mtow_kg": 6.8, "group": 2, "propulsion": "Electric fixed-wing"},
    "AeroVironment VAPOR CLE": {"max_speed_kmh": 65, "max_range_km": 10, "max_endurance_min": 60, "max_payload_kg": 2.0, "mtow_kg": 7.0, "group": 2, "propulsion": "Electric VTOL"},
    
    # Shield AI
    "Shield AI V-BAT": {"max_speed_kmh": 167, "max_range_km": 350, "max_endurance_min": 720, "max_payload_kg": 11, "mtow_kg": 57, "group": 3, "propulsion": "JP-8 ducted fan VTOL", "note": "12+ hour endurance. Operates in GPS/comms-denied."},
    
    # Turkish
    "Baykar Technology Bayraktar TB2": {"max_speed_kmh": 220, "cruise_speed_kmh": 130, "max_range_km": 150, "max_endurance_min": 1620, "max_payload_kg": 150, "mtow_kg": 700, "wingspan_m": 12, "operating_altitude_m": 7620, "propulsion": "Rotax 912 (100hp)"},
    "Baykar Technology Bayraktar Akinci": {"max_speed_kmh": 361, "cruise_speed_kmh": 230, "max_range_km": 300, "max_endurance_min": 1440, "max_payload_kg": 1350, "mtow_kg": 6000, "wingspan_m": 20, "operating_altitude_m": 12192, "propulsion": "2x AI-450T (450hp each)"},
    "Baykar Technologies Bayraktar TB3": {"max_speed_kmh": 220, "max_range_km": 150, "max_endurance_min": 1560, "max_payload_kg": 280, "mtow_kg": 1450, "wingspan_m": 14, "propulsion": "PD-170 (170hp)", "note": "Carrier-optimized. Foldable wings."},
    "Baykar Technology Bayraktar Kizilelma (MIUS)": {"max_speed_kmh": 900, "max_range_km": 500, "max_endurance_min": 300, "max_payload_kg": 1500, "mtow_kg": 6000, "wingspan_m": 14, "operating_altitude_m": 10668, "propulsion": "AI-322 turbojet", "note": "Unmanned combat jet. Carrier-capable."},
    "TAI/TUSAS Anka Series": {"max_speed_kmh": 217, "cruise_speed_kmh": 130, "max_range_km": 200, "max_endurance_min": 1800, "max_payload_kg": 200, "mtow_kg": 1750, "wingspan_m": 17.5, "propulsion": "TEI PD-170 (170hp)"},
    "STM Kargu": {"max_speed_kmh": 72, "max_range_km": 5, "max_endurance_min": 30, "max_payload_kg": 1.4, "mtow_kg": 7, "propulsion": "Electric quad", "note": "Autonomous swarm loitering munition. AI target recognition."},
    
    # Israeli
    "Israel Aerospace Industries Harop/Harpy": {"max_speed_kmh": 185, "max_range_km": 1000, "max_endurance_min": 540, "max_payload_kg": 23, "mtow_kg": 135, "wingspan_m": 3.0, "propulsion": "Rotary engine", "note": "Harop: EO/IR seeker. Harpy: anti-radiation."},
    "Elbit Systems Skylark Family": {"max_speed_kmh": 70, "max_range_km": 15, "max_endurance_min": 180, "max_payload_kg": 1.2, "mtow_kg": 7.5, "wingspan_m": 3.1, "propulsion": "Electric"},
    "Elbit Systems Lanius": {"max_speed_kmh": 72, "max_range_km": 1, "max_endurance_min": 7, "max_payload_kg": 0.15, "mtow_kg": 1.25, "propulsion": "Electric quad", "note": "Indoor autonomous recon. AI-driven CQB."},
    "Aeronautics Group Orbiter Series": {"max_speed_kmh": 130, "max_range_km": 100, "max_endurance_min": 180, "max_payload_kg": 5, "mtow_kg": 30, "wingspan_m": 4.2, "propulsion": "Electric (Orbiter 3)", "note": "Orbiter 1K is loitering munition variant."},
    "XTEND XTEND XOS Platform": {"max_speed_kmh": 60, "max_range_km": 1, "max_endurance_min": 15, "max_payload_kg": 0.5, "mtow_kg": 2.0, "propulsion": "Electric quad", "note": "Indoor tactical. Human-machine teaming. Gesture/VR control."},
    
    # European
    "Tekever AR3/AR5": {"max_speed_kmh": 150, "max_range_km": 100, "max_endurance_min": 720, "max_payload_kg": 20, "mtow_kg": 180, "wingspan_m": 5.4, "propulsion": "Combustion (AR5)", "note": "Maritime ISR. 12hr endurance. SATCOM + SAR."},
    "Safran Patroller": {"max_speed_kmh": 200, "max_range_km": 180, "max_endurance_min": 1200, "max_payload_kg": 250, "mtow_kg": 1050, "wingspan_m": 18, "propulsion": "Rotax 914 (115hp)"},
    "WB Group Warmate / FlyEye": {"max_speed_kmh": 80, "max_range_km": 12, "max_endurance_min": 30, "max_payload_kg": 1.4, "mtow_kg": 5.3, "propulsion": "Electric", "note": "FlyEye: recon. Warmate: loitering munition."},
    "Novadem NX70": {"max_speed_kmh": 45, "max_range_km": 2, "max_endurance_min": 30, "max_payload_kg": 0.2, "mtow_kg": 1.3, "propulsion": "Electric quad", "note": "French micro tactical ISR."},
    "SYPAQ Corvo PPDS": {"max_speed_kmh": 60, "max_range_km": 50, "max_endurance_min": 120, "max_payload_kg": 3, "mtow_kg": 7, "wingspan_m": 2.0, "propulsion": "Electric fixed-wing", "note": "Cardboard drone. Expendable. $3,500 unit cost."},
    "DeltaQuad Evo Tactical": {"max_speed_kmh": 110, "max_range_km": 100, "max_endurance_min": 120, "max_payload_kg": 1.5, "mtow_kg": 7, "wingspan_m": 2.35, "propulsion": "Electric VTOL fixed-wing"},
    "Leonardo AWHERO": {"max_speed_kmh": 185, "max_range_km": 100, "max_endurance_min": 360, "max_payload_kg": 35, "mtow_kg": 200, "propulsion": "Rotary-wing unmanned helicopter"},
    
    # Chinese
    "AVIC / Chengdu Aircraft Wing Loong Series": {"max_speed_kmh": 280, "max_range_km": 4000, "max_endurance_min": 1200, "max_payload_kg": 480, "mtow_kg": 4200, "wingspan_m": 20.5, "operating_altitude_m": 9000, "propulsion": "Turboprop"},
    "CASC CH (Rainbow) Series": {"max_speed_kmh": 235, "max_range_km": 2000, "max_endurance_min": 1200, "max_payload_kg": 345, "mtow_kg": 4100, "wingspan_m": 18, "propulsion": "Piston (CH-4), Turboprop (CH-5)"},
    
    # South Korean
    "Korean Air / KAI KUS-FS MUAV": {"max_speed_kmh": 250, "max_range_km": 250, "max_endurance_min": 1440, "max_payload_kg": 200, "mtow_kg": 1500, "wingspan_m": 11, "propulsion": "Turboprop"},
    
    # Indian
    "ideaForge SWITCH / Netra": {"max_speed_kmh": 65, "max_range_km": 15, "max_endurance_min": 120, "max_payload_kg": 2.0, "mtow_kg": 7.5, "propulsion": "Electric VTOL fixed-wing"},
    
    # Firestorm Labs
    "Firestorm Tempest 50": {"max_speed_kmh": 100, "max_range_km": 50, "max_endurance_min": 60, "max_payload_kg": 5, "mtow_kg": 15, "group": 2, "propulsion": "Electric/hybrid"},
    "Firestorm El Niño": {"max_speed_kmh": 80, "max_range_km": 30, "max_endurance_min": 45, "max_payload_kg": 2, "mtow_kg": 8, "group": 2, "propulsion": "Electric"},
    "Firestorm Squall": {"max_speed_kmh": 120, "max_range_km": 5, "max_endurance_min": 20, "max_payload_kg": 1, "mtow_kg": 3, "group": 1, "propulsion": "Electric FPV"},
    
    # Commercial
    "DJI DJI Matrice 4 Series": {"max_speed_kmh": 61, "max_range_km": 20, "max_endurance_min": 45, "max_payload_kg": 2.0, "mtow_kg": 5.5, "propulsion": "Electric quad"},
    "Freefly Astro": {"max_speed_kmh": 65, "max_range_km": 7, "max_endurance_min": 33, "max_payload_kg": 1.5, "mtow_kg": 4.5, "propulsion": "Electric quad"},
    "Hylio AG-272": {"max_speed_kmh": 50, "max_range_km": 3, "max_endurance_min": 15, "max_payload_kg": 22, "mtow_kg": 42, "propulsion": "Electric hex", "note": "Agricultural spraying. 22L tank."},
}


def enrich(dry_run=False):
    """Fill platform specs from reference data."""
    with open(DB_PATH) as f:
        db = json.load(f)
    
    platforms = db.get('drone_models', [])
    enriched = 0
    
    for p in platforms:
        name = p.get('name', '')
        if name not in PLATFORM_SPECS:
            continue
        
        specs = PLATFORM_SPECS[name]
        changed = False
        
        for field, value in specs.items():
            if not p.get(field):
                p[field] = value
                changed = True
        
        if changed:
            enriched += 1
    
    print(f"  Enriched {enriched}/{len(platforms)} platforms with specs")
    
    # Summary
    has_speed = sum(1 for p in platforms if p.get('max_speed_kmh'))
    has_range = sum(1 for p in platforms if p.get('max_range_km'))
    has_endurance = sum(1 for p in platforms if p.get('max_endurance_min'))
    has_payload = sum(1 for p in platforms if p.get('max_payload_kg'))
    print(f"  Speed: {has_speed}/{len(platforms)}")
    print(f"  Range: {has_range}/{len(platforms)}")
    print(f"  Endurance: {has_endurance}/{len(platforms)}")
    print(f"  Payload: {has_payload}/{len(platforms)}")
    
    if not dry_run:
        with open(DB_PATH, 'w') as f:
            json.dump(db, f, indent=2)
        print(f"  Written to {DB_PATH}")
    else:
        print("  DRY RUN — not writing")
    
    return enriched


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    print("Enriching platform specs...")
    enrich(dry_run=dry_run)
