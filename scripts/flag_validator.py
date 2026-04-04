#!/usr/bin/env python3
"""
flag_validator.py — Cross-references PIE flags against live Forge DB

Every flag that mentions a chip, vendor, country, or material gets
validated against the actual parts database. Injects real exposure
counts so nothing slips through with stale or understated numbers.

Runs as:
  python3 scripts/flag_validator.py                    # validate + rewrite
  python3 scripts/flag_validator.py --dry-run           # report only
  python3 scripts/flag_validator.py --ci                # exit 1 if gaps found

Designed to run in GitHub Actions after any flag or DB update.

"It just runs programs." — Number 5, Short Circuit
"""

import json
import re
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).resolve().parents[1]
BASE = REPO_ROOT / "DroneClear Components Visualizer"
FLAGS_PATH = BASE / "pie_flags.json"
DB_PATH = BASE / "forge_database.json"
REPORT_DIR = REPO_ROOT / ".analytics_output"

# ══════════════════════════════════════════════════════════════
# CHIP FAMILIES — keyword triggers → DB scan rules
# ══════════════════════════════════════════════════════════════

CHIP_FAMILIES = {
    "STM32H7":   {"triggers": ["stm32h7","h743","h723","h730","h750","h755"], "field":"mcu_family", "match":["H7"], "cats":["flight_controllers"]},
    "STM32F7":   {"triggers": ["stm32f7","f722","f745","f765"], "field":"mcu_family", "match":["F7"], "cats":["flight_controllers"]},
    "STM32F4":   {"triggers": ["stm32f4","f405","f411","f446"], "field":"mcu_family", "match":["F4"], "cats":["flight_controllers"]},
    "STM32G4":   {"triggers": ["stm32g4","g473","g431"], "field":"mcu_family", "match":["G4"], "cats":["flight_controllers"]},
    "STM32-all": {"triggers": ["stm32","stmicroelectronics"], "field":"mcu_family", "match":["H7","F7","F4","G4","F3"], "cats":["flight_controllers"]},
    "AT32":      {"triggers": ["at32","artery"], "fulltext":["at32","artery"], "cats":["flight_controllers","escs"]},
    "GD32":      {"triggers": ["gd32","gigadevice"], "fulltext":["gd32","gigadevice"], "cats":["flight_controllers","escs"]},
    "EFM8":      {"triggers": ["efm8","silicon labs","blheli_s"], "fulltext":["efm8","blheli_s"], "cats":["escs"]},
    "SX12xx":    {"triggers": ["sx1280","sx1281","sx1276","sx1278","sx1272","lr1121","semtech","lora"], "fulltext":["semtech","sx128","sx127","lora","elrs","expresslrs","crossfire","ghost"], "cats":["receivers","control_link_tx"]},
    "RTC6705":   {"triggers": ["rtc6705","richwave"], "fulltext":["rtc6705","richwave"], "cats":["video_transmitters"]},
    "u-blox":    {"triggers": ["u-blox","ublox","m8n","m9n","m10s","zed-f9p","neo-m"], "fulltext":["u-blox","ublox","neo-m","zed-f9"], "cats":["gps_modules"]},
    "ESP32":     {"triggers": ["esp32","esp8285","espressif"], "fulltext":["esp32","esp8285","espressif"], "cats":["receivers","control_link_tx","companion_computers"]},
    "ICM-42688": {"triggers": ["icm-42688","icm42688","invensense"], "fulltext":["icm42688","icm-42688"], "cats":["flight_controllers"]},
    "BMI270":    {"triggers": ["bmi270"], "fulltext":["bmi270"], "cats":["flight_controllers"]},
    "Jetson":    {"triggers": ["jetson","nvidia"], "fulltext":["jetson","nvidia"], "cats":["companion_computers"]},
    "OmniVision":{"triggers": ["omnivision"], "fulltext":["omnivision"], "cats":["fpv_cameras"]},
    "Quectel":   {"triggers": ["quectel","casic","allystar","l76k"], "fulltext":["quectel","casic","allystar"], "cats":["gps_modules"]},
}

# Countries → DB field values
COUNTRIES = {
    "China": ["china","hong kong","shenzhen"],
    "USA": ["usa","us","united states"],
    "Taiwan": ["taiwan"],
    "Japan": ["japan"],
    "Germany": ["germany"],
    "Ukraine": ["ukraine"],
    "Israel": ["israel"],
    "Switzerland": ["switzerland"],
}

# Materials → affected component categories
MATERIALS = {
    "NdFeB-magnets":    {"triggers": ["ndfeb","neodymium","rare earth","magnet"], "cats": ["motors"]},
    "LiPo-cells":       {"triggers": ["lipo","lithium polymer","battery cell","pouch cell"], "cats": ["batteries"]},
    "carbon-fiber":     {"triggers": ["carbon fiber","carbon fibre","cf frame"], "cats": ["frames"]},
    "fiber-optic":      {"triggers": ["fiber optic","fibre optic","fiber-optic"], "cats": []},
}


def load_json(path):
    with open(path) as f:
        return json.load(f)


def flag_text(flag):
    return " ".join([flag.get("title","") or "", flag.get("detail","") or "",
                     flag.get("prediction","") or "", flag.get("component_id","") or ""]).lower()


