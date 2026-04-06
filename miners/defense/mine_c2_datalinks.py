#!/usr/bin/env python3
"""
mine_c2_datalinks.py — Mine C2 datalink products from manufacturer sources.

Targets command-and-control datalink systems for UAS:
  - Aviation-grade CNPC radios (uAvionix)
  - Tactical MANET radios with C2 capability (Silvus, DTC/Codan)
  - Integrated C2 + video systems (CubePilot Herelink)
  - Military C2 gateways (Ultra I&C ADSI, L3Harris)
  - AI autonomous C2 (Shield AI Hivemind)

Each manufacturer has a curated product config with known specs.
The miner validates new/updated products against the Forge quality gate
and outputs entries ready for merge into forge_database.json.

Run locally — optionally checks manufacturer URLs for changes.

Usage:
    python3 miners/defense/mine_c2_datalinks.py
    python3 miners/defense/mine_c2_datalinks.py --dry-run
    python3 miners/defense/mine_c2_datalinks.py --diff-only
"""

import json
import os
import sys
import time
from datetime import datetime
from urllib.request import urlopen, Request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from validate_entry import validate_part, validate_parts_batch

HEADERS = {"User-Agent": "Forge-Intel-Miner/1.0"}
RATE_LIMIT = 2.0
CATEGORY = "c2_datalinks"
PID_PREFIX = "C2DL"

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                       'DroneClear Components Visualizer', 'forge_database.json')
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), '..', '.snapshots')

# ══════════════════════════════════════════════════
# Manufacturer configs — curated product data
# ══════════════════════════════════════════════════

