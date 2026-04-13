"""
Normalizer: RotorBuilds raw records -> forge_co_occurrence.json

Reads tools/mining/output/raw/rotorbuilds-*.jsonl
Writes DroneClear Components Visualizer/forge_co_occurrence.json

Output schema:
{
  "$schema": "https://droneclear.ai/schemas/co-occurrence-v1.json",
  "generated": "<iso8601>",
  "source_build_count": N,
  "pairs": [
    {
      "category_a": "flight_controller",
      "part_a": "matek h743",
      "category_b": "esc",
      "part_b": "iflight blitz e55",
      "count": 47,
      "build_classes": {"7inch_lr": 31, "5inch_freestyle": 12, "10inch_cargo": 4}
    },
    ...
  ]
}

This feeds Wingman's build-validity check as "commonly paired" positive signal.

SCAFFOLD: logic is stubbed until parse() in rotorbuilds.py is wired.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


RAW_DIR = Path("tools/mining/output/raw")
OUT_FILE = Path("DroneClear Components Visualizer/forge_co_occurrence.json")

# Common brand prefixes to normalise out of part names for matching
_BRAND_PREFIXES = {
    "betafpv", "holybro", "matek", "iflight", "foxeer", "runcam",
    "caddx", "dji", "radiomaster", "emax", "t-motor", "tmotor",
    "geprc", "flywoo", "rushfpv", "speedybee", "betaflight",
    "happymodel", "betamotion", "ark electronics", "ark",
    "silvus", "persistent systems", "modalai", "skydio",
}

# Noise tokens to strip
_NOISE = re.compile(r'\b(v\d[\d.]*|rev\s*\d+|\d+x\d+|\d+mm|\d+g|\d+kv|nano|lite|mini|plus|pro|hd|se|mk\d+)\b', re.I)


def canonicalize(name: str) -> str:
    """Lowercase, strip noise tokens, normalise whitespace."""
    s = name.lower().strip()
    s = re.sub(r'[^\w\s]', ' ', s)   # punctuation → space
    s = _NOISE.sub(' ', s)
    s = re.sub(r'\s+\d+$', '', s)    # trailing lone digits (e.g. "e55 0")
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def load_raw() -> list[dict]:
    records = []
    for p in sorted(RAW_DIR.glob("rotorbuilds-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def build_class_hint(prop_size_inch: int | None, title: str, tags: list[str]) -> str:
    t = (title or "").lower() + " " + " ".join(tags or []).lower()
    if "cinelifter" in t or "cine lifter" in t:
        return "cinelifter"
    if "cargo" in t or "delivery" in t or "payload" in t:
        return "cargo"
    if "long range" in t or "long-range" in t or "lr" in t:
        size = prop_size_inch or 0
        return f"{size}inch_lr" if size else "lr"
    if "freestyle" in t:
        size = prop_size_inch or 5
        return f"{size}inch_freestyle"
    if "race" in t or "racing" in t:
        return "race"
    if "whoop" in t:
        return "whoop"
    if prop_size_inch:
        return f"{prop_size_inch}inch"
    return "unknown"


def aggregate(raw: list[dict]) -> dict:
    pair_counts: Counter = Counter()
    class_by_pair: dict = defaultdict(Counter)
    build_count = 0

    for rec in raw:
        if rec.get("record_type") != "build":
            continue
        data = rec.get("data", {})
        parts = data.get("parts") or []
        if not parts:
            continue
        build_count += 1
        klass = build_class_hint(
            data.get("prop_size_inch_hint"),
            data.get("title", ""),
            data.get("tags", []),
        )

        # Normalize parts to (category, canonical_name) tuples
        normed = []
        for p in parts:
            cat = (p.get("category") or "").strip().lower()
            name = canonicalize(p.get("name") or "")
            if cat and name and len(name) > 2:
                normed.append((cat, name))

        # Emit all cross-category pairs
        for i, a in enumerate(normed):
            for b in normed[i + 1:]:
                if a[0] == b[0]:
                    continue  # same category — not useful for cross-category signal
                key = tuple(sorted([a, b]))
                pair_counts[key] += 1
                class_by_pair[key][klass] += 1

    pairs = []
    for (a, b), count in pair_counts.most_common():
        pairs.append({
            "category_a": a[0],
            "part_a": a[1],
            "category_b": b[0],
            "part_b": b[1],
            "count": count,
            "build_classes": dict(class_by_pair[(a, b)]),
        })

    # Build inverted index: part_name → {related_part: count}
    # This is what wingman.html reads as coData.cooccurrence
    cooccurrence: dict[str, dict[str, int]] = defaultdict(dict)
    for (a, b), count in pair_counts.items():
        cooccurrence[a[1]][b[1]] = cooccurrence[a[1]].get(b[1], 0) + count
        cooccurrence[b[1]][a[1]] = cooccurrence[b[1]].get(a[1], 0) + count
    # Sort each entry by count desc, keep top 20 related parts
    cooccurrence_sorted = {
        part: dict(sorted(related.items(), key=lambda x: -x[1])[:20])
        for part, related in cooccurrence.items()
    }

    return {
        "$schema": "https://droneclear.ai/schemas/co-occurrence-v1.json",
        "generated": datetime.utcnow().isoformat() + "Z",
        "source_build_count": build_count,
        "pair_count": len(pairs),
        "pairs": pairs,
        # Flat inverted index for wingman.html: part → {related_part: count}
        "cooccurrence": cooccurrence_sorted,
    }


def main():
    raw = load_raw()
    agg = aggregate(raw)
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(agg, indent=2), encoding="utf-8")
    print(f"wrote {OUT_FILE}: {agg['pair_count']} pairs from {agg['source_build_count']} builds")


if __name__ == "__main__":
    main()
