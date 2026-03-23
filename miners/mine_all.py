#!/usr/bin/env python3
"""
mine_all.py — Run all Forge intel miners and merge results into forge_intel.json.

Usage:
    python3 miners/mine_all.py              # Run all miners
    python3 miners/mine_all.py --dry-run    # Preview without writing
"""

import json
import os
import sys
from datetime import datetime

# Resolve paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
INTEL_PATH = os.path.join(REPO_ROOT, 'DroneClear Components Visualizer', 'forge_intel.json')

# Import miners
sys.path.insert(0, SCRIPT_DIR)


def dedup_funding(existing, new_entries):
    """Deduplicate funding entries by company+type."""
    seen = set()
    for e in existing:
        key = (e.get('company', '').lower(), e.get('type', '').lower())
        seen.add(key)
    
    added = []
    for e in new_entries:
        key = (e.get('company', '').lower(), e.get('type', '').lower())
        if key not in seen:
            seen.add(key)
            added.append(e)
    
    return added


def dedup_contracts(existing, new_entries):
    """Deduplicate contracts by program+awardee."""
    seen = set()
    for e in existing:
        key = (e.get('program', '').lower()[:40], e.get('awardee', '').lower())
        seen.add(key)
    
    added = []
    for e in new_entries:
        key = (e.get('program', '').lower()[:40], e.get('awardee', '').lower())
        if key not in seen:
            seen.add(key)
            added.append(e)
    
    return added


def dedup_grants(existing, new_entries):
    """Deduplicate grants/awards by program name."""
    seen = set(e.get('program', '').lower()[:40] for e in existing)
    
    added = []
    for e in new_entries:
        key = e.get('program', '').lower()[:40]
        if key not in seen:
            seen.add(key)
            added.append(e)
    
    return added


def run_all_miners():
    """Execute all miners and collect results."""
    results = {
        'funding': [],
        'contracts': [],
        'grants_awards': [],
        'blue_uas': None,
    }
    
    # 1. DRONELIFE
    try:
        from mine_dronelife import mine_dronelife, articles_to_intel
        print("\n" + "=" * 50)
        print("DRONELIFE MINER")
        print("=" * 50)
        articles = mine_dronelife()
        funding, contracts, regulatory = articles_to_intel(articles)
        results['funding'].extend(funding)
        results['contracts'].extend(contracts)
        results['grants_awards'].extend(regulatory)
        print(f"  → {len(funding)} funding, {len(contracts)} contracts, {len(regulatory)} regulatory")
    except Exception as e:
        print(f"  DRONELIFE miner failed: {e}", file=sys.stderr)
    
    # 2. SBIR
    try:
        from mine_sbir import mine_sbir
        print("\n" + "=" * 50)
        print("SBIR.GOV MINER")
        print("=" * 50)
        sbir_contracts = mine_sbir()
        results['contracts'].extend(sbir_contracts)
        print(f"  → {len(sbir_contracts)} SBIR awards")
    except Exception as e:
        print(f"  SBIR miner failed: {e}", file=sys.stderr)
    
    # 3. Blue UAS
    try:
        from mine_blueuas import mine_blueuas
        print("\n" + "=" * 50)
        print("BLUE UAS MINER")
        print("=" * 50)
        blue_data = mine_blueuas()
        results['blue_uas'] = blue_data
        print(f"  → {blue_data['total_platforms']} platforms, {blue_data['total_framework']} framework components")
    except Exception as e:
        print(f"  Blue UAS miner failed: {e}", file=sys.stderr)
    
    return results


def merge_and_save(results, dry_run=False):
    """Merge mined results into existing forge_intel.json."""
    # Load existing
    if os.path.exists(INTEL_PATH):
        with open(INTEL_PATH) as f:
            intel = json.load(f)
    else:
        intel = {
            'meta': {'last_updated': '', 'sources': [], 'version': 1},
            'funding': [],
            'contracts': [],
            'grants_awards': [],
            'commercial_sources': [],
        }
    
    # Merge with deduplication
    new_funding = dedup_funding(intel.get('funding', []), results['funding'])
    new_contracts = dedup_contracts(intel.get('contracts', []), results['contracts'])
    new_grants = dedup_grants(intel.get('grants_awards', []), results['grants_awards'])
    
    print(f"\n{'=' * 50}")
    print("MERGE RESULTS")
    print(f"{'=' * 50}")
    print(f"  New funding entries: {len(new_funding)}")
    print(f"  New contract entries: {len(new_contracts)}")
    print(f"  New grant/award entries: {len(new_grants)}")
    
    if new_funding:
        intel['funding'].extend(new_funding)
    if new_contracts:
        intel['contracts'].extend(new_contracts)
    if new_grants:
        intel['grants_awards'].extend(new_grants)
    
    # Update Blue UAS data
    if results.get('blue_uas'):
        intel['blue_uas'] = results['blue_uas']
    
    # Update metadata
    intel['meta']['last_updated'] = datetime.utcnow().strftime('%Y-%m-%d')
    intel['meta']['version'] = intel['meta'].get('version', 0) + 1
    
    total = len(intel.get('funding', [])) + len(intel.get('contracts', [])) + len(intel.get('grants_awards', []))
    print(f"\n  Total intel entries: {total}")
    print(f"  Funding: {len(intel.get('funding', []))}")
    print(f"  Contracts: {len(intel.get('contracts', []))}")
    print(f"  Grants: {len(intel.get('grants_awards', []))}")
    
    if dry_run:
        print("\n  DRY RUN — not writing to disk")
        return intel
    
    # Write
    with open(INTEL_PATH, 'w') as f:
        json.dump(intel, f, indent=2)
    print(f"\n  Written to {INTEL_PATH}")
    
    return intel


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    
    print("╔══════════════════════════════════════╗")
    print("║   FORGE INTEL MINER — mine_all.py   ║")
    print("╚══════════════════════════════════════╝")
    print(f"  Date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    
    results = run_all_miners()
    intel = merge_and_save(results, dry_run=dry_run)
    
    print("\nDone.")
