#!/usr/bin/env python3
"""
mine_navigation_pnt.py — Mine navigation/PNT products from manufacturer sources.

Targets Position, Navigation & Timing systems for UAS:
  - Tactical MEMS IMUs (SBG Systems)
  - Vision-aided INS (Inertial Labs, ModalAI)
  - Anti-jam antennas (Inertial Labs M-AJ-QUATRO)
  - FOG INS (Advanced Navigation Boreas)
  - Quantum PNT (Infleqtion, Q-CTRL)
  - Maritime INS (Teledyne, Anello)
  - Low-SWaP INS with anti-jam (Honeywell)

Usage:
    python3 miners/defense/mine_navigation_pnt.py
    python3 miners/defense/mine_navigation_pnt.py --dry-run
"""

import json, os, sys, time
from urllib.request import urlopen, Request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from validate_entry import validate_part, validate_parts_batch

HEADERS = {"User-Agent": "Forge-Intel-Miner/1.0"}
RATE_LIMIT = 2.0
CATEGORY = "navigation_pnt"
PID_PREFIX = "PNT"

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                       'DroneClear Components Visualizer', 'forge_database.json')
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), '..', '.snapshots')

MANUFACTURERS = {
    "sbg_systems": {
        "name": "SBG Systems", "hq": "Rueil-Malmaison, France", "country": "France",
        "url": "https://www.sbg-systems.com/",
        "check_urls": ["https://www.sbg-systems.com/defense/uav-unmanned-aerial-vehicles-navigation-defense/"],
        "products": [
            {
                "name": "SBG Systems Pulse-40 — Tactical Grade MEMS IMU",
                "description": "Tactical grade IMU with 0.08°/√h noise gyro and 6µg accelerometers. 12g at 0.3W. ITAR-free. Anti-jam via adaptive notch filtering and RAIM. Combat-proven.",
                "link": "https://www.sbg-systems.com/defense/uav-unmanned-aerial-vehicles-navigation-defense/",
                "approx_price": 3000, "subcategory": "imu", "imu_grade": "tactical",
                "gyro_noise": "0.08°/√h", "accelerometer": "6µg",
                "weight_g": 12, "power_w": 0.3, "itar_free": True,
                "gnss_denied_capability": True, "anti_jam": "Adaptive notch filtering + RAIM",
                "form_factor": "compact OEM module",
                "compliance": {"itar_free": True, "nato_nation": True, "combat_proven": True},
                "tags": ["tactical_grade", "mems", "imu", "12_gram", "itar_free", "gnss_denied", "anti_jam"],
            },
        ],
    },
    "inertial_labs": {
        "name": "Inertial Labs", "hq": "Paeonian Springs, VA, USA", "country": "United States",
        "url": "https://inertiallabs.com/",
        "check_urls": ["https://inertiallabs.com/products/ins-inertial-navigation-systems/"],
        "products": [
            {
                "name": "Inertial Labs VINS — Vision-Aided Inertial Navigation System",
                "description": "Fully integrated Vision-Aided INS + AHRS + ADC. MIL-STD-810/461. VIO for GPS-denied navigation. Centimeter accuracy. Fixed-wing, VTOL, multirotor.",
                "link": "https://inertiallabs.com/products/ins-inertial-navigation-systems/",
                "approx_price": 8000, "subcategory": "ins_vio",
                "nav_modes": ["GPS-aided INS", "VIO (GPS-denied)", "ADC fusion"],
                "mil_std": ["MIL-STD-810", "MIL-STD-461"],
                "gnss_denied_capability": True, "vio_capability": True,
                "form_factor": "integrated module", "weight_g": 130,
                "compliance": {"ndaa": True, "mil_std_810": True, "mil_std_461": True},
                "tags": ["vins", "vio", "gps_denied", "mil_std", "ahrs", "centimeter_accuracy"],
            },
            {
                "name": "Inertial Labs M-AJ-QUATRO — Multi-Element Anti-Jam Antenna",
                "description": "Multi-element CRPA anti-jamming antenna for Assured PNT across jammed/spoofed/denied environments. Multiple nulling elements. 2025 breakthrough technology.",
                "link": "https://inertiallabs.com/",
                "approx_price": 5000, "subcategory": "anti_jam_antenna",
                "antenna_type": "CRPA (Controlled Reception Pattern Antenna)",
                "anti_jam": True, "anti_spoof": True, "gnss_denied_capability": True,
                "form_factor": "antenna module", "weight_g": 250,
                "compliance": {"ndaa": True},
                "tags": ["crpa", "anti_jam", "anti_spoof", "assured_pnt", "multi_element"],
            },
        ],
    },
    "advanced_navigation": {
        "name": "Advanced Navigation", "hq": "Sydney, Australia", "country": "Australia",
        "url": "https://www.advancednavigation.com/",
        "check_urls": ["https://www.advancednavigation.com/"],
        "products": [
            {
                "name": "Advanced Navigation Boreas D90 — FOG INS",
                "description": "High-performance FOG INS with AI-powered sensor fusion. Sub-0.1% distance accuracy in deep-mine testing. GPS-free autonomy proven.",
                "link": "https://www.advancednavigation.com/",
                "approx_price": 25000, "subcategory": "fog_ins",
                "sensor_type": "Fiber Optic Gyroscope (FOG)", "ai_fusion": True,
                "accuracy": "sub-0.1% distance", "gnss_denied_capability": True,
                "form_factor": "ruggedized module", "weight_g": 450,
                "compliance": {"allied_nation": True},
                "tags": ["fog", "ai_fusion", "sub_0.1_percent", "gps_denied", "deep_mine_tested"],
            },
            {
                "name": "Advanced Navigation Certus Evo — MEMS INS/GNSS with RTK",
                "description": "High-precision MEMS INS/GNSS with AI fusion, RTK, Auto-Adaptive EKF. Centimeter-level accuracy. Tightly coupled.",
                "link": "https://www.advancednavigation.com/",
                "approx_price": 5000, "subcategory": "ins_gnss",
                "sensor_type": "MEMS + RTK GNSS", "ai_fusion": True,
                "accuracy": "centimeter-level (with RTK)",
                "coupling": "tightly coupled GNSS/INS", "gnss_denied_capability": True,
                "form_factor": "compact ruggedized module", "weight_g": 45,
                "compliance": {"allied_nation": True},
                "tags": ["rtk", "centimeter", "ai_fusion", "ekf", "tightly_coupled", "survey"],
            },
        ],
    },
    "modalai": {
        "name": "ModalAI", "hq": "San Diego, CA, USA", "country": "United States",
        "url": "https://www.modalai.com/",
        "check_urls": ["https://www.modalai.com/pages/vio-drone"],
        "products": [
            {
                "name": "ModalAI VOXL 2 VIO — Visual Inertial Odometry Navigation",
                "description": "GPS-denied navigation via VIO on VOXL 2. Camera + IMU fusion for 3D positioning. SLAM, VOA, ROS 2, Docker. 7 cameras. Blue UAS. 16g. Assembled in USA.",
                "link": "https://www.modalai.com/pages/vio-drone",
                "approx_price": 449, "subcategory": "vio_system",
                "nav_modes": ["VIO", "SLAM", "VOA", "GPS-aided"],
                "processor": "Qualcomm QRB5165", "camera_inputs": 7,
                "weight_g": 16, "power_w": 5, "gnss_denied_capability": True,
                "ros2_support": True, "form_factor": "integrated companion computer",
                "compliance": {"ndaa": True, "blue_uas": True},
                "tags": ["vio", "slam", "voa", "gps_denied", "16g", "blue_uas", "ros2"],
            },
        ],
    },
    "honeywell": {
        "name": "Honeywell Aerospace", "hq": "Charlotte, NC, USA", "country": "United States",
        "url": "https://aerospace.honeywell.com/",
        "check_urls": [],
        "products": [
            {
                "name": "Honeywell HGuide o480 — Low-SWaP INS with Anti-Jam/Anti-Spoof",
                "description": "Low-SWaP INS with integrated anti-jamming and anti-spoofing. Single or dual-antenna GNSS. Assured PNT for contested environments.",
                "link": "https://aerospace.honeywell.com/",
                "approx_price": 12000, "subcategory": "ins_anti_jam",
                "anti_jam": True, "anti_spoof": True,
                "gnss_antenna_options": ["single-antenna", "dual-antenna"],
                "gnss_denied_capability": True, "form_factor": "low-SWaP module", "weight_g": 200,
                "compliance": {"ndaa": True},
                "tags": ["honeywell", "low_swap", "anti_jam", "anti_spoof", "dual_antenna", "assured_pnt"],
            },
        ],
    },
    "infleqtion": {
        "name": "Infleqtion", "hq": "Boulder, CO, USA", "country": "United States",
        "url": "https://www.infleqtion.com/",
        "check_urls": [],
        "products": [
            {
                "name": "Infleqtion Tiqker — Quantum Optical Atomic Clock",
                "description": "Quantum optical clock using rubidium. Loses 1 second per 2 million years. Tested on UK flights, US Army vehicles, drone submarines. DARPA funded.",
                "link": "https://www.infleqtion.com/",
                "approx_price": "Government/defense procurement",
                "subcategory": "quantum_timing", "technology": "Optical atomic clock (rubidium)",
                "accuracy": "1 second per 2 million years", "darpa_funded": True,
                "gnss_denied_capability": True, "form_factor": "rack-mountable",
                "compliance": {"ndaa": True, "darpa": True},
                "tags": ["quantum", "atomic_clock", "pnt", "timing", "rubidium", "gps_denied", "darpa"],
            },
            {
                "name": "Infleqtion Quantum Inertial Sensor — Atom Interferometry IMU",
                "description": "Quantum inertial sensor using atom interferometry. Continuous-beam architecture (tested Oct 2025). Trialed at British military site. DARPA funded.",
                "link": "https://www.infleqtion.com/",
                "approx_price": "Government/defense R&D",
                "subcategory": "quantum_imu", "technology": "Atom interferometry (rubidium)",
                "continuous_beam": True, "darpa_funded": True,
                "gnss_denied_capability": True, "form_factor": "sensor module (development stage)",
                "compliance": {"ndaa": True, "darpa": True},
                "tags": ["quantum", "atom_interferometry", "continuous_nav", "darpa", "next_gen"],
            },
        ],
    },
    "q_ctrl": {
        "name": "Q-CTRL", "hq": "Sydney, Australia", "country": "Australia",
        "url": "https://q-ctrl.com/",
        "check_urls": [],
        "products": [
            {
                "name": "Q-CTRL Ironstone Opal — Quantum Magnetic Navigation",
                "description": "Quantum magnetic navigation using ML to track position via Earth's magnetic anomalies. 94x more accurate than strategic-grade INS. 2 DARPA contracts. Partners: Northrop, Lockheed, Airbus.",
                "link": "https://q-ctrl.com/",
                "approx_price": "Government/defense procurement",
                "subcategory": "quantum_mag_nav", "technology": "Quantum magnetic navigation + ML",
                "accuracy_vs_ins": "94x improvement over strategic-grade INS",
                "darpa_contracts": 2, "partners": ["Northrop Grumman", "Lockheed Martin", "Airbus"],
                "gnss_denied_capability": True, "form_factor": "sensor module + software",
                "compliance": {"darpa": True, "allied_nation": True},
                "tags": ["quantum", "magnetic_navigation", "ml", "gps_free", "darpa", "94x_accuracy"],
            },
        ],
    },
}


