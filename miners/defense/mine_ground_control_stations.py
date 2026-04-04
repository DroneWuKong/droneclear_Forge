#!/usr/bin/env python3
"""
mine_ground_control_stations.py — Mine GCS products for drone operations.

Targets ground control stations (hardware + software):
  - Hardware GCS (Inspired Flight GS-ONE, MotioNew M10, Winmate)
  - Software GCS (QGroundControl, Mission Planner, UgCS, MAVProxy)
  - Military GCS (GA-ASI Advanced Cockpit)
  - Autonomous platforms (Auterion, VOTIX)
  - Companion compute (ARK Electronics)
  - Autopilot ecosystems (UAV Navigation VECTOR, Veronte)

Usage:
    python3 miners/defense/mine_ground_control_stations.py
    python3 miners/defense/mine_ground_control_stations.py --dry-run
"""

import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from validate_entry import validate_part, validate_parts_batch

CATEGORY = "ground_control_stations"
PID_PREFIX = "GCS"
DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                       'DroneClear Components Visualizer', 'forge_database.json')

MANUFACTURERS = {
    "inspired_flight": {
        "name": "Inspired Flight", "hq": "San Luis Obispo, CA, USA", "country": "United States",
        "products": [
            {"name": "Inspired Flight GS-ONE — NDAA-Compliant Handheld GCS", "description": "Purpose-built NDAA GCS. 7-inch 2000-nit sunlight-readable. Qualcomm QCS6490, 8GB RAM, Android 14. Hot-swap batteries. 6 miles range. QGC, MissionPlanner, UgCS.", "link": "https://inspiredflight.com/", "approx_price": 3500, "display": "7-inch 2000-nit touchscreen", "processor": "Qualcomm QCS6490", "ram_gb": 8, "os": "Android 14", "gcs_software": ["QGroundControl", "MissionPlanner", "UgCS"], "max_range_mi": 6, "hot_swap_battery": True, "form_factor": "handheld controller", "compliance": {"ndaa": True, "blue_uas": True}, "tags": ["ndaa", "2000_nit", "android_14", "hot_swap", "professional"]},
        ],
    },
    "qgroundcontrol": {
        "name": "MAVLink / Dronecode Foundation", "hq": "Open Source Community", "country": "International (open source)",
        "products": [
            {"name": "QGroundControl (QGC) — Open Source GCS Software", "description": "Cross-platform open-source GCS for any MAVLink drone. Windows/macOS/Linux/Android/iOS. PX4 + ArduPilot. Deployed in Vantis ND statewide BVLOS.", "link": "https://qgroundcontrol.com/", "approx_price": 0, "gcs_type": "software", "platforms_supported": ["Windows", "macOS", "Linux", "Android", "iOS"], "autopilot_compatibility": ["PX4", "ArduPilot", "MAVLink"], "license": "Apache 2.0 / GPLv3", "form_factor": "software application", "compliance": {}, "tags": ["open_source", "cross_platform", "mavlink", "px4", "ardupilot", "free"]},
        ],
    },
    "ardupilot": {
        "name": "ArduPilot / Michael Oborne", "hq": "Open Source Community", "country": "International (open source)",
        "products": [
            {"name": "Mission Planner — ArduPilot Full-Featured GCS", "description": "Full-featured desktop GCS for ArduPilot. Deep parameter editor, log analysis, simulation, 3D viz, scripting.", "link": "https://ardupilot.org/planner/", "approx_price": 0, "gcs_type": "software", "platforms_supported": ["Windows", "Linux (experimental)"], "autopilot_compatibility": ["ArduPilot"], "license": "GPLv3", "form_factor": "desktop software", "compliance": {}, "tags": ["ardupilot", "open_source", "log_analysis", "simulation", "advanced"]},
            {"name": "MAVProxy — Command Line GCS for Developers", "description": "Lightweight CLI GCS in Python for Linux. Graphical map/mission modules. Extensible via Python. Low resource for companion computers.", "link": "https://ardupilot.org/mavproxy/", "approx_price": 0, "gcs_type": "software (CLI)", "platforms_supported": ["Linux", "macOS"], "autopilot_compatibility": ["ArduPilot"], "license": "GPLv3", "language": "Python", "form_factor": "CLI software", "compliance": {}, "tags": ["cli", "python", "developer", "lightweight", "extensible", "linux"]},
        ],
    },
    "motionew": {
        "name": "MotioNew", "hq": "International", "country": "International",
        "products": [
            {"name": "MotioNew M10 — Handheld All-in-One GCS", "description": "All-in-one handheld GCS: computer + radio + joysticks + datalink. 10.1-inch 1200-nit, 1920x1200. Linux/Windows. QGC + MissionPlanner. Multi-vehicle.", "link": "https://www.motionew.com/", "approx_price": 2500, "display": "10.1-inch 1920x1200 1200-nit", "os": ["Linux", "Windows"], "gcs_software": ["QGroundControl", "MissionPlanner"], "vehicle_types": ["multirotor", "fixed-wing", "VTOL", "UGV", "ROV", "USV"], "form_factor": "handheld all-in-one", "compliance": {}, "tags": ["all_in_one", "10_inch", "1200_nit", "joysticks", "multi_vehicle"]},
        ],
    },
    "sph_engineering": {
        "name": "SPH Engineering", "hq": "Riga, Latvia", "country": "Latvia",
        "products": [
            {"name": "UgCS — Enterprise Mission Planning GCS", "description": "Universal enterprise GCS with 3D interface. APM, Pixhawk, DJI, Mikrokopter. Multi-drone control. DEM import, ADS-B, simulator, geotagging.", "link": "https://www.ugcs.com/", "approx_price": "Free (basic) / $1,999+ (enterprise)", "gcs_type": "software", "autopilot_compatibility": ["ArduPilot", "PX4", "DJI", "Mikrokopter"], "multi_drone": True, "form_factor": "desktop software", "compliance": {"nato_nation": True}, "tags": ["enterprise", "3d", "multi_drone", "adsb", "dji_support", "simulator"]},
        ],
    },
    "ga_asi": {
        "name": "General Atomics Aeronautical Systems (GA-ASI)", "hq": "San Diego, CA, USA", "country": "United States",
        "products": [
            {"name": "General Atomics Advanced Cockpit GCS", "description": "Military-grade GCS for Predator/Gray Eagle. Any land base, aircraft, or ship worldwide. Full mission planning, sensor control, weapons.", "link": "https://www.ga-asi.com/ground-control-stations/", "approx_price": "Military procurement (multi-million $)", "gcs_type": "military shelter/station", "compatible_platforms": ["MQ-1 Predator", "MQ-9 Reaper", "MQ-1C Gray Eagle"], "deployment_options": ["land base", "aircraft", "ship"], "form_factor": "shelter / ground station", "compliance": {"ndaa": True, "dod": True, "combat_proven": True}, "tags": ["military", "predator", "reaper", "gray_eagle", "group_5", "combat_proven"]},
        ],
    },
    "auterion": {
        "name": "Auterion", "hq": "Zurich, Switzerland / Arlington, VA, USA", "country": "Switzerland / United States",
        "products": [
            {"name": "Auterion Mission Control — Enterprise Drone Fleet GCS", "description": "Enterprise fleet management on PX4. Cloud-connected, OTA updates. US Army SRR program. NDAA-compliant.", "link": "https://auterion.com/", "approx_price": "Contact vendor (enterprise license)", "gcs_type": "enterprise fleet management software", "autopilot_compatibility": ["PX4"], "cloud_connected": True, "fleet_management": True, "military_programs": ["US Army SRR"], "form_factor": "software platform", "compliance": {"ndaa": True}, "tags": ["enterprise", "fleet_management", "px4", "cloud", "srr", "ndaa"]},
        ],
    },
    "ark_electronics": {
        "name": "ARK Electronics", "hq": "USA", "country": "United States",
        "products": [
            {"name": "ARK Electronics Just a Jetson — NDAA-Compliant Carrier Board", "description": "NDAA carrier board for Jetson modules. Secure onboard AI compute for defense drones. PX4 + ArduPilot. Blue UAS compatible.", "link": "https://arkelectron.com/", "approx_price": 299, "gcs_type": "companion compute / carrier board", "compatible_modules": ["Jetson Orin Nano", "Jetson Orin NX"], "autopilot_compatibility": ["PX4", "ArduPilot"], "form_factor": "carrier board", "compliance": {"ndaa": True, "blue_uas": True}, "tags": ["ndaa", "jetson", "carrier_board", "defense", "blue_uas"]},
        ],
    },
    "votix": {
        "name": "VOTIX", "hq": "Israel", "country": "Israel",
        "products": [
            {"name": "VOTIX DroneOS — Autonomous Drone Operating System", "description": "Autonomous DroneOS for DFR and AAM. Integrates uAvionix ADS-B for Detect and Avoid. Autonomous launch, mission, landing.", "link": "https://www.votix.com/", "approx_price": "Contact vendor", "gcs_type": "autonomous drone OS", "features": ["DFR", "AAM", "ADS-B integration", "autonomous operations"], "detect_and_avoid": True, "form_factor": "software platform", "compliance": {}, "tags": ["dfr", "aam", "autonomous", "adsb", "first_responder"]},
        ],
    },
}