MANUFACTURERS = {
    "uavionix": {
        "name": "uAvionix",
        "hq": "Big Fork, MT, USA",
        "country": "United States",
        "url": "https://uavionix.com/",
        "check_urls": [
            "https://uavionix.com/product/microlink/",
            "https://uavionix.com/products/skyline/",
        ],
        "products": [
            {
                "name": "uAvionix microLink — Aviation-Grade BVLOS C2 Radio",
                "description": "FCC and IC approved aviation-grade BVLOS C2 datalink radio specifically designed for long-range mission-critical UAS operations. Provides CNPC (Control and Non-Payload Communication) with 2x2 MIMO diversity. Integrates with SkyLine cloud-managed C2 service for multi-aircraft fleet management, path/link diversity, and seamless roaming between ground stations. TSO-C213a compliant. ISM 902-928 MHz band.",
                "link": "https://uavionix.com/product/microlink/",
                "approx_price": "Contact vendor",
                "frequency_band": "902-928 MHz ISM",
                "mimo": "2x2 MIMO",
                "datalink_type": "CNPC (Control and Non-Payload Communication)",
                "c2_standard": "RTCA DO-362A / FAA TSO-C213a",
                "link_diversity": True,
                "path_diversity": True,
                "encryption": "AES-256",
                "fleet_management": "SkyLine Cloud C2 Service",
                "form_factor": "OEM airborne radio",
                "weight_g": 85,
                "compliance": {"ndaa": True, "fcc": True, "ic_canada": True, "tso_c213a": True},
                "tags": ["bvlos", "cnpc", "aviation_grade", "c2", "multi_datalink", "fleet_management", "tso_certified"],
            },
            {
                "name": "uAvionix muLTElink-5060 — Multi-Datalink ARS with LTE & C-Band",
                "description": "Multi-datalink Airborne Radio System (ARS) and Link Executive Manager providing simultaneous CNPC C2 over C-Band (5030-5091 MHz aviation protected spectrum), cellular LTE, and LEO satellite (Starlink compatible). Automatic link switching with 1-second evaluation cadence and double-hysteresis.",
                "link": "https://uavionix.com/products/skyline/",
                "approx_price": "Contact vendor",
                "frequency_band": ["C-Band 5030-5091 MHz", "LTE cellular", "LEO satcom"],
                "mimo": "2x2 LTE MIMO",
                "datalink_type": "Multi-datalink CNPC C2",
                "c2_standard": "RTCA DO-362A",
                "link_switching": "Automatic with 1s cadence, double-hysteresis",
                "supported_links": ["C-Band", "Cellular LTE", "LEO Satellite"],
                "form_factor": "OEM airborne module",
                "compliance": {"ndaa": True, "fcc": True, "caa_uk_sail_4_6": True},
                "tags": ["multi_datalink", "c_band", "lte", "satcom", "starlink", "bvlos", "link_switching", "cnpc"],
            },
        ],
    },
    "silvus": {
        "name": "Silvus Technologies",
        "hq": "Los Angeles, CA, USA",
        "country": "United States",
        "url": "https://silvustechnologies.com/",
        "check_urls": [
            "https://silvustechnologies.com/applications/unmanned-systems/",
        ],
        "products": [
            {
                "name": "Silvus StreamCaster SC4200EP — Tactical MANET C2 Datalink",
                "description": "2x2 MIMO tactical MANET radio delivering best-in-class C2, video, and telemetry in a single transceiver for unmanned systems. Proprietary MN-MIMO waveform provides self-healing, self-forming mesh networking. Battle-proven across defense, law enforcement, and public safety. NDAA and DoD cybersecurity compliant; approved for Blue UAS platforms.",
                "link": "https://silvustechnologies.com/applications/unmanned-systems/",
                "approx_price": "Contact vendor",
                "frequency_band": "Configurable (L-Band through C-Band)",
                "mimo": "2x2 MIMO",
                "datalink_type": "Tactical MANET C2 + Video",
                "mesh_protocol": "MN-MIMO (proprietary)",
                "max_throughput_mbps": 100,
                "encryption": "AES-256, Type 1 optional",
                "self_healing_mesh": True,
                "simultaneous_data": ["video", "C2", "telemetry"],
                "form_factor": "ruggedized enclosure or OEM PCB stack",
                "compliance": {"ndaa": True, "blue_uas": True, "dod_cybersecurity": True, "manufactured_in": "USA"},
                "tags": ["manet", "tactical", "mn_mimo", "battle_proven", "c2", "video_link", "blue_uas", "mesh"],
            },
            {
                "name": "Silvus StreamCaster Lite SL5200 — Ultra-Low SWaP MANET for Group 1 UAS",
                "description": "Ultra-low SWaP OEM module delivering Group 2 UAV-level MANET radio performance in a form factor designed for Group 1 platforms. Powered by Silvus' proprietary MN-MIMO waveform for self-forming, self-healing mesh networking.",
                "link": "https://silvustechnologies.com/applications/unmanned-systems/",
                "approx_price": "Contact vendor",
                "frequency_band": "Configurable",
                "mimo": "2x2 MIMO",
                "datalink_type": "Tactical MANET C2",
                "mesh_protocol": "MN-MIMO (proprietary)",
                "self_healing_mesh": True,
                "form_factor": "ultra-low SWaP OEM module",
                "target_platform": "Group 1 sUAS",
                "compliance": {"ndaa": True, "blue_uas": True},
                "tags": ["ultra_low_swap", "group_1", "oem", "manet", "mn_mimo", "swarm", "relay"],
            },
        ],
    },
    "dtc_codan": {
        "name": "Domo Tactical Communications (DTC / Codan)",
        "hq": "Ashburn, VA, USA",
        "country": "United States",
        "url": "https://domotactical.com/",
        "check_urls": [
            "https://www.defenseadvancement.com/company/dtc-codan/",
        ],
        "products": [
            {
                "name": "DTC BluSDR-90-UL — Ultra-Light Long-Range SDR for UAS",
                "description": "Ultra-light software-defined radio offering long-range mission-critical connectivity with battlefield-proven MeshUltra MANET networking. COFDM IP Mesh waveforms support adaptive modulation up to 64QAM with data rates to 87 Mbps. Frequency coverage 320 MHz to 6 GHz. US Army, DOJ, DHS, and DOD contracts. 250,000+ radios built.",
                "link": "https://domotactical.com/",
                "approx_price": "Contact vendor",
                "frequency_band": "320 MHz - 6 GHz (configurable)",
                "modulation": ["BPSK", "QPSK", "16QAM", "64QAM"],
                "max_throughput_mbps": 87,
                "mesh_protocol": "MeshUltra COFDM IP Mesh",
                "channel_bandwidth_mhz": [1.25, 1.5, 1.75, 2.5, 5, 10, 20],
                "encryption": "AES-256",
                "anti_jamming": True,
                "form_factor": "ultra-light OEM SDR module",
                "compliance": {"ndaa": True, "us_army": True, "doj": True, "dhs": True},
                "tags": ["sdr", "meshultra", "cofdm", "anti_jamming", "87mbps", "ultra_light", "battle_proven"],
            },
            {
                "name": "DTC SOL8SDR-M BluCore — Miniature SDR for Nano/sUAS",
                "description": "Miniature SDR transceiver at 54x50x11mm and 60g for sub-250g nano UAS and swarming drones. MeshUltra MANET with 80+ nodes on same frequency. Self-healing mesh enables swarm and mother/daughter UAS architectures. RF LOS ranges up to 250 km with optimized antenna.",
                "link": "https://domotactical.com/",
                "approx_price": "Contact vendor",
                "frequency_band": "320 MHz - 6 GHz",
                "mesh_protocol": "MeshUltra COFDM",
                "max_nodes": 80,
                "max_range_km": 250,
                "dimensions_mm": "54 x 50 x 11",
                "form_factor": "miniature OEM module",
                "target_platform": "Nano UAS / sub-250g / swarm",
                "weight_g": 60,
                "compliance": {"ndaa": True},
                "tags": ["60g", "nano_uas", "sub_250g", "swarm", "250km", "miniature", "mother_daughter"],
            },
        ],
    },
    "cubepilot": {
        "name": "CubePilot (Hex Technology)",
        "hq": "Xiamen, China",
        "country": "China",
        "url": "https://www.cubepilot.com/",
        "check_urls": [],
        "products": [
            {
                "name": "CubePilot Herelink V1.1 — HD Video + C2 Datalink System",
                "description": "Integrated HD video transmission, data link, and ground control station system for drones. 2.4 GHz ISM band with up to 20 km range (FCC) / 12 km (CE). Dual HDMI inputs supporting 720p/1080p at 30/60fps with minimum 110ms latency. Android-based 5.46-inch 1080P touchscreen controller runs QGroundControl and MissionPlanner natively.",
                "link": "https://www.cubepilot.com/herelink",
                "approx_price": 499,
                "frequency_band": "2.4 GHz ISM",
                "datalink_type": "Integrated C2 + HD Video",
                "max_range_km": {"fcc": 20, "ce": 12},
                "video_resolution": ["720p@30fps", "1080p@30fps", "1080p@60fps"],
                "video_latency_ms": 110,
                "video_inputs": "2x HDMI",
                "processor": "Pinecone S1 (4x A53 @ 2.2GHz + 4x A53 @ 1.4GHz)",
                "display": "5.46-inch 1080P capacitive touchscreen",
                "gcs_software": ["QGroundControl", "MissionPlanner"],
                "autopilot_compatibility": ["ArduPilot", "PX4"],
                "encryption": "AES encrypted",
                "form_factor": "handheld controller + air unit",
                "weight_g": 750,
                "compliance": {"ndaa": False, "fcc": True, "ce": True, "srrc": True},
                "tags": ["hd_video", "integrated_gcs", "android", "qgroundcontrol", "ardupilot", "px4", "2.4ghz"],
            },
        ],
    },
}