def fetch_page(url):
    time.sleep(RATE_LIMIT)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return ''

def load_db():
    with open(DB_PATH) as f: return json.load(f)

def save_db(db):
    with open(DB_PATH, 'w') as f: json.dump(db, f, indent=2, ensure_ascii=False)

def get_next_pid(existing):
    max_num = 0
    for entry in existing:
        pid = entry.get('pid', '')
        if pid.startswith(PID_PREFIX + '-'):
            try: max_num = max(max_num, int(pid.split('-')[1]))
            except (ValueError, IndexError): pass
    return max_num + 1

def build_entries():
    entries = []
    pid_counter = 1
    for mfr_key, mfr in MANUFACTURERS.items():
        for product in mfr['products']:
            entry = {"pid": f"{PID_PREFIX}-{pid_counter:04d}", "category": CATEGORY,
                     "manufacturer": mfr['name'], "manufacturer_hq": mfr['hq'], "country": mfr['country'],
                     **product, "schema_data": {"weight_g": product.get('weight_g')}}
            valid, reason = validate_part(entry)
            if valid: entries.append(entry); pid_counter += 1
            else: print(f"  REJECTED: {product['name']} — {reason}")
    return entries

def mine_navigation_pnt(dry_run=False, diff_only=False):
    print(f"═══ Mining {CATEGORY} ═══\n")
    entries = build_entries()
    valid, rejected = validate_parts_batch(entries)
    print(f"\n  Built {len(valid)} valid entries from {len(MANUFACTURERS)} manufacturers")
    if dry_run:
        for e in valid: print(f"    [{e['pid']}] {e['name']}")
        return
    db = load_db()
    existing = db['components'].get(CATEGORY, [])
    existing_names = {e['name'].lower() for e in existing}
    added = 0; next_pid = get_next_pid(existing)
    for entry in valid:
        if entry['name'].lower() not in existing_names:
            entry['pid'] = f"{PID_PREFIX}-{next_pid:04d}"; existing.append(entry)
            existing_names.add(entry['name'].lower()); next_pid += 1; added += 1
            print(f"  + {entry['pid']}: {entry['name']}")
        else: print(f"  = SKIP (exists): {entry['name']}")
    db['components'][CATEGORY] = existing; save_db(db)
    print(f"\n  ✓ {added} new entries added. Total {CATEGORY}: {len(existing)}")

if __name__ == '__main__':
    mine_navigation_pnt(dry_run='--dry-run' in sys.argv, diff_only='--diff-only' in sys.argv)
