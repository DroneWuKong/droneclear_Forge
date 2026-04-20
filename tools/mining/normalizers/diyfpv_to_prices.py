"""
Normalizer: DIYFPV catalog raw records → forge_database.json price patches

Reads  tools/mining/output/raw/diyfpv_catalog-*.jsonl
Patches  DroneClear Components Visualizer/forge_database.json

For each DIYFPV 'part' record, find matching components in forge_database.json
by name similarity and patch their price/availability fields. Never creates
new components — only enriches existing ones.

Match strategy:
  1. Exact canonical name match (after lowercasing + stripping noise)
  2. Substring match where DIYFPV name contains or is contained by DB name
  3. Minimum match score threshold to avoid false positives

Fields updated:
  - price_min_usd   (new field, from DIYFPV min price)
  - in_stock        (bool, True if any retailer has stock)
  - retailer_count  (int, number of retailers stocking it)
  - price_updated   (ISO date)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

RAW_DIR  = Path("tools/mining/output/raw")
DB_FILE  = Path("DroneClear Components Visualizer/forge_database.json")

# Tokens to strip before name matching
_NOISE = re.compile(
    r'\b(v\d[\d.]*|rev\s*\d+|\d+x\d+|\d+mm|\d+g|\d+kv|nano|lite|mini'
    r'|plus|pro|hd|se|mk\d+|\d+s|\d+a|\d+w|analog|digital)\b', re.I
)
_PUNC = re.compile(r'[^a-z0-9\s]')


def canon(name: str) -> str:
    s = name.lower()
    s = _PUNC.sub(' ', s)
    s = _NOISE.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def name_score(db_name: str, diyfpv_name: str) -> float:
    """Score 0–1. 1 = strong match."""
    a = canon(db_name)
    b = canon(diyfpv_name)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # Token overlap
    ta = set(a.split())
    tb = set(b.split())
    if len(ta) < 2 or len(tb) < 2:
        return 0.0
    overlap = ta & tb
    score = len(overlap) / max(len(ta), len(tb))
    # Bonus if one is a substring of the other
    if a in b or b in a:
        score = max(score, 0.75)
    return score


MATCH_THRESHOLD = 0.6  # below this, don't patch


def load_raw() -> list[dict]:
    records = []
    for p in sorted(RAW_DIR.glob("diyfpv_catalog-*.jsonl")):
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("record_type") == "part":
                    records.append(r)
            except json.JSONDecodeError:
                continue
    return records


def build_index(db: dict) -> dict[str, list[tuple[str, dict]]]:
    """Build category→[(name, component_ref)] index for fast lookup."""
    idx: dict[str, list] = {}
    for cat, items in db.get("components", {}).items():
        if not isinstance(items, list):
            continue
        idx[cat] = [(item.get("name", ""), item) for item in items]
    return idx


def find_best_match(diyfpv_name: str, diyfpv_cat: str, idx: dict) -> tuple[dict | None, float]:
    """Find best matching component in DB for a DIYFPV part."""
    best_item = None
    best_score = 0.0

    # Search within the matching forge category first, then all
    cats_to_search = [diyfpv_cat] if diyfpv_cat in idx else []
    cats_to_search += [c for c in idx if c != diyfpv_cat]

    for cat in cats_to_search[:3]:  # limit search scope
        for db_name, item in idx.get(cat, []):
            score = name_score(db_name, diyfpv_name)
            if score > best_score:
                best_score = score
                best_item = item
        if best_score >= 0.9:
            break  # good enough, stop searching

    return best_item, best_score


def apply_patches(db: dict, raw: list[dict]) -> tuple[dict, int]:
    idx = build_index(db)
    patch_count = 0
    today = datetime.now(timezone.utc).date().isoformat()

    for rec in raw:
        d = rec.get("data", {})
        diyfpv_name = d.get("name", "")
        diyfpv_cat  = d.get("category", "")
        min_price   = d.get("min_price_usd")
        in_stock    = d.get("in_stock_store_count", 0) > 0
        retailers   = d.get("total_store_count", 0)

        if not diyfpv_name:
            continue

        item, score = find_best_match(diyfpv_name, diyfpv_cat, idx)
        if item is None or score < MATCH_THRESHOLD:
            continue

        # Patch fields — never overwrite core fields (pid, name, manufacturer, etc.)
        patched = False
        if min_price is not None:
            old = item.get("price_min_usd")
            if old is None or abs(float(old) - min_price) > 0.50:
                item["price_min_usd"]  = min_price
                item["price_updated"]  = today
                patched = True
        if "in_stock" not in item or item["in_stock"] != in_stock:
            item["in_stock"]       = in_stock
            item["retailer_count"] = retailers
            patched = True
        if patched:
            patch_count += 1

    return db, patch_count


def main():
    raw = load_raw()
    if not raw:
        print("  DIYFPV normalizer: no raw records found — run diyfpv_catalog miner first")
        return

    db = json.loads(DB_FILE.read_text(encoding="utf-8"))
    db, patch_count = apply_patches(db, raw)

    if patch_count > 0:
        DB_FILE.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  DIYFPV: {patch_count} components patched with price/availability data")
        print(f"  wrote {DB_FILE}")
    else:
        print(f"  DIYFPV: {len(raw)} records processed, 0 patches applied (no matches above threshold)")


if __name__ == "__main__":
    main()
