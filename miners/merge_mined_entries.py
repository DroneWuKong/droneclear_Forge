#!/usr/bin/env python3
"""
merge_mined_entries.py — Merge reviewed mined entries into forge_troubleshooting.json

After mine_from_analytics.py generates entries and you review/edit them,
run this to merge approved entries into the live troubleshooting DB.

Usage:
    # Merge a specific mined entries file
    python3 miners/merge_mined_entries.py miners/.analytics_output/mined_entries_20260325.json

    # Merge and also accept Wingman user-exported troubleshooting entries
    python3 miners/merge_mined_entries.py wingman_troubleshooting_export_2026-03-25.json

    # Dry run
    python3 miners/merge_mined_entries.py mined_entries.json --dry-run

    # Auto-approve all entries (skip review prompts)
    python3 miners/merge_mined_entries.py mined_entries.json --auto
"""

import json
import os
import sys
from datetime import datetime

TS_DB_PATH = os.path.join(os.path.dirname(__file__), '..',
    'DroneClear Components Visualizer', 'forge_troubleshooting.json')


def load_ts_db():
    if not os.path.exists(TS_DB_PATH):
        return {'meta': {}, 'entries': []}
    with open(TS_DB_PATH) as f:
        return json.load(f)


def save_ts_db(db):
    db['meta']['last_updated'] = datetime.now().isoformat()
    db['meta']['entry_count'] = len(db['entries'])
    with open(TS_DB_PATH, 'w') as f:
        json.dump(db, f, indent=2)


def deduplicate(existing, new_entry):
    """Check if a similar entry already exists."""
    new_title = new_entry.get('title', '').lower().strip()
    for e in existing:
        existing_title = e.get('title', '').lower().strip()
        # Exact title match
        if new_title == existing_title:
            return True
        # Fuzzy: >70% word overlap
        new_words = set(new_title.split())
        existing_words = set(existing_title.split())
        if new_words and existing_words:
            overlap = len(new_words & existing_words) / max(len(new_words), len(existing_words))
            if overlap > 0.7:
                return True
    return False


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 merge_mined_entries.py <entries_file.json> [--dry-run] [--auto]')
        sys.exit(1)
    
    input_path = sys.argv[1]
    dry_run = '--dry-run' in sys.argv
    auto_approve = '--auto' in sys.argv
    
    if not os.path.exists(input_path):
        print(f'File not found: {input_path}')
        sys.exit(1)
    
    with open(input_path) as f:
        data = json.load(f)
    
    # Handle both formats: {entries: [...]} and [{...}, {...}]
    if isinstance(data, list):
        entries = data
    else:
        entries = data.get('entries', [])
    
    print(f'═══ MERGE MINED ENTRIES ═══\n')
    print(f'  Input: {input_path}')
    print(f'  Entries to review: {len(entries)}')
    print(f'  Mode: {"DRY RUN" if dry_run else "AUTO" if auto_approve else "INTERACTIVE"}')
    
    db = load_ts_db()
    existing = db.get('entries', [])
    print(f'  Existing TS entries: {len(existing)}')
    
    added = 0
    skipped_dupe = 0
    skipped_rejected = 0
    
    for i, entry in enumerate(entries):
        title = entry.get('title', 'Untitled')[:80]
        cat = entry.get('category', 'general')
        source = entry.get('source', {}).get('source_name', 'unknown')
        
        # Check for duplicates
        if deduplicate(existing, entry):
            print(f'  [{i+1}/{len(entries)}] SKIP (duplicate): {title}')
            skipped_dupe += 1
            continue
        
        if not auto_approve and not dry_run:
            print(f'\n  [{i+1}/{len(entries)}] Category: {cat} | Source: {source}')
            print(f'  Title: {title}')
            if entry.get('symptoms'):
                print(f'  Symptoms: {entry["symptoms"][:2]}')
            if entry.get('fixes'):
                print(f'  Fixes: {entry["fixes"][:2]}')
            resp = input('  Accept? (y/n/q): ').strip().lower()
            if resp == 'q':
                break
            if resp != 'y':
                skipped_rejected += 1
                continue
        
        if dry_run:
            print(f'  [{i+1}/{len(entries)}] WOULD ADD: [{cat}] {title}')
            added += 1
            continue
        
        # Assign a proper ID
        max_id = 0
        for e in existing:
            eid = e.get('id', '')
            m = None
            try:
                num = int(eid.split('-')[-1])
                if num > max_id:
                    max_id = num
            except (ValueError, IndexError):
                pass
        entry['id'] = f'TS-{max_id + added + 1:03d}'
        entry['status'] = 'active'
        entry['merged_at'] = datetime.now().isoformat()
        
        existing.append(entry)
        added += 1
        print(f'  [{i+1}/{len(entries)}] ADDED: [{cat}] {title} → {entry["id"]}')
    
    if not dry_run and added > 0:
        db['entries'] = existing
        save_ts_db(db)
        print(f'\n  ✓ Saved {added} new entries to {TS_DB_PATH}')
    
    print(f'\n  Summary: {added} added, {skipped_dupe} duplicates, {skipped_rejected} rejected')
    if dry_run:
        print('  (dry run — nothing was saved)')


if __name__ == '__main__':
    main()