def fetch_page(url):
    """Fetch a web page for diff checking."""
    time.sleep(RATE_LIMIT)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return ''


def load_db():
    """Load current forge_database.json."""
    with open(DB_PATH) as f:
        return json.load(f)


def save_db(db):
    """Save forge_database.json."""
    with open(DB_PATH, 'w') as f:
        json.dump(db, f, indent=2, ensure_ascii=False)


def get_next_pid(existing):
    """Get next PID number for the category."""
    max_num = 0
    for entry in existing:
        pid = entry.get('pid', '')
        if pid.startswith(PID_PREFIX + '-'):
            try:
                num = int(pid.split('-')[1])
                if num > max_num:
                    max_num = num
            except (ValueError, IndexError):
                pass
    return max_num + 1


def build_entries():
    """Build validated entries from manufacturer configs."""
    entries = []
    pid_counter = 1

    for mfr_key, mfr in MANUFACTURERS.items():
        for product in mfr['products']:
            entry = {
                "pid": f"{PID_PREFIX}-{pid_counter:04d}",
                "category": CATEGORY,
                "manufacturer": mfr['name'],
                "manufacturer_hq": mfr['hq'],
                "country": mfr['country'],
                **product,
                "schema_data": {"weight_g": product.get('weight_g', None)},
            }
            # Remove weight_g from top level if in schema_data
            if 'weight_g' in entry and entry.get('schema_data', {}).get('weight_g'):
                pass  # keep both for backward compat

            valid, reason = validate_part(entry)
            if valid:
                entries.append(entry)
                pid_counter += 1
            else:
                print(f"  REJECTED: {product['name']} — {reason}")

    return entries