def load_db():
    with open(DB_PATH) as f: return json.load(f)
def save_db(db):
    with open(DB_PATH, 'w') as f: json.dump(db, f, indent=2, ensure_ascii=False)

def get_next_pid(existing):
    max_num = 0
    for e in existing:
        pid = e.get('pid', '')
        if pid.startswith(PID_PREFIX + '-'):
            try: max_num = max(max_num, int(pid.split('-')[1]))
            except: pass
    return max_num + 1

def build_entries():
    entries = []; pid_counter = 1
    for mfr_key, mfr in MANUFACTURERS.items():
        for product in mfr['products']:
            entry = {"pid": f"{PID_PREFIX}-{pid_counter:04d}", "category": CATEGORY,
                     "manufacturer": mfr['name'], "manufacturer_hq": mfr['hq'], "country": mfr['country'],
                     **product, "schema_data": {}}
            valid, reason = validate_part(entry)
            if valid: entries.append(entry); pid_counter += 1
            else: print(f"  REJECTED: {product['name']} — {reason}")
    return entries

def mine_ground_control_stations(dry_run=False):
    print(f"═══ Mining {CATEGORY} ═══\n")
    entries = build_entries()
    valid, rejected = validate_parts_batch(entries)
    print(f"\n  Built {len(valid)} valid entries from {len(MANUFACTURERS)} manufacturers")
    if dry_run:
        for e in valid: print(f"    [{e['pid']}] {e['name']}")
        return
    db = load_db(); existing = db['components'].get(CATEGORY, [])
    existing_names = {e['name'].lower() for e in existing}
    added = 0; next_pid = get_next_pid(existing)
    for entry in valid:
        if entry['name'].lower() not in existing_names:
            entry['pid'] = f"{PID_PREFIX}-{next_pid:04d}"; existing.append(entry)
            existing_names.add(entry['name'].lower()); next_pid += 1; added += 1
            print(f"  + {entry['pid']}: {entry['name']}")
        else: print(f"  = SKIP (exists): {entry['name']}")
    db['components'][CATEGORY] = existing; save_db(db)
    print(f"\n  ✓ {added} new. Total {CATEGORY}: {len(existing)}")

if __name__ == '__main__':
    mine_ground_control_stations(dry_run='--dry-run' in sys.argv)
