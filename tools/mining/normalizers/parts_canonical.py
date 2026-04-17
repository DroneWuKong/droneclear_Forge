"""
Normalizer: DIYFPV catalog + RotorBuilds raw → forge_parts_canonical.json

Reads:
  tools/mining/output/raw/diyfpv_catalog-*.jsonl   (canonical names, prices)
  tools/mining/output/raw/rotorbuilds-*.jsonl       (hobbyist alias names)

Writes:
  DroneClear Components Visualizer/forge_parts_canonical.json

Output schema:
{
  "generated": "<iso8601>",
  "part_count": N,
  "parts": [
    {
      "canonical_name": "Flywoo Goku F722 Pro Mini V2 Flight Controller",
      "category": "flight_controller",
      "min_price_usd": 44.99,
      "in_stock_store_count": 6,
      "total_store_count": 6,
      "stores": [...],               // from diyfpv, subset fields
      "aliases": [                   // RotorBuilds typed variants
        "Flywoo Goku F722 Pro Mini V2 Flight Controller - 20x20mm",
        "Flywoo Goku GN745 AIO F7 FC 45A"
      ],
      "match_tokens": ["goku", "f722"]
    }
  ]
}

Matching strategy:
  Model-number tokens are the primary anchor. Parts share a model number
  token (e.g. "f405", "h743", "gr1408") if and only if they are very
  likely the same hardware. Brand token corroboration is used as a
  tiebreaker when multiple DIYFPV parts share the same model number.

  Algorithm:
  1. Index DIYFPV parts by their model-number tokens.
  2. For each RotorBuilds part, extract model-number tokens, look up
     DIYFPV candidates, rank by overlap score.
  3. Accept matches above MIN_OVERLAP_SCORE (default 0.6).
  4. Emit unmatched DIYFPV parts too — they become canonical stubs
     without RotorBuilds aliases (still useful for price/stock data).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable


RAW_DIR  = Path("tools/mining/output/raw")
OUT_FILE = Path("DroneClear Components Visualizer/forge_parts_canonical.json")

MIN_OVERLAP_SCORE = 0.55  # fraction of model tokens that must match

# Tokens that appear in many part names and carry no discriminating signal
_NOISE_TOKENS = {
    "for", "fpv", "drone", "rc", "racing", "brushless", "motor", "controller",
    "flight", "esc", "frame", "kit", "aio", "stack", "v1", "v2", "v3",
    "and", "with", "the", "set", "pack", "combo", "series", "edition",
    "black", "white", "red", "blue", "carbon", "fiber", "pcs", "pair",
    "lipo", "battery", "plug", "connector", "inch", "mm", "hz", "ghz",
    "mhz", "mw", "s", "x", "of",
}

# STM32 chip designations that appear in hundreds of FCs — a match on these
# alone is meaningless. Require brand corroboration before accepting.
_WEAK_MODEL_TOKENS = {
    # STM32 chip designations
    "f405", "f411", "f722", "f745", "f765", "f7", "f4",
    "h743", "h750", "h7",
    "g473", "g4",
    "at32f435", "at32",
    # IMU chips
    "icm42688", "mpu6000", "bmi270",
    # Amperage ratings (shared by many ESCs)
    "20a", "25a", "30a", "35a", "40a", "45a", "50a", "55a", "60a", "65a", "80a",
    # Voltage ratings
    "2s", "3s", "4s", "6s", "8s", "12s",
    # Common size designations used across brands
    "20x20", "25x25", "30x30", "35x35",
}

# Regex for model-number tokens: alphanumeric chunks that contain digits
# (e.g. "f405", "h743", "gr1408", "3500kv", "1408", "2207", "75mm")
_MODEL_TOKEN_RE = re.compile(r'\b(?:[a-z]*\d+[a-z0-9]*|[a-z]+\d+)\b')

# Brand list to extract brand token for tiebreaking
_KNOWN_BRANDS = {
    "betafpv", "holybro", "matek", "iflight", "foxeer", "runcam", "caddx",
    "dji", "radiomaster", "emax", "tmotor", "t-motor", "geprc", "flywoo",
    "rushfpv", "speedybee", "happymodel", "betamotion", "ark", "silvus",
    "modalai", "skydio", "mamba", "aikon", "kiss", "tbs", "crossfire",
    "expresslrs", "elrs", "flysky", "frsky", "futaba", "spektrum",
    "gemfan", "hqprop", "dal", "azure", "tattu", "gaoneng", "gnb",
    "foxtech", "lumenier", "armattan", "rotorx", "flite", "diatone",
    "hglrc", "rcinpower", "axisflying", "newbeedrone", "neutronrc",
    "betaflight", "inav", "ardupilot", "px4", "neurotechnology",
    "9imod", "umt", "tunerc", "skystars", "hdzone", "hdz", "hdzero",
    "rekon", "longrange", "flywoo", "flightone", "kiss", "flyduino",
}


def _normalise(name: str) -> str:
    return re.sub(r'[^\w\s]', ' ', name.lower())


def _model_tokens(name: str) -> set[str]:
    normed = _normalise(name)
    return {t for t in _MODEL_TOKEN_RE.findall(normed) if t not in _NOISE_TOKENS}


def _brand_token(name: str) -> str | None:
    normed = _normalise(name)
    for tok in normed.split():
        if tok in _KNOWN_BRANDS:
            return tok
    return None


def _overlap_score(a_tokens: set[str], b_tokens: set[str]) -> float:
    if not a_tokens or not b_tokens:
        return 0.0
    intersection = a_tokens & b_tokens
    # Jaccard-like but weighted toward the smaller set
    smaller = min(len(a_tokens), len(b_tokens))
    return len(intersection) / smaller


def load_diyfpv() -> list[dict]:
    parts = []
    seen_names: set[str] = set()
    for p in sorted(RAW_DIR.glob("diyfpv_catalog-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("record_type") != "part":
                continue
            name = r["data"].get("name", "").strip()
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            parts.append(r["data"])
    return parts


def load_rotorbuilds_parts() -> list[tuple[str, str]]:
    """Returns list of (category, name) from all RotorBuilds build records."""
    result: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for p in sorted(RAW_DIR.glob("rotorbuilds-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("record_type") != "build":
                continue
            for part in r["data"].get("parts", []):
                key = (part.get("category", ""), part.get("name", "").strip())
                if key[1] and key not in seen:
                    seen.add(key)
                    result.append(key)
    return result


def build_index(diyfpv_parts: list[dict]) -> dict[str, list[int]]:
    """Index DIYFPV parts by each of their model tokens → list of part indices."""
    index: dict[str, list[int]] = defaultdict(list)
    for i, part in enumerate(diyfpv_parts):
        for tok in _model_tokens(part["name"]):
            index[tok].append(i)
    return index


def match_rotorbuilds(
    rb_parts: list[tuple[str, str]],
    diyfpv_parts: list[dict],
    token_index: dict[str, list[int]],
) -> dict[int, list[str]]:
    """Returns diyfpv_part_index → list of matched RotorBuilds part names."""
    matches: dict[int, list[str]] = defaultdict(list)

    for rb_cat, rb_name in rb_parts:
        rb_tokens = _model_tokens(rb_name)
        if not rb_tokens:
            continue
        rb_brand = _brand_token(rb_name)

        # Candidate DIYFPV parts: those sharing at least one model token
        candidates: dict[int, int] = defaultdict(int)
        for tok in rb_tokens:
            for idx in token_index.get(tok, []):
                candidates[idx] += 1

        if not candidates:
            continue

        # Score each candidate
        best_idx, best_score = -1, 0.0
        rb_strong = rb_tokens - _WEAK_MODEL_TOKENS
        brands_match = rb_brand is not None
        for idx, shared_count in candidates.items():
            d_part = diyfpv_parts[idx]
            # Category filter — skip if clearly different category
            if rb_cat and d_part.get("category") and rb_cat != d_part["category"]:
                continue
            d_tokens = _model_tokens(d_part["name"])
            score = _overlap_score(rb_tokens, d_tokens)
            d_brand = _brand_token(d_part["name"])
            brand_match = rb_brand and rb_brand == d_brand
            brand_conflict = rb_brand and d_brand and rb_brand != d_brand
            # Brand corroboration bonus
            if brand_match:
                score = min(score + 0.20, 1.0)
            # Brand conflict: different known brands → disqualify
            if brand_conflict:
                score = 0.0
            # If all shared tokens are weak chip designations, require brand match
            shared = rb_tokens & d_tokens
            if shared and shared <= _WEAK_MODEL_TOKENS and not brand_match:
                score = 0.0
            if score > best_score:
                best_score, best_idx = score, idx

        if best_idx >= 0 and best_score >= MIN_OVERLAP_SCORE:
            matches[best_idx].append(rb_name)

    return matches


def build_output(
    diyfpv_parts: list[dict],
    matches: dict[int, list[str]],
) -> dict:
    parts_out = []
    for i, part in enumerate(diyfpv_parts):
        aliases = sorted(set(matches.get(i, [])))
        # Slim down store data for output
        stores_slim = [
            {
                "store": s["store_name"],
                "region": s["region"],
                "price_usd": round(s["price_usd"] / 100, 2) if s.get("price_usd") else None,
                "in_stock": s["in_stock"],
                "is_manufacturer": s["is_manufacturer"],
                "buy_url": s["buy_url"],
            }
            for s in (part.get("stores") or [])
        ]

        parts_out.append({
            "canonical_name": part["name"],
            "category": part.get("category", ""),
            "min_price_usd": part.get("min_price_usd"),
            "in_stock_store_count": part.get("in_stock_store_count", 0),
            "total_store_count": part.get("total_store_count", 0),
            "stores": stores_slim,
            "aliases": aliases,
            "match_tokens": sorted(_model_tokens(part["name"])),
        })

    # Sort: matched parts first (have aliases), then alphabetically
    parts_out.sort(key=lambda p: (0 if p["aliases"] else 1, p["canonical_name"]))

    return {
        "$schema": "https://droneclear.ai/schemas/parts-canonical-v1.json",
        "generated": datetime.utcnow().isoformat() + "Z",
        "part_count": len(parts_out),
        "matched_count": sum(1 for p in parts_out if p["aliases"]),
        "parts": parts_out,
    }


def main():
    diyfpv_parts = load_diyfpv()
    rb_parts     = load_rotorbuilds_parts()
    token_index  = build_index(diyfpv_parts)
    matches      = match_rotorbuilds(rb_parts, diyfpv_parts, token_index)
    output       = build_output(diyfpv_parts, matches)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(
        f"wrote {OUT_FILE}: {output['part_count']} parts, "
        f"{output['matched_count']} matched to RotorBuilds aliases"
    )


if __name__ == "__main__":
    main()