def check_for_updates():
    """Check manufacturer URLs for page changes (basic change detection)."""
    print("\nChecking manufacturer pages for updates...")
    for mfr_key, mfr in MANUFACTURERS.items():
        for url in mfr.get('check_urls', []):
            html = fetch_page(url)
            if html:
                # Simple size-based change detection
                snap_path = os.path.join(SNAPSHOT_DIR, f'c2dl_{mfr_key}.size')
                os.makedirs(SNAPSHOT_DIR, exist_ok=True)
                new_size = len(html)
                if os.path.exists(snap_path):
                    with open(snap_path) as f:
                        old_size = int(f.read().strip())
                    diff_pct = abs(new_size - old_size) / max(old_size, 1) * 100
                    if diff_pct > 10:
                        print(f"  ⚠ {mfr['name']}: page changed by {diff_pct:.1f}% — review for new products")
                    else:
                        print(f"  ✓ {mfr['name']}: no significant changes")
                else:
                    print(f"  ● {mfr['name']}: first snapshot saved")
                with open(snap_path, 'w') as f:
                    f.write(str(new_size))


def mine_c2_datalinks(dry_run=False, diff_only=False):
    """Run the C2 datalinks mining pipeline."""
    print(f"═══ Mining {CATEGORY} ═══\n")

    entries = build_entries()
    valid, rejected = validate_parts_batch(entries)

    print(f"\n  Built {len(valid)} valid entries from {len(MANUFACTURERS)} manufacturers")
    if rejected:
        print(f"  Rejected {len(rejected)} entries:")
        for entry, reason in rejected:
            print(f"    {entry.get('name', '?')}: {reason}")

    if diff_only:
        check_for_updates()
        return

    if dry_run:
        print("\n  DRY RUN — would add these entries:")
        for e in valid:
            print(f"    [{e['pid']}] {e['name']} ({e['manufacturer']})")
        return

    # Merge into DB
    db = load_db()
    existing = db['components'].get(CATEGORY, [])
    existing_names = {e['name'].lower() for e in existing}

    added = 0
    next_pid = get_next_pid(existing)
    for entry in valid:
        if entry['name'].lower() not in existing_names:
            entry['pid'] = f"{PID_PREFIX}-{next_pid:04d}"
            existing.append(entry)
            existing_names.add(entry['name'].lower())
            next_pid += 1
            added += 1
            print(f"  + {entry['pid']}: {entry['name']}")
        else:
            print(f"  = SKIP (exists): {entry['name']}")

    db['components'][CATEGORY] = existing
    save_db(db)
    print(f"\n  ✓ {added} new entries added. Total {CATEGORY}: {len(existing)}")


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    diff_only = '--diff-only' in sys.argv
    mine_c2_datalinks(dry_run=dry_run, diff_only=diff_only)
