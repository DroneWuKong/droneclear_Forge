"""
Normalizer: ArduPilot Discourse raw records → forge_co_occurrence.json supplement

Reads  tools/mining/output/raw/ardupilot_discourse-*.jsonl
Merges into  DroneClear Components Visualizer/forge_co_occurrence.json

ArduPilot threads carry hardware tags (e.g. 'cube-orange', 'matek-h743',
'f9p'). When a thread has multiple hardware tags from different categories,
that's a co-occurrence signal: real operators ran these components together.

This supplements the RotorBuilds co-occurrence data with professional
integrator signal (ArduPilot/PX4 ecosystem vs Betaflight hobby builds).

Tag→Forge category mapping: tags are mapped to forge categories using a
lookup table, then paired across categories as per aggregate_cooccurrence.py.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

RAW_DIR  = Path("tools/mining/output/raw")
OUT_FILE = Path("DroneClear Components Visualizer/forge_co_occurrence.json")

# Map Discourse hardware tags → (forge_category, canonical_name)
TAG_MAP: dict[str, tuple[str, str]] = {
    # Flight controllers
    "cube-orange":       ("flight_controllers", "cubepilot cube orange"),
    "cube-orange-plus":  ("flight_controllers", "cubepilot cube orange plus"),
    "cube-black":        ("flight_controllers", "cubepilot cube black"),
    "cube-yellow":       ("flight_controllers", "cubepilot cube yellow"),
    "pixhawk-6x":        ("flight_controllers", "holybro pixhawk 6x"),
    "pixhawk-6c":        ("flight_controllers", "holybro pixhawk 6c"),
    "pixhawk-6c-mini":   ("flight_controllers", "holybro pixhawk 6c mini"),
    "holybro-kakute-h7": ("flight_controllers", "holybro kakute h7"),
    "kakuteh7":          ("flight_controllers", "holybro kakute h7"),
    "matek-h743":        ("flight_controllers", "matek h743"),
    "matek-h743-slim":   ("flight_controllers", "matek h743 slim"),
    "matek-f405":        ("flight_controllers", "matek f405"),
    "speedybee-f405":    ("flight_controllers", "speedybee f405"),
    "omnibusf4":         ("flight_controllers", "omnibus f4"),
    "arkv6x":            ("flight_controllers", "ark arkv6x"),
    "auterion-skynode":  ("flight_controllers", "auterion skynode"),
    # GPS
    "here3":             ("gps_modules", "cubepilot here3"),
    "here4":             ("gps_modules", "cubepilot here4"),
    "matek-m9n":         ("gps_modules", "matek m9n"),
    "matek-sam-m10q":    ("gps_modules", "matek sam m10q"),
    "f9p":               ("gps_modules", "ublox f9p"),
    "zed-f9p":           ("gps_modules", "ublox zed f9p"),
    "rtk":               ("gps_modules", "rtk gps"),
    "ark-gps":           ("gps_modules", "ark gps"),
    # ESCs
    "blheli32":          ("escs", "blheli 32"),
    "am32":              ("escs", "am32"),
    "zubax-myxa":        ("escs", "zubax myxa"),
    # RC links / datalinks
    "herelink":          ("control_link_tx", "cubepilot herelink"),
    "ardupilot-herelink":("control_link_tx", "cubepilot herelink"),
    "expresslrs":        ("receivers", "expresslrs"),
    "elrs":              ("receivers", "expresslrs"),
    "crossfire":         ("receivers", "tbs crossfire"),
    "rfd900":            ("control_link_tx", "rfdesign rfd900"),
    "silvus":            ("mesh_radios", "silvus streamcaster"),
    "doodle-labs":       ("mesh_radios", "doodle labs mesh rider"),
    "sik-radio":         ("control_link_tx", "sik radio"),
    # Companion computers
    "raspberry-pi":      ("companion_computers", "raspberry pi"),
    "rpi4":              ("companion_computers", "raspberry pi 4"),
    "rpi5":              ("companion_computers", "raspberry pi 5"),
    "jetson-nano":       ("companion_computers", "nvidia jetson nano"),
    "jetson-orin":       ("companion_computers", "nvidia jetson orin"),
    "modalai-voxl":      ("companion_computers", "modalai voxl"),
    "voxl2":             ("companion_computers", "modalai voxl 2"),
    # Cameras / payloads
    "flir-boson":        ("thermal_cameras", "flir boson"),
    "siyi-a8":           ("fpv_cameras", "siyi a8 mini"),
    "siyi-zr10":         ("fpv_cameras", "siyi zr10"),
    "siyi":              ("fpv_cameras", "siyi"),
    "caddx":             ("fpv_cameras", "caddx"),
    "runcam":            ("fpv_cameras", "runcam"),
}


def load_raw() -> list[dict]:
    records = []
    for p in sorted(RAW_DIR.glob("ardupilot_discourse-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("record_type") == "thread":
                    records.append(r)
            except json.JSONDecodeError:
                continue
    return records


def aggregate(raw: list[dict]) -> tuple[Counter, dict]:
    """Build pair_counts and class_by_pair from ArduPilot thread tags."""
    pair_counts: Counter = Counter()
    class_by_pair: dict = defaultdict(Counter)
    build_count = 0

    for rec in raw:
        d = rec.get("data", {})
        tags = d.get("tags", [])
        posts = d.get("posts_count", 0)
        # Weight by engagement: accepted answers count 3x, high-post threads 2x
        weight = 3 if d.get("accepted_answer") else (2 if posts >= 10 else 1)

        # Map tags to (category, name) pairs
        mapped = []
        for tag in tags:
            if tag in TAG_MAP:
                mapped.append(TAG_MAP[tag])

        if len(mapped) < 2:
            continue
        build_count += 1

        # Emit cross-category pairs
        for i, a in enumerate(mapped):
            for b in mapped[i + 1:]:
                if a[0] == b[0]:
                    continue  # same category
                key = tuple(sorted([a, b]))
                pair_counts[key] += weight
                class_by_pair[key]["ardupilot"] += weight

    return pair_counts, class_by_pair, build_count


def merge_into_cooccurrence(pair_counts: Counter, class_by_pair: dict, build_count: int):
    """Merge ArduPilot pairs into existing forge_co_occurrence.json."""
    if not pair_counts:
        print("  ArduPilot: no pairs to merge")
        return

    # Load existing
    if OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    else:
        existing = {"pairs": [], "cooccurrence": {}, "source_build_count": 0}

    # Index existing pairs
    pair_index: dict[tuple, int] = {}
    for i, p in enumerate(existing.get("pairs", [])):
        key = ((p["category_a"], p["part_a"]), (p["category_b"], p["part_b"]))
        pair_index[key] = i

    added, updated = 0, 0
    pairs = existing.get("pairs", [])
    for (a, b), count in pair_counts.most_common():
        entry = {
            "category_a": a[0], "part_a": a[1],
            "category_b": b[0], "part_b": b[1],
            "count": count,
            "build_classes": dict(class_by_pair[(a, b)]),
        }
        if (a, b) in pair_index:
            idx = pair_index[(a, b)]
            pairs[idx]["count"] += count
            pairs[idx]["build_classes"].update(entry["build_classes"])
            updated += 1
        elif (b, a) in pair_index:
            idx = pair_index[(b, a)]
            pairs[idx]["count"] += count
            pairs[idx]["build_classes"].update(entry["build_classes"])
            updated += 1
        else:
            pairs.append(entry)
            added += 1

    # Rebuild inverted cooccurrence index
    cooccurrence: dict = defaultdict(dict)
    for p in pairs:
        pa, pb = p["part_a"], p["part_b"]
        cnt = p["count"]
        cooccurrence[pa][pb] = cooccurrence[pa].get(pb, 0) + cnt
        cooccurrence[pb][pa] = cooccurrence[pb].get(pa, 0) + cnt
    cooccurrence_sorted = {
        part: dict(sorted(rel.items(), key=lambda x: -x[1])[:20])
        for part, rel in cooccurrence.items()
    }

    existing["pairs"] = sorted(pairs, key=lambda p: -p["count"])
    existing["pair_count"] = len(pairs)
    existing["cooccurrence"] = cooccurrence_sorted
    existing["source_build_count"] = existing.get("source_build_count", 0) + build_count
    existing["generated"] = datetime.now(timezone.utc).isoformat()
    existing["ardupilot_thread_count"] = build_count

    OUT_FILE.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  ArduPilot: +{added} new pairs, {updated} updated, {build_count} threads processed")
    print(f"  wrote {OUT_FILE}")


def main():
    raw = load_raw()
    if not raw:
        print("  ArduPilot normalizer: no raw records found — run ardupilot_discourse miner first")
        return
    pair_counts, class_by_pair, build_count = aggregate(raw)
    merge_into_cooccurrence(pair_counts, class_by_pair, build_count)


if __name__ == "__main__":
    main()