def fulltext_count(items, terms):
    return sum(1 for i in items if any(t in json.dumps(i).lower() for t in terms))


def scan_chips(db, chip):
    comps = db.get("components", {})
    results = {}
    total = 0
    for cat in chip.get("cats", []):
        items = comps.get(cat, [])
        if not isinstance(items, list):
            continue
        count = 0
        # Field match
        if chip.get("field") and chip.get("match"):
            count = sum(1 for i in items if i.get(chip["field"], "") in chip["match"])
        # Fulltext match (take the higher)
        if chip.get("fulltext"):
            ft = fulltext_count(items, chip["fulltext"])
            count = max(count, ft)
        if count > 0:
            results[cat] = {"affected": count, "total": len(items), "pct": round(100*count/len(items))}
            total += count
    return total, results


def scan_country(db, aliases):
    comps = db.get("components", {})
    hit = 0
    grand = 0
    for cat, items in comps.items():
        if not isinstance(items, list):
            continue
        grand += len(items)
        for i in items:
            c = (i.get("country","") or "").lower()
            if any(a in c for a in aliases):
                hit += 1
    return hit, grand


def scan_material(db, cats):
    comps = db.get("components", {})
    return sum(len(comps.get(c,[])) for c in cats if isinstance(comps.get(c,[]), list))


def validate_and_stamp(flags, db):
    comps = db.get("components", {})
    grand_total = sum(len(v) for v in comps.values() if isinstance(v, list))
    gaps = []
    stamped = 0

    for i, flag in enumerate(flags):
        text = flag_text(flag)
        exposures = []

        # ── Chip scan ──
        for name, chip in CHIP_FAMILIES.items():
            if any(t in text for t in chip["triggers"]):
                total, breakdown = scan_chips(db, chip)
                if total > 0:
                    exposures.append((name, total, breakdown))

        # ── Country scan ──
        for country, aliases in COUNTRIES.items():
            if any(a in text for a in aliases):
                hit, grand = scan_country(db, aliases)
                if hit > 0:
                    exposures.append((f"country:{country}", hit, {"all": {"affected": hit, "total": grand, "pct": round(100*hit/grand)}}))

        # ── Material scan ──
        for mat, info in MATERIALS.items():
            if any(t in text for t in info["triggers"]):
                total = scan_material(db, info["cats"])
                if total > 0:
                    exposures.append((f"material:{mat}", total, {c: {"affected": len(comps.get(c,[])), "total": len(comps.get(c,[]))} for c in info["cats"]}))

        if not exposures:
            continue

        # ── Check for understated numbers ──
        detail = flag.get("detail", "")
        for name, total, breakdown in exposures:
            for cat, info in breakdown.items():
                actual = info["affected"]
                # Find stated numbers near category keywords
                cat_words = cat.replace("_"," ").split()
                for word in cat_words:
                    pattern = rf'(\d+)\s*(?:\w+\s*){{0,3}}{re.escape(word)}'
                    for m in re.finditer(pattern, detail, re.IGNORECASE):
                        stated = int(m.group(1))
                        if actual > stated * 1.5 and actual - stated > 3:
                            gaps.append({
                                "flag_index": i,
                                "flag_id": flag.get("id","?"),
                                "title": flag.get("title","?")[:60],
                                "ref": name,
                                "category": cat,
                                "stated": stated,
                                "actual": actual,
                                "delta": actual - stated,
                            })

        # ── Stamp validation into detail ──
        stamps = []
        for name, total, breakdown in exposures:
            if name.startswith("country:") or name.startswith("material:"):
                continue
            for cat, info in breakdown.items():
                stamps.append(f"{cat}={info['affected']}/{info['total']}")

        if stamps and "DB-validated" not in detail:
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            flag["detail"] = detail + f" ⟨DB-validated {ts}: {'; '.join(stamps)}⟩"
            stamped += 1

    return gaps, stamped


def main():
    dry_run = "--dry-run" in sys.argv
    ci_mode = "--ci" in sys.argv

    db = load_json(DB_PATH)
    flags = load_json(FLAGS_PATH)

    comps = db.get("components", {})
    grand = sum(len(v) for v in comps.values() if isinstance(v, list))
    print(f"DB: {grand} components, {len(comps)} categories")
    print(f"Flags: {len(flags)}")

    gaps, stamped = validate_and_stamp(flags, db)

    print(f"\n{'='*50}")
    print(f"Gaps found: {len(gaps)}")
    for g in gaps:
        print(f"  ⚠️  #{g['flag_index']} [{g['ref']}] {g['category']}: stated {g['stated']}, actual {g['actual']} (+{g['delta']})")
        print(f"     {g['title']}")

    if not dry_run:
        print(f"Flags stamped: {stamped}")
        with open(FLAGS_PATH, "w") as f:
            json.dump(flags, f, indent=2)
        print(f"Wrote: {FLAGS_PATH}")

    # Report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rpath = REPORT_DIR / f"validation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "db_components": grand,
        "total_flags": len(flags),
        "gaps_found": len(gaps),
        "flags_stamped": stamped,
        "gaps": gaps,
    }
    with open(rpath, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Report: {rpath}")

    if ci_mode and gaps:
        print(f"\n❌ CI FAIL: {len(gaps)} understated flags")
        sys.exit(1)

    print("\nBuddy up.")


if __name__ == "__main__":
    main()
