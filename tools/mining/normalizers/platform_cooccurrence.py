"""
Normalizer: forge_database.json platforms → forge_platform_cooccurrence.json

Reads: DroneClear Components Visualizer/forge_database.json
       (drone_models[].relations → PID references → component names)

Writes: DroneClear Components Visualizer/forge_platform_cooccurrence.json

Unlike RotorBuilds co-occurrence (hobby builds), this extracts co-occurrence
from the curated platforms database — defense, commercial, and professional
drone configurations. The signal is different:
  - RotorBuilds = "what hobbyists actually build" (volume, experimentation)
  - Platforms DB = "what integrators ship" (validated, production-grade)

Output schema:
{
  "generated": "<iso8601>",
  "source_platform_count": N,
  "pair_count": N,
  "pairs": [
    {
      "category_a": "flight_controllers",
      "part_a": "SpeedyBee F405 AIO ...",
      "pid_a": "FC-1005",
      "category_b": "motors",
      "part_b": "Axisflying AF2207.5 ...",
      "pid_b": "MTR-1000",
      "count": 5,
      "platforms": ["Apex Freestyle 5\"", "Venom Racer 5\""],
      "build_classes": {"5inch_freestyle": 3, "7inch_lr": 2}
    }
  ],
  "cooccurrence": { "part_name": {"related_part": count} },
  "components": {
    "PID": {"name": "...", "category": "...", "manufacturer": "...",
            "platform_count": N, "platforms": [...]}
  }
}
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


DB_FILE  = Path("DroneClear Components Visualizer/forge_database.json")
OUT_FILE = Path("DroneClear Components Visualizer/forge_platform_cooccurrence.json")

# Categories in relations that represent real components
COMPONENT_CATEGORIES = {
    "frames", "motors", "stacks", "flight_controllers", "escs",
    "propellers", "batteries", "fpv_cameras", "video_transmitters",
    "receivers", "antennas", "gps_modules",
}

# Map DB category → Forge-canonical slug (for cross-referencing with RotorBuilds)
CAT_TO_FORGE = {
    "frames":              "frame",
    "motors":              "motor",
    "stacks":              "stack",
    "flight_controllers":  "flight_controller",
    "escs":                "esc",
    "propellers":          "propeller",
    "batteries":           "battery",
    "fpv_cameras":         "camera",
    "video_transmitters":  "vtx",
    "receivers":           "receiver",
    "antennas":            "antenna",
    "gps_modules":         "gps",
}


def load_db():
    return json.loads(DB_FILE.read_text(encoding="utf-8"))


def build_pid_index(db: dict) -> dict[str, dict]:
    """PID → {name, category, manufacturer}"""
    index = {}
    for cat, items in db.get("components", {}).items():
        if not isinstance(items, list):
            continue
        for item in items:
            pid = item.get("pid", "")
            if pid:
                index[pid] = {
                    "name": item.get("name", ""),
                    "category": cat,
                    "manufacturer": item.get("manufacturer", ""),
                }
    return index


def extract_platform_parts(model: dict, pid_index: dict) -> list[tuple[str, str, str]]:
    """Returns list of (category, pid, name) for a platform."""
    parts = []
    for cat, refs in (model.get("relations") or {}).items():
        if cat not in COMPONENT_CATEGORIES:
            continue
        if not isinstance(refs, list):
            continue
        for ref in refs:
            pid = ref.get("pid", "")
            info = pid_index.get(pid)
            if info and info["name"]:
                parts.append((cat, pid, info["name"]))
    return parts


def aggregate(db: dict) -> dict:
    pid_index = build_pid_index(db)
    models = db.get("drone_models", [])

    pair_counts: Counter = Counter()
    pair_platforms: dict[tuple, list[str]] = defaultdict(list)
    pair_classes: dict[tuple, Counter] = defaultdict(Counter)
    component_platforms: dict[str, list[str]] = defaultdict(list)
    platform_count = 0

    for model in models:
        parts = extract_platform_parts(model, pid_index)
        if len(parts) < 2:
            continue
        platform_count += 1
        platform_name = model.get("name", "unknown")
        build_class = model.get("build_class", "unknown")

        for pid_cat, pid, name in parts:
            component_platforms[pid].append(platform_name)

        # Cross-category pairs
        for i, (cat_a, pid_a, name_a) in enumerate(parts):
            for cat_b, pid_b, name_b in parts[i + 1:]:
                if cat_a == cat_b:
                    continue
                key = tuple(sorted([(cat_a, pid_a, name_a), (cat_b, pid_b, name_b)]))
                pair_counts[key] += 1
                pair_platforms[key].append(platform_name)
                pair_classes[key][build_class] += 1

    # Build pairs output
    pairs = []
    for key, count in pair_counts.most_common():
        (cat_a, pid_a, name_a), (cat_b, pid_b, name_b) = key
        pairs.append({
            "category_a": CAT_TO_FORGE.get(cat_a, cat_a),
            "part_a": name_a,
            "pid_a": pid_a,
            "category_b": CAT_TO_FORGE.get(cat_b, cat_b),
            "part_b": name_b,
            "pid_b": pid_b,
            "count": count,
            "platforms": sorted(set(pair_platforms[key])),
            "build_classes": dict(pair_classes[key]),
        })

    # Inverted index: part name → {related_part: count}
    cooccurrence: dict[str, dict[str, int]] = defaultdict(dict)
    for key, count in pair_counts.items():
        (_, _, name_a), (_, _, name_b) = key
        cooccurrence[name_a][name_b] = cooccurrence[name_a].get(name_b, 0) + count
        cooccurrence[name_b][name_a] = cooccurrence[name_b].get(name_a, 0) + count
    cooccurrence_sorted = {
        part: dict(sorted(related.items(), key=lambda x: -x[1])[:20])
        for part, related in cooccurrence.items()
    }

    # Component summary: PID → {name, category, manufacturer, platform_count, platforms}
    components_summary = {}
    for pid, info in pid_index.items():
        plats = component_platforms.get(pid, [])
        if plats:
            components_summary[pid] = {
                "name": info["name"],
                "category": CAT_TO_FORGE.get(info["category"], info["category"]),
                "manufacturer": info["manufacturer"],
                "platform_count": len(set(plats)),
                "platforms": sorted(set(plats)),
            }

    return {
        "$schema": "https://droneclear.ai/schemas/platform-cooccurrence-v1.json",
        "generated": datetime.utcnow().isoformat() + "Z",
        "source_platform_count": platform_count,
        "pair_count": len(pairs),
        "component_count": len(components_summary),
        "pairs": pairs,
        "cooccurrence": cooccurrence_sorted,
        "components": components_summary,
    }


def main():
    db = load_db()
    output = aggregate(db)
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(
        f"wrote {OUT_FILE}: {output['pair_count']} pairs from "
        f"{output['source_platform_count']} platforms, "
        f"{output['component_count']} components"
    )


if __name__ == "__main__":
    main()
