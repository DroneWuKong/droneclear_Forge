#!/usr/bin/env python3
"""
mine_all.py — Full Forge intelligence pipeline orchestrator.

Runs all miners in dependency order and merges results into the appropriate
output files. Designed to be called by CI or manually.

Usage:
    python3 miners/mine_all.py                   # Run everything
    python3 miners/mine_all.py --group intel     # intel miners only
    python3 miners/mine_all.py --group defense   # defense miners
    python3 miners/mine_all.py --group commercial
    python3 miners/mine_all.py --group enrichment
    python3 miners/mine_all.py --group firmware
    python3 miners/mine_all.py --group troubleshooting
    python3 miners/mine_all.py --dry-run         # preview without writing

Groups run in order: intel → defense → commercial → enrichment → firmware → troubleshooting
Each miner is non-fatal — failure prints a warning and continues.
"""

import json
import os
import sys
import argparse
from datetime import datetime, timezone

# ── Path setup ────────────────────────────────────────────────────────────────
SCRIPT_DIR       = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT        = os.path.dirname(SCRIPT_DIR)
INTEL_PATH       = os.path.join(REPO_ROOT, 'DroneClear Components Visualizer', 'forge_intel.json')
DB_PATH          = os.path.join(REPO_ROOT, 'DroneClear Components Visualizer', 'forge_database.json')
COMMERCIAL_DIR   = os.path.join(SCRIPT_DIR, 'commercial')
DEFENSE_DIR      = os.path.join(SCRIPT_DIR, 'defense')
ENRICHMENT_DIR   = os.path.join(SCRIPT_DIR, 'enrichment')
FIRMWARE_DIR     = os.path.join(SCRIPT_DIR, 'firmware')
TROUBLESHOOT_DIR = os.path.join(SCRIPT_DIR, 'troubleshooting')

for d in (SCRIPT_DIR, COMMERCIAL_DIR, DEFENSE_DIR, ENRICHMENT_DIR, FIRMWARE_DIR, TROUBLESHOOT_DIR):
    if d not in sys.path:
        sys.path.insert(0, d)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _banner(title):
    print(f"\n{'=' * 56}")
    print(f"  {title}")
    print(f"{'=' * 56}")


