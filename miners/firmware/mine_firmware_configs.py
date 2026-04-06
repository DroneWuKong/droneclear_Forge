#!/usr/bin/env python3
"""
mine_firmware_configs.py — Firmware Target Config Miner for Forge/Wingman RAG

Mines target/board definitions from four open-source flight controller firmware repos:
  - Betaflight  (config.h from betaflight/config)
  - iNav        (target.h + config.c from iNavFlight/inav)
  - ArduPilot   (hwdef.dat + defaults.parm from ArduPilot/ardupilot)
  - PX4         (airframe init.d scripts from PX4/PX4-Autopilot)

Output: forge_firmware_configs.json — structured records ready for Wingman RAG injection.

Usage:
    python3 mine_firmware_configs.py                    # mine all four
    python3 mine_firmware_configs.py --firmware bf       # betaflight only
    python3 mine_firmware_configs.py --firmware inav     # inav only
    python3 mine_firmware_configs.py --firmware ardupilot
    python3 mine_firmware_configs.py --firmware px4
    python3 mine_firmware_configs.py --stats             # print summary stats
    python3 mine_firmware_configs.py --match "SpeedyBee" # search across all firmwares

Requires: requests, git (for shallow clones)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
WORK_DIR = Path("/tmp/firmware_miner")
OUTPUT_FILE = "forge_firmware_configs.json"

REPOS = {
    "betaflight_config": {
        "url": "https://github.com/betaflight/config.git",
        "branch": "master",
        "firmware": "betaflight",
    },
    "betaflight_unified": {
        "url": "https://github.com/betaflight/unified-targets.git",
        "branch": "master",
        "firmware": "betaflight",
    },
    "inav": {
        "url": "https://github.com/iNavFlight/inav.git",
        "branch": "master",
        "firmware": "inav",
    },
    "ardupilot": {
        "url": "https://github.com/ArduPilot/ardupilot.git",
        "branch": "master",
        "firmware": "ardupilot",
    },
    "px4": {
        "url": "https://github.com/PX4/PX4-Autopilot.git",
        "branch": "main",
        "firmware": "px4",
    },
}

# MCU family classification
MCU_FAMILIES = {
    "STM32F405": "F4", "STM32F411": "F4", "STM32F446": "F4",
    "STM32F722": "F7", "STM32F745": "F7", "STM32F746": "F7", "STM32F765": "F7",
    "STM32H723": "H7", "STM32H730": "H7", "STM32H743": "H7", "STM32H750": "H7", "STM32H755": "H7",
    "STM32G473": "G4", "STM32G474": "G4",
    "AT32F435": "AT32",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd, cwd=None, check=True):
    """Run shell command, return stdout."""
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    if check and r.returncode != 0:
        print(f"  ⚠ Command failed: {cmd}")
        print(f"    stderr: {r.stderr[:300]}")
        return ""
    return r.stdout.strip()


def shallow_clone(name, repo_info):
    """Sparse/shallow clone only the dirs we need."""
    dest = WORK_DIR / name
    if dest.exists():
        print(f"  ♻ {name} already cloned, reusing")
        return dest

    url = repo_info["url"]
    branch = repo_info["branch"]

    print(f"  ⬇ Cloning {name} (shallow, {branch})...")

    # For large repos, use sparse checkout to only grab what we need
    if name == "ardupilot":
        run(f"git clone --depth 1 --filter=blob:none --sparse -b {branch} {url} {dest}")
        run("git sparse-checkout set libraries/AP_HAL_ChibiOS/hwdef", cwd=dest)
    elif name == "px4":
        run(f"git clone --depth 1 --filter=blob:none --sparse -b {branch} {url} {dest}")
        run("git sparse-checkout set ROMFS/px4fmu_common/init.d", cwd=dest)
    elif name == "inav":
        run(f"git clone --depth 1 --filter=blob:none --sparse -b {branch} {url} {dest}")
        run("git sparse-checkout set src/main/target", cwd=dest)
    else:
        # Betaflight config/unified-targets are small enough for full shallow clone
        run(f"git clone --depth 1 -b {branch} {url} {dest}")

    return dest


def classify_mcu(mcu_string):
    """Return MCU family from a raw MCU string."""
    if not mcu_string:
        return "unknown"
    mcu_upper = mcu_string.upper()
    for prefix, family in MCU_FAMILIES.items():
        if prefix.upper() in mcu_upper:
            return family
    if "AT32" in mcu_upper:
        return "AT32"
    if "STM32F4" in mcu_upper:
        return "F4"
    if "STM32F7" in mcu_upper:
        return "F7"
    if "STM32H7" in mcu_upper:
        return "H7"
    if "STM32G4" in mcu_upper:
        return "G4"
    return "unknown"


def extract_uarts_from_text(text):
    """Count UARTs mentioned in config text."""
    # Look for UART/USART definitions
    uart_refs = set()
    for m in re.finditer(r'(?:USART|UART|SERIAL_PORT_USART)(\d+)', text, re.IGNORECASE):
        uart_refs.add(int(m.group(1)))
    # Also catch serial_rx, serial resource lines
    for m in re.finditer(r'serial\s+(\d+)', text, re.IGNORECASE):
        uart_refs.add(int(m.group(1)))
    return len(uart_refs) if uart_refs else 0


def extract_gyros_from_text(text):
    """Extract gyro/IMU chip names."""
    gyros = set()
    patterns = [
        r'(ICM[-_]?\d{5}[A-Z]*)',
        r'(MPU\d{4}[A-Z]*)',
        r'(BMI\d{3}[A-Z]*)',
        r'(LSM6\w+)',
        r'(BMI270)',
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            gyros.add(m.group(1).upper().replace("_", "-"))
    return sorted(gyros)


def extract_osd_from_text(text):
    """Detect OSD chip."""
    text_upper = text.upper()
    if "MAX7456" in text_upper or "AT7456" in text_upper:
        return "MAX7456"
    if "OSD" in text_upper:
        return "yes"
    return None


# ---------------------------------------------------------------------------
# Betaflight config.h parser (new-style targets)
# ---------------------------------------------------------------------------
def parse_betaflight_config(repo_path):
    """Parse betaflight/config repo — config.h files."""
    configs_dir = repo_path / "configs"
    if not configs_dir.exists():
        # Try root level
        configs_dir = repo_path
    
    results = []
    config_files = list(repo_path.rglob("config.h"))
    print(f"    Found {len(config_files)} config.h files")
    
    for cf in config_files:
        text = cf.read_text(errors="replace")
        target_name = cf.parent.name

        # Extract MCU from #define or directory hints
        mcu = ""
        m = re.search(r'#define\s+TARGET_BOARD_IDENTIFIER\s+"([^"]+)"', text)
        board_id = m.group(1) if m else ""

        # MCU from the define or path
        m = re.search(r'(STM32[A-Z]\d{3}\w*)', text, re.IGNORECASE)
        if m:
            mcu = m.group(1)
        elif "F405" in target_name.upper():
            mcu = "STM32F405"
        elif "F722" in target_name.upper():
            mcu = "STM32F722"
        elif "H743" in target_name.upper():
            mcu = "STM32H743"

        # Extract manufacturer from path or define
        manufacturer = ""
        m = re.search(r'#define\s+MANUFACTURER_ID\s+"([^"]+)"', text)
        if m:
            manufacturer = m.group(1)

        # UARTs
        uart_count = extract_uarts_from_text(text)

        # Gyros
        gyros = extract_gyros_from_text(text)

        # OSD
        osd = extract_osd_from_text(text)

        # Motor protocol hints
        motor_protocols = []
        if re.search(r'DSHOT', text, re.IGNORECASE):
            motor_protocols.append("DSHOT")
        if re.search(r'MOTOR_PROTOCOL\s+.*DSHOT600', text, re.IGNORECASE):
            motor_protocols.append("DSHOT600")

        # Betaflight target name
        bf_target = ""
        m = re.search(r'#define\s+FC_TARGET_MCU\s+(\S+)', text)
        if m:
            bf_target = m.group(1)

        results.append({
            "target_name": target_name,
            "firmware": "betaflight",
            "source": "config",
            "mcu": mcu,
            "mcu_family": classify_mcu(mcu),
            "board_id": board_id,
            "manufacturer_id": manufacturer,
            "bf_target": bf_target or target_name,
            "uart_count": uart_count,
            "gyros": gyros,
            "osd": osd,
            "motor_protocols": motor_protocols,
            "file_path": str(cf.relative_to(repo_path)),
            "raw_snippet": text[:2000],  # first 2k chars for RAG
        })

    return results


# ---------------------------------------------------------------------------
# Betaflight unified-targets parser (legacy .config files)
# ---------------------------------------------------------------------------
def parse_betaflight_unified(repo_path):
    """Parse betaflight/unified-targets — .config files."""
    configs_dir = repo_path / "configs" / "default"
    if not configs_dir.exists():
        print("    ⚠ No configs/default directory found")
        return []

    results = []
    config_files = list(configs_dir.glob("*.config"))
    print(f"    Found {len(config_files)} unified .config files")

    for cf in config_files:
        text = cf.read_text(errors="replace")
        target_name = cf.stem  # e.g. SPBE-SPEEDYBEEF405V4

        # Parse the header comment: # Betaflight / STM32F405 (S405) 4.3.2 ...
        mcu = ""
        bf_version = ""
        m = re.search(r'#\s*Betaflight\s*/\s*(\S+)\s*\((\S+)\)\s*([\d.]+)', text)
        if m:
            mcu = m.group(1)
            bf_version = m.group(3)

        # Board name
        board_name = ""
        m = re.search(r'^board_name\s+(\S+)', text, re.MULTILINE)
        if m:
            board_name = m.group(1)

        # Manufacturer
        manufacturer = ""
        m = re.search(r'^manufacturer_id\s+(\S+)', text, re.MULTILINE)
        if m:
            manufacturer = m.group(1)

        # Count serial (resource serial_tx/rx)
        uart_refs = set()
        for m2 in re.finditer(r'resource\s+SERIAL_(?:TX|RX)\s+(\d+)', text, re.IGNORECASE):
            uart_refs.add(int(m2.group(1)))
        uart_count = len(uart_refs)

        # Timer/DMA resource lines (useful for troubleshooting)
        timer_lines = [l.strip() for l in text.splitlines() if l.strip().startswith("timer ")]
        dma_lines = [l.strip() for l in text.splitlines() if l.strip().startswith("dma ")]

        gyros = extract_gyros_from_text(text)
        osd = extract_osd_from_text(text)

        results.append({
            "target_name": target_name,
            "firmware": "betaflight",
            "source": "unified-targets",
            "mcu": mcu,
            "mcu_family": classify_mcu(mcu),
            "board_name": board_name,
            "manufacturer_id": manufacturer,
            "bf_version": bf_version,
            "bf_target": board_name or target_name,
            "uart_count": uart_count,
            "gyros": gyros,
            "osd": osd,
            "timer_count": len(timer_lines),
            "dma_count": len(dma_lines),
            "file_path": str(cf.relative_to(repo_path)),
            "raw_snippet": text[:2000],
        })

    return results


# ---------------------------------------------------------------------------
# iNav target parser
# ---------------------------------------------------------------------------
def parse_inav_targets(repo_path):
    """Parse iNavFlight/inav — target.h + config.c per board."""
    target_dir = repo_path / "src" / "main" / "target"
    if not target_dir.exists():
        print("    ⚠ No src/main/target directory found")
        return []

    results = []
    target_dirs = [d for d in target_dir.iterdir() if d.is_dir() and not d.name.startswith((".", "common"))]
    print(f"    Found {len(target_dirs)} iNav target directories")

    for td in target_dirs:
        target_name = td.name
        target_h = td / "target.h"
        config_c = td / "config.c"
        cmake = td / "CMakeLists.txt"

        if not target_h.exists():
            continue

        text_h = target_h.read_text(errors="replace")
        text_c = config_c.read_text(errors="replace") if config_c.exists() else ""
        text_cmake = cmake.read_text(errors="replace") if cmake.exists() else ""
        combined = text_h + "\n" + text_c

        # MCU from CMakeLists.txt or target.h
        mcu = ""
        m = re.search(r'(STM32[A-Z]\d{3}\w*)', text_cmake + text_h, re.IGNORECASE)
        if m:
            mcu = m.group(1)

        # AT32 check
        if not mcu:
            m = re.search(r'(AT32F\d{3}\w*)', text_cmake + text_h, re.IGNORECASE)
            if m:
                mcu = m.group(1)

        # UARTs
        uart_count = 0
        # Count USE_UARTx defines
        uart_defines = set()
        for m2 in re.finditer(r'#define\s+USE_(?:UART|VCP)(\d+)', text_h, re.IGNORECASE):
            uart_defines.add(int(m2.group(1)))
        # Also count SERIAL_PORT_USARTx
        for m2 in re.finditer(r'SERIAL_PORT_USART(\d+)', text_h, re.IGNORECASE):
            uart_defines.add(int(m2.group(1)))
        uart_count = len(uart_defines)
        # Check for VCP (USB)
        has_vcp = "USE_VCP" in text_h

        # Features
        features = []
        if re.search(r'USE_GPS', text_h):
            features.append("GPS")
        if re.search(r'USE_BARO', text_h):
            features.append("BARO")
        if re.search(r'USE_MAG', text_h):
            features.append("MAG")
        if re.search(r'USE_RANGEFINDER', text_h):
            features.append("RANGEFINDER")
        if re.search(r'USE_PITOT', text_h):
            features.append("PITOT")
        if re.search(r'USE_OPFLOW', text_h) or re.search(r'USE_OPTICAL_FLOW', text_h):
            features.append("OPTICAL_FLOW")

        # Default mixer from config.c
        default_mixer = ""
        m = re.search(r'mixerConfigMutable.*->.*platformType\s*=\s*PLATFORM_(\w+)', text_c)
        if m:
            default_mixer = m.group(1).lower()

        gyros = extract_gyros_from_text(combined)
        osd = extract_osd_from_text(combined)

        # PWM output count
        pwm_count = len(re.findall(r'DEF_TIM\s*\(', text_h))

        results.append({
            "target_name": target_name,
            "firmware": "inav",
            "mcu": mcu,
            "mcu_family": classify_mcu(mcu),
            "uart_count": uart_count,
            "has_vcp": has_vcp,
            "gyros": gyros,
            "osd": osd,
            "features": features,
            "default_platform": default_mixer,
            "pwm_outputs": pwm_count,
            "file_path": str(target_h.relative_to(repo_path)),
            "raw_snippet": (text_h[:1500] + "\n---config.c---\n" + text_c[:500]),
        })

    return results


# ---------------------------------------------------------------------------
# ArduPilot hwdef parser
# ---------------------------------------------------------------------------
def parse_ardupilot_hwdefs(repo_path):
    """Parse ArduPilot/ardupilot — hwdef.dat files."""
    hwdef_base = repo_path / "libraries" / "AP_HAL_ChibiOS" / "hwdef"
    if not hwdef_base.exists():
        print("    ⚠ No hwdef directory found")
        return []

    results = []
    hwdef_dirs = [d for d in hwdef_base.iterdir()
                  if d.is_dir()
                  and not d.name.startswith((".", "common", "scripts", "include"))]
    print(f"    Found {len(hwdef_dirs)} ArduPilot hwdef directories")

    for hd in hwdef_dirs:
        hwdef_file = hd / "hwdef.dat"
        defaults_file = hd / "defaults.parm"

        if not hwdef_file.exists():
            continue

        text = hwdef_file.read_text(errors="replace")
        defaults_text = defaults_file.read_text(errors="replace") if defaults_file.exists() else ""
        board_name = hd.name

        # MCU
        mcu = ""
        m = re.search(r'^MCU\s+(\S+)\s+(\S+)', text, re.MULTILINE)
        if m:
            mcu = m.group(2)  # e.g. STM32F405xx

        # Board ID
        board_id = ""
        m = re.search(r'^APJ_BOARD_ID\s+(\d+)', text, re.MULTILINE)
        if m:
            board_id = m.group(1)

        # Flash size
        flash_kb = ""
        m = re.search(r'^FLASH_SIZE_KB\s+(\d+)', text, re.MULTILINE)
        if m:
            flash_kb = int(m.group(1))

        # Serial order (maps UART assignments)
        serial_order = ""
        m = re.search(r'^SERIAL_ORDER\s+(.+)', text, re.MULTILINE)
        if m:
            serial_order = m.group(1).strip()
            uart_count = len([s for s in serial_order.split() if s != "EMPTY"])
        else:
            uart_count = 0

        # I2C
        i2c_order = ""
        m = re.search(r'^I2C_ORDER\s+(.+)', text, re.MULTILINE)
        if m:
            i2c_order = m.group(1).strip()

        # USB info
        usb_manufacturer = ""
        m = re.search(r'^USB_STRING_MANUFACTURER\s+"([^"]+)"', text, re.MULTILINE)
        if m:
            usb_manufacturer = m.group(1)

        # Inherits from another board?
        includes = []
        for m2 in re.finditer(r'^include\s+(\S+)', text, re.MULTILINE):
            includes.append(m2.group(1))

        # Features from defines
        features = []
        if re.search(r'HAL_WITH_ESC_TELEM', text):
            features.append("ESC_TELEM")
        if re.search(r'AP_BARO_BACKEND', text) or re.search(r'BARO', text):
            features.append("BARO")
        if re.search(r'COMPASS', text) or re.search(r'AP_COMPASS', text):
            features.append("MAG")
        if re.search(r'CAN[12]', text):
            features.append("CAN")

        gyros = extract_gyros_from_text(text)
        osd = extract_osd_from_text(text)

        results.append({
            "target_name": board_name,
            "firmware": "ardupilot",
            "mcu": mcu,
            "mcu_family": classify_mcu(mcu),
            "apj_board_id": board_id,
            "flash_kb": flash_kb,
            "uart_count": uart_count,
            "serial_order": serial_order,
            "i2c_order": i2c_order,
            "usb_manufacturer": usb_manufacturer,
            "gyros": gyros,
            "osd": osd,
            "features": features,
            "includes": includes,
            "has_defaults_parm": defaults_file.exists(),
            "file_path": str(hwdef_file.relative_to(repo_path)),
            "raw_snippet": text[:2000],
            "defaults_snippet": defaults_text[:500] if defaults_text else "",
        })

    return results


# ---------------------------------------------------------------------------
# PX4 airframe parser
# ---------------------------------------------------------------------------
def parse_px4_airframes(repo_path):
    """Parse PX4/PX4-Autopilot — airframe init scripts."""
    airframes_dir = repo_path / "ROMFS" / "px4fmu_common" / "init.d" / "airframes"
    if not airframes_dir.exists():
        print("    ⚠ No airframes directory found")
        return []

    results = []
    airframe_files = [f for f in airframes_dir.iterdir() if f.is_file() and not f.name.startswith(".")]
    print(f"    Found {len(airframe_files)} PX4 airframe files")

    for af in airframe_files:
        text = af.read_text(errors="replace")
        filename = af.name

        # Parse autostart ID from filename (e.g. 4001_quad_x)
        autostart_id = ""
        m = re.match(r'^(\d+)_(.+)', filename)
        if m:
            autostart_id = m.group(1)
            frame_slug = m.group(2)
        else:
            frame_slug = filename

        # Parse @name, @type, @class from comments
        name = ""
        m = re.search(r'@name\s+(.+)', text)
        if m:
            name = m.group(1).strip()

        frame_type = ""
        m = re.search(r'@type\s+(.+)', text)
        if m:
            frame_type = m.group(1).strip()

        frame_class = ""
        m = re.search(r'@class\s+(.+)', text)
        if m:
            frame_class = m.group(1).strip()

        maintainer = ""
        m = re.search(r'@maintainer\s+(.+)', text)
        if m:
            maintainer = m.group(1).strip()

        # Motor/servo outputs from @output comments
        outputs = []
        for m2 in re.finditer(r'@output\s+(\S+)\s+(.+)', text):
            outputs.append({"channel": m2.group(1), "function": m2.group(2).strip()})

        # Excluded boards
        excluded_boards = []
        for m2 in re.finditer(r'@board\s+(\S+)\s+exclude', text):
            excluded_boards.append(m2.group(1))

        # Extract default params
        params = {}
        for m2 in re.finditer(r'param\s+set-default\s+(\S+)\s+(\S+)', text):
            params[m2.group(1)] = m2.group(2)

        # Rotor count from CA_ROTOR_COUNT
        rotor_count = int(params.get("CA_ROTOR_COUNT", 0))

        results.append({
            "target_name": name or frame_slug,
            "firmware": "px4",
            "autostart_id": autostart_id,
            "filename": filename,
            "frame_type": frame_type,
            "frame_class": frame_class,
            "maintainer": maintainer,
            "rotor_count": rotor_count,
            "outputs": outputs,
            "excluded_boards": excluded_boards,
            "default_params": params,
            "file_path": str(af.relative_to(repo_path)),
            "raw_snippet": text[:2000],
        })

    return results


# ---------------------------------------------------------------------------
# Cross-reference: match firmware targets to Forge parts DB
# ---------------------------------------------------------------------------
def cross_reference_forge(configs, forge_db_path=None):
    """Try to match firmware targets to existing Forge FC/ESC parts."""
    if not forge_db_path or not os.path.exists(forge_db_path):
        return configs

    with open(forge_db_path) as f:
        forge_data = json.load(f)

    # Build a lookup of FC names
    fc_parts = {}
    for part in forge_data:
        if part.get("category") in ("Flight Controllers", "ESCs", "All-in-One"):
            name_lower = part.get("name", "").lower()
            fc_parts[name_lower] = part.get("pid", "")

    matched = 0
    for cfg in configs:
        target_lower = cfg["target_name"].lower().replace("-", " ").replace("_", " ")
        for fc_name, pid in fc_parts.items():
            # Fuzzy substring match
            if (target_lower in fc_name or fc_name in target_lower or
                any(word in fc_name for word in target_lower.split() if len(word) > 4)):
                cfg["forge_pid"] = pid
                cfg["forge_match"] = fc_name
                matched += 1
                break

    print(f"  🔗 Cross-referenced: {matched}/{len(configs)} targets matched to Forge parts")
    return configs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Mine firmware target configs for Wingman RAG")
    parser.add_argument("--firmware", "-f", choices=["bf", "inav", "ardupilot", "px4", "all"],
                        default="all", help="Which firmware(s) to mine")
    parser.add_argument("--output", "-o", default=OUTPUT_FILE, help="Output JSON path")
    parser.add_argument("--forge-db", default=None, help="Path to forge_database.json for cross-referencing")
    parser.add_argument("--stats", action="store_true", help="Print stats from existing output file")
    parser.add_argument("--match", "-m", default=None, help="Search for a target name across all firmwares")
    parser.add_argument("--clean", action="store_true", help="Remove cached repo clones")
    parser.add_argument("--no-clone", action="store_true", help="Skip cloning, use existing clones only")
    args = parser.parse_args()

    # Stats mode
    if args.stats:
        if not os.path.exists(args.output):
            print(f"❌ {args.output} not found. Run the miner first.")
            sys.exit(1)
        with open(args.output) as f:
            data = json.load(f)
        print_stats(data)
        return

    # Search mode
    if args.match:
        if not os.path.exists(args.output):
            print(f"❌ {args.output} not found. Run the miner first.")
            sys.exit(1)
        with open(args.output) as f:
            data = json.load(f)
        search_targets(data, args.match)
        return

    # Clean mode
    if args.clean:
        if WORK_DIR.exists():
            shutil.rmtree(WORK_DIR)
            print("🧹 Cleaned cached repos")
        return

    # Mine
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    all_configs = []
    firmware_filter = args.firmware

    print("=" * 60)
    print("🔧 FIRMWARE CONFIG MINER — Forge/Wingman RAG")
    print(f"   Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # --- Betaflight ---
    if firmware_filter in ("bf", "all"):
        print("\n📦 BETAFLIGHT (config.h — new targets)")
        if not args.no_clone:
            repo = shallow_clone("betaflight_config", REPOS["betaflight_config"])
        else:
            repo = WORK_DIR / "betaflight_config"
        if repo.exists():
            bf_new = parse_betaflight_config(repo)
            all_configs.extend(bf_new)
            print(f"    ✅ {len(bf_new)} new-style Betaflight targets")

        print("\n📦 BETAFLIGHT (unified-targets — legacy)")
        if not args.no_clone:
            repo = shallow_clone("betaflight_unified", REPOS["betaflight_unified"])
        else:
            repo = WORK_DIR / "betaflight_unified"
        if repo.exists():
            bf_legacy = parse_betaflight_unified(repo)
            all_configs.extend(bf_legacy)
            print(f"    ✅ {len(bf_legacy)} legacy unified Betaflight targets")

    # --- iNav ---
    if firmware_filter in ("inav", "all"):
        print("\n📦 INAV")
        if not args.no_clone:
            repo = shallow_clone("inav", REPOS["inav"])
        else:
            repo = WORK_DIR / "inav"
        if repo.exists():
            inav_targets = parse_inav_targets(repo)
            all_configs.extend(inav_targets)
            print(f"    ✅ {len(inav_targets)} iNav targets")

    # --- ArduPilot ---
    if firmware_filter in ("ardupilot", "all"):
        print("\n📦 ARDUPILOT")
        if not args.no_clone:
            repo = shallow_clone("ardupilot", REPOS["ardupilot"])
        else:
            repo = WORK_DIR / "ardupilot"
        if repo.exists():
            ap_targets = parse_ardupilot_hwdefs(repo)
            all_configs.extend(ap_targets)
            print(f"    ✅ {len(ap_targets)} ArduPilot board definitions")

    # --- PX4 ---
    if firmware_filter in ("px4", "all"):
        print("\n📦 PX4")
        if not args.no_clone:
            repo = shallow_clone("px4", REPOS["px4"])
        else:
            repo = WORK_DIR / "px4"
        if repo.exists():
            px4_frames = parse_px4_airframes(repo)
            all_configs.extend(px4_frames)
            print(f"    ✅ {len(px4_frames)} PX4 airframe configs")

    # Cross-reference
    if args.forge_db:
        all_configs = cross_reference_forge(all_configs, args.forge_db)

    # Add metadata
    output = {
        "meta": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "miner": "mine_firmware_configs.py",
            "total_targets": len(all_configs),
            "sources": {
                "betaflight": len([c for c in all_configs if c["firmware"] == "betaflight"]),
                "inav": len([c for c in all_configs if c["firmware"] == "inav"]),
                "ardupilot": len([c for c in all_configs if c["firmware"] == "ardupilot"]),
                "px4": len([c for c in all_configs if c["firmware"] == "px4"]),
            }
        },
        "targets": all_configs
    }

    # Write
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\n{'=' * 60}")
    print(f"💾 Wrote {len(all_configs)} targets to {args.output}")
    size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"   File size: {size_mb:.1f} MB")
    print_stats(output)


def print_stats(data):
    """Print summary stats from mined data."""
    targets = data.get("targets", [])
    meta = data.get("meta", {})

    print(f"\n📊 FIRMWARE CONFIG STATS")
    print(f"   Generated: {meta.get('generated', 'unknown')}")
    print(f"   Total targets: {len(targets)}")

    # By firmware
    by_fw = {}
    for t in targets:
        fw = t.get("firmware", "unknown")
        by_fw[fw] = by_fw.get(fw, 0) + 1
    print(f"\n   By firmware:")
    for fw, count in sorted(by_fw.items()):
        print(f"     {fw:12s} {count:>5}")

    # By MCU family
    by_mcu = {}
    for t in targets:
        fam = t.get("mcu_family", "unknown")
        if fam:
            by_mcu[fam] = by_mcu.get(fam, 0) + 1
    if by_mcu:
        print(f"\n   By MCU family:")
        for fam, count in sorted(by_mcu.items(), key=lambda x: -x[1]):
            print(f"     {fam:12s} {count:>5}")

    # Forge cross-ref
    matched = len([t for t in targets if t.get("forge_pid")])
    if matched:
        print(f"\n   🔗 Forge cross-references: {matched}")


def search_targets(data, query):
    """Search for targets matching a query string."""
    targets = data.get("targets", [])
    query_lower = query.lower()
    matches = []

    for t in targets:
        searchable = json.dumps(t, default=str).lower()
        if query_lower in searchable:
            matches.append(t)

    if not matches:
        print(f"❌ No targets found matching '{query}'")
        return

    print(f"🔍 Found {len(matches)} targets matching '{query}':\n")
    for t in matches[:25]:
        fw = t.get("firmware", "?")
        name = t.get("target_name", "?")
        mcu = t.get("mcu", "?")
        fam = t.get("mcu_family", "")
        uarts = t.get("uart_count", "?")
        gyros = ", ".join(t.get("gyros", [])) or "?"
        forge = t.get("forge_pid", "")
        forge_str = f" → Forge:{forge}" if forge else ""
        print(f"  [{fw:10s}] {name:35s}  MCU:{mcu:15s} ({fam})  UARTs:{uarts}  Gyros:{gyros}{forge_str}")

    if len(matches) > 25:
        print(f"\n  ... and {len(matches) - 25} more")


if __name__ == "__main__":
    main()
