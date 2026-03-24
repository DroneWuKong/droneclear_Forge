#!/usr/bin/env python3
"""
enrich_descriptions.py — Generate descriptions for parts that have specs but no description.

Uses template-based concatenation of existing schema_data fields.
No AI generation — purely deterministic from existing data.

Usage:
    python3 miners/enrichment/enrich_descriptions.py
    python3 miners/enrichment/enrich_descriptions.py --dry-run
"""

import json
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 
                       'DroneClear Components Visualizer', 'forge_database.json')

# Templates per category — use {field} placeholders from schema_data
TEMPLATES = {
    'receivers': "{protocol} receiver by {_mfr}. {frequency} band. {antenna_type} antenna connector.",
    'control_link_tx': "Radio transmitter by {_mfr}. {protocol} protocol. {frequency} band.",
    'fpv_detectors': "FPV goggles by {_mfr}. {resolution} display. {fov_degrees}° FOV.",
    'video_transmitters': "Video transmitter by {_mfr}. {power_mw}mW output. {frequency} band.",
    'fpv_cameras': "FPV camera by {_mfr}. {resolution} sensor. {fov_degrees}° FOV.",
    'flight_controllers': "Flight controller by {_mfr}. {processor} MCU. {mounting_mm} mounting.",
    'escs': "ESC by {_mfr}. {current_rating_a}A continuous. {firmware} firmware. {mounting_mm} mounting.",
    'frames': "Frame kit by {_mfr}. {size_inches}\" class. {arm_thickness_mm}mm arms. {material} construction.",
    'motors': "Motor by {_mfr}. {stator_diameter}mm x {stator_height}mm stator. {kv}KV.",
    'propellers': "Propeller by {_mfr}. {size_inches}\" diameter. {blades}-blade. {material} material.",
    'batteries': "Battery by {_mfr}. {capacity_mah}mAh {cell_count}S. {discharge_rate_c}C discharge.",
    'antennas': "Antenna by {_mfr}. {frequency} band. {polarization} polarization. {gain_dbi}dBi gain.",
    'gps_modules': "GPS module by {_mfr}. {chipset} chipset. {constellations} support.",
    'stacks': "FC+ESC stack by {_mfr}. {processor} FC + {current_rating_a}A ESC.",
    'lidar': "LiDAR sensor by {_mfr}. {range_m}m range. {channels} channels. {points_per_sec} points/sec.",
    'mesh_radios': "Mesh radio by {_mfr}. {frequency} band. {range_km}km range. {throughput_mbps}Mbps throughput.",
    'thermal_cameras': "Thermal camera by {_mfr}. {resolution} {wavelength}. {netd_mk}mK NETD.",
    'companion_computers': "Companion computer by {_mfr}. {cpu} CPU. {ai_tops} AI TOPS. {power_w}W.",
    'sensors': "Sensor by {_mfr}. {type} type.",
    'counter_uas': "Counter-UAS system by {_mfr}.",
    'propulsion': "Propulsion system by {_mfr}.",
}

# Fallback for any category not in TEMPLATES
FALLBACK = "{_name} by {_mfr}."


def generate_description(part, category):
    """Generate a description from schema_data using templates."""
    template = TEMPLATES.get(category, FALLBACK)
    sd = part.get('schema_data', {})
    
    # Build substitution dict — include both schema_data and top-level fields
    subs = {}
    subs['_mfr'] = part.get('manufacturer', 'Unknown')
    subs['_name'] = part.get('name', '')
    
    # Flatten schema_data — handle nested dicts
    for k, v in sd.items():
        if isinstance(v, dict):
            for sk, sv in v.items():
                subs[f"{k}_{sk}"] = sv
        elif isinstance(v, list):
            subs[k] = ', '.join(str(x) for x in v[:5])
        elif v is not None:
            subs[k] = v
    
    # Apply template with safe substitution
    result = template
    for key, val in subs.items():
        result = result.replace('{' + key + '}', str(val))
    
    # Remove unfilled placeholders
    result = re.sub(r'\{[^}]+\}', '', result)
    
    # Clean up: remove double spaces, trailing punctuation issues
    result = re.sub(r'\s+', ' ', result).strip()
    result = re.sub(r'\.\s*\.', '.', result)
    result = re.sub(r',\s*\.', '.', result)
    result = re.sub(r'\.\s*,', ',', result)
    
    # Remove empty sentences like "  band." or "  mounting."
    result = re.sub(r'\s+\w+\.', lambda m: m.group(0) if len(m.group(0).strip()) > 3 else '.', result)
    
    return result.strip() if len(result.strip()) > 10 else None


import re

def enrich(dry_run=False):
    """Add descriptions to parts that are missing them."""
    with open(DB_PATH) as f:
        db = json.load(f)
    
    total_enriched = 0
    
    for cat, parts in db['components'].items():
        if not isinstance(parts, list):
            continue
        
        enriched = 0
        for part in parts:
            existing = part.get('description', '')
            if existing and len(existing) > 20:
                continue  # Already has a good description
            
            desc = generate_description(part, cat)
            if desc and len(desc) > 15:
                part['description'] = desc
                enriched += 1
        
        if enriched > 0:
            print(f"  {cat:25} +{enriched:4} descriptions")
            total_enriched += enriched
    
    print(f"\n  Total enriched: {total_enriched}")
    
    if not dry_run:
        with open(DB_PATH, 'w') as f:
            json.dump(db, f, indent=2)
        print(f"  Written to {DB_PATH}")
    else:
        print("  DRY RUN — not writing")
    
    return total_enriched


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    print("Enriching descriptions from schema_data...")
    enrich(dry_run=dry_run)