def _run(label, fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        print(f"  WARNING  {label}: {exc}", file=sys.stderr)
        return None


def _load_intel():
    if os.path.exists(INTEL_PATH):
        with open(INTEL_PATH) as f:
            return json.load(f)
    return {
        'meta': {'last_updated': '', 'sources': [], 'version': 0},
        'funding': [], 'contracts': [], 'grants_awards': [],
    }


def _save_intel(intel):
    intel['meta']['last_updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    intel['meta']['version'] = intel['meta'].get('version', 0) + 1
    with open(INTEL_PATH, 'w') as f:
        json.dump(intel, f, indent=2)


def _dedup(existing, new_entries, keyfn):
    seen = {keyfn(e) for e in existing}
    added = []
    for e in new_entries:
        k = keyfn(e)
        if k not in seen:
            seen.add(k)
            added.append(e)
    return added


# ── Group: Intel ──────────────────────────────────────────────────────────────

def run_intel(dry_run=False):
    _banner("INTEL  (dronelife · sbir · blueuas · diu)")
    r = {'funding': [], 'contracts': [], 'grants_awards': [], 'blue_uas': None}

    try:
        from mine_dronelife import mine_dronelife, articles_to_intel
        articles = _run('DroneLife', mine_dronelife)
        if articles:
            f, c, g = articles_to_intel(articles)
            r['funding'].extend(f); r['contracts'].extend(c); r['grants_awards'].extend(g)
            print(f"  DroneLife     -> {len(f)} funding, {len(c)} contracts, {len(g)} regulatory")
    except ImportError as e:
        print(f"  SKIP DroneLife: {e}", file=sys.stderr)

    try:
        from mine_sbir import mine_sbir
        sbir = _run('SBIR', mine_sbir)
        if sbir:
            r['contracts'].extend(sbir)
            print(f"  SBIR          -> {len(sbir)} awards")
    except ImportError as e:
        print(f"  SKIP SBIR: {e}", file=sys.stderr)

    try:
        from mine_blueuas import mine_blueuas
        blue = _run('Blue UAS', mine_blueuas)
        if blue:
            r['blue_uas'] = blue
            print(f"  Blue UAS      -> {blue.get('total_platforms','?')} platforms")
    except ImportError as e:
        print(f"  SKIP Blue UAS: {e}", file=sys.stderr)

    try:
        from mine_diu import mine_diu
        _run('DIU', mine_diu)
        print("  DIU           -> intel updated")
    except ImportError as e:
        print(f"  SKIP DIU: {e}", file=sys.stderr)

    if not dry_run:
        intel = _load_intel()
        nf = _dedup(intel['funding'], r['funding'],
                    lambda e: (e.get('company','').lower(), e.get('type','').lower()))
        nc = _dedup(intel['contracts'], r['contracts'],
                    lambda e: (e.get('program','').lower()[:40], e.get('awardee','').lower()))
        ng = _dedup(intel['grants_awards'], r['grants_awards'],
                    lambda e: e.get('program','').lower()[:40])
        intel['funding'].extend(nf)
        intel['contracts'].extend(nc)
        intel['grants_awards'].extend(ng)
        if r['blue_uas']:
            intel['blue_uas'] = r['blue_uas']
        _save_intel(intel)
        print(f"\n  Merged -> +{len(nf)} funding, +{len(nc)} contracts, +{len(ng)} grants")
    else:
        print("  DRY RUN -- intel not written")
    return r


# ── Group: Defense ────────────────────────────────────────────────────────────

def run_defense(dry_run=False):
    _banner("DEFENSE  (sam · ai_accelerators · c2_datalinks · ew_systems · gcs · navigation_pnt)")

    try:
        from mine_sam import mine_sam
        awards = _run('SAM.gov', mine_sam)
        print(f"  SAM.gov       -> {len(awards) if awards else 0} awards (writes forge_intel.json directly)")
    except ImportError as e:
        print(f"  SKIP SAM: {e}", file=sys.stderr)

    for mod_name, fn_name, label in [
        ('mine_ai_accelerators',      'mine_ai_accelerators',      'AI Accelerators'),
        ('mine_c2_datalinks',         'mine_c2_datalinks',         'C2 Datalinks'),
        ('mine_ew_systems',           'mine_ew_systems',           'EW Systems'),
        ('mine_ground_control_stations', 'mine_ground_control_stations', 'GCS'),
        ('mine_navigation_pnt',       'mine_navigation_pnt',       'Navigation PNT'),
    ]:
        try:
            mod = __import__(mod_name)
            fn  = getattr(mod, fn_name)
            _run(label, fn, dry_run=dry_run)
            print(f"  {label:<20} -> forge_database.json updated")
        except ImportError as e:
            print(f"  SKIP {label}: {e}", file=sys.stderr)


# ── Group: Commercial ─────────────────────────────────────────────────────────

def run_commercial(dry_run=False):
    _banner("COMMERCIAL  (getfpv · rdq · manufacturer)")

    try:
        from mine_getfpv import scrape_category, merge_into_db, CATEGORIES
        added = updated = 0
        for cat in CATEGORIES:
            parts = _run(f'GetFPV/{cat}', scrape_category, cat)
            if parts:
                a, u = _run(f'GetFPV merge/{cat}', merge_into_db, parts, DB_PATH, dry_run) or (0, 0)
                added += a or 0; updated += u or 0
        print(f"  GetFPV        -> +{added} new, {updated} updated")
    except ImportError as e:
        print(f"  SKIP GetFPV: {e}", file=sys.stderr)

    try:
        from mine_rdq import fetch_collection, merge_into_db as rdq_merge, COLLECTIONS
        added = updated = 0
        for coll in COLLECTIONS:
            parts = _run(f'RDQ/{coll}', fetch_collection, coll)
            if parts:
                res = _run(f'RDQ merge/{coll}', rdq_merge, parts, DB_PATH, dry_run) or (0, 0, 0)
                added += res[0] or 0; updated += res[1] or 0
        print(f"  RDQ           -> +{added} new, {updated} updated")
    except ImportError as e:
        print(f"  SKIP RDQ: {e}", file=sys.stderr)

    try:
        from mine_manufacturer import generate_forge_entries, merge_into_db as mfr_merge, MANUFACTURERS
        added = 0
        for mfr in MANUFACTURERS:
            entries = _run(f'Manufacturer/{mfr}', generate_forge_entries, mfr)
            if entries:
                a = _run(f'Manufacturer merge/{mfr}', mfr_merge, entries, DB_PATH, dry_run)
                added += a or 0
        print(f"  Manufacturer  -> +{added} new")
    except ImportError as e:
        print(f"  SKIP Manufacturer: {e}", file=sys.stderr)


# ── Group: Enrichment ─────────────────────────────────────────────────────────

def run_enrichment(dry_run=False):
    _banner("ENRICHMENT  (descriptions · platform_specs · platform_images)")

    try:
        from enrich_descriptions import enrich
        count = _run('Descriptions', enrich, dry_run=dry_run)
        print(f"  Descriptions  -> {count or 0} enriched")
    except ImportError as e:
        print(f"  SKIP Descriptions: {e}", file=sys.stderr)

    try:
        from enrich_platform_specs import enrich as enrich_specs
        count = _run('Platform specs', enrich_specs, dry_run=dry_run)
        print(f"  Platform specs -> {count or 0} enriched")
    except ImportError as e:
        print(f"  SKIP Platform specs: {e}", file=sys.stderr)

    # Images are network-heavy; opt-in via env var
    if os.environ.get('FORGE_FETCH_IMAGES') == '1':
        try:
            from fetch_platform_images import main as fetch_images
            _run('Platform images', fetch_images)
            print("  Platform images -> updated")
        except ImportError as e:
            print(f"  SKIP Platform images: {e}", file=sys.stderr)
    else:
        print("  Platform images -> skipped (FORGE_FETCH_IMAGES=1 to enable)")


# ── Group: Firmware ───────────────────────────────────────────────────────────

def run_firmware(dry_run=False):
    _banner("FIRMWARE  (betaflight · inav · ardupilot · px4)")
    import subprocess
    fw_script = os.path.join(FIRMWARE_DIR, 'mine_firmware_configs.py')
    flags = ['--dry-run'] if dry_run else []
    r = subprocess.run([sys.executable, fw_script] + flags, cwd=REPO_ROOT)
    if r.returncode != 0:
        print(f"  WARNING  Firmware subprocess exited {r.returncode}", file=sys.stderr)
    else:
        print("  Firmware configs -> forge_firmware_configs.json updated")


# ── Group: Troubleshooting ────────────────────────────────────────────────────

def run_troubleshooting(dry_run=False):
    _banner("TROUBLESHOOTING  (community sources)")
    try:
        from mine_troubleshooting import mine_troubleshooting
        _run('Community TS', mine_troubleshooting)
        print("  Community TS  -> forge_troubleshooting.json updated")
    except ImportError as e:
        print(f"  SKIP Troubleshooting: {e}", file=sys.stderr)


# ── Summary ───────────────────────────────────────────────────────────────────

def print_summary():
    _banner("SUMMARY")
    try:
        with open(DB_PATH) as f:
            db = json.load(f)
        total_parts  = sum(len(v) for v in db.get('components', {}).values())
        total_models = len(db.get('drone_models', []))
        total_cats   = len(db.get('components', {}))
        print(f"  forge_database.json  -> {total_parts:,} parts, {total_models} platforms, {total_cats} categories")
    except Exception as e:
        print(f"  forge_database.json  -> (unreadable: {e})")

    try:
        with open(INTEL_PATH) as f:
            intel = json.load(f)
        print(f"  forge_intel.json     -> "
              f"{len(intel.get('funding',[]))} funding, "
              f"{len(intel.get('contracts',[]))} contracts, "
              f"{len(intel.get('grants_awards',[]))} grants")
    except Exception as e:
        print(f"  forge_intel.json     -> (unreadable: {e})")


# ── Entry point ───────────────────────────────────────────────────────────────

ALL_GROUPS = ['intel', 'defense', 'commercial', 'enrichment', 'firmware', 'troubleshooting']

def main():
    parser = argparse.ArgumentParser(description='Forge intelligence pipeline orchestrator')
    parser.add_argument('--group', choices=ALL_GROUPS + ['all'], default='all')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    dry = args.dry_run

    print("╔══════════════════════════════════════════════════════╗")
    print("║          FORGE INTELLIGENCE PIPELINE                ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"  Date:  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Group: {args.group}")
    print(f"  Mode:  {'DRY RUN' if dry else 'LIVE'}")

    run_map = {
        'intel':           lambda: run_intel(dry),
        'defense':         lambda: run_defense(dry),
        'commercial':      lambda: run_commercial(dry),
        'enrichment':      lambda: run_enrichment(dry),
        'firmware':        lambda: run_firmware(dry),
        'troubleshooting': lambda: run_troubleshooting(dry),
    }

    groups = ALL_GROUPS if args.group == 'all' else [args.group]
    for g in groups:
        run_map[g]()

    print_summary()
    print("\nDone.\n")


if __name__ == '__main__':
    main()
