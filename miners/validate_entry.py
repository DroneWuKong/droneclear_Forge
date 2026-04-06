#!/usr/bin/env python3
"""
validate_entry.py — Quality gate for all mined data entering Forge.

Every miner must pass entries through validate_part() or validate_intel()
before writing to forge_database.json or forge_intel.json.

Rejects garbage names, duplicates, and incomplete records so users
only see data that meets Forge standards.
"""

import re

# ── Part validation ──────────────────────────────────────────────────

# Names that are too generic to be useful
GARBAGE_NAMES = {
    '', 'vtx', 'vtx sma', 'esc', 'fc', 'motor', 'frame', 'camera',
    'receiver', 'antenna', 'propeller', 'battery', 'gps', 'stack',
    'unknown', 'n/a', 'tbd', 'test', 'none',
}

MIN_NAME_LENGTH = 4


def validate_part(entry: dict) -> tuple[bool, str]:
    """Validate a single part entry before DB insertion.

    Returns:
        (True, '') if valid
        (False, reason) if rejected
    """
    name = entry.get('name', '').strip()

    # Must have a real name
    if not name:
        return False, 'empty name'
    if name.lower() in GARBAGE_NAMES:
        return False, f'generic/garbage name: "{name}"'
    if len(name) < MIN_NAME_LENGTH:
        return False, f'name too short ({len(name)} chars): "{name}"'

    # Must have a manufacturer
    mfr = entry.get('manufacturer', '').strip()
    if not mfr:
        return False, 'missing manufacturer'

    # Must have a category
    if not entry.get('category', '').strip():
        return False, 'missing category'

    # PID must look reasonable if present
    pid = entry.get('pid', '')
    if pid and len(pid) < 4:
        return False, f'malformed pid: "{pid}"'

    return True, ''


def validate_parts_batch(entries: list[dict]) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Validate a batch. Returns (accepted, rejected_with_reasons)."""
    accepted = []
    rejected = []
    for entry in entries:
        ok, reason = validate_part(entry)
        if ok:
            accepted.append(entry)
        else:
            rejected.append((entry, reason))
    return accepted, rejected


def dedup_parts(existing: list[dict], new_entries: list[dict]) -> list[dict]:
    """Return only entries from new_entries that don't duplicate existing by name+manufacturer."""
    seen = set()
    for p in existing:
        key = (p.get('name', '').lower().strip(), p.get('manufacturer', '').lower().strip())
        seen.add(key)

    unique = []
    for p in new_entries:
        key = (p.get('name', '').lower().strip(), p.get('manufacturer', '').lower().strip())
        if key not in seen:
            seen.add(key)
            unique.append(p)

    return unique


# ── Intel validation ─────────────────────────────────────────────────

def validate_intel_entry(entry: dict, section: str) -> tuple[bool, str]:
    """Validate an intel entry (funding/contract/grant).

    Returns:
        (True, '') if valid
        (False, reason) if rejected
    """
    if not isinstance(entry, dict):
        return False, 'not a dict'

    # Must have at least one string field with meaningful content
    text_vals = [str(v).strip() for v in entry.values() if isinstance(v, str)]
    if not any(len(v) > 3 for v in text_vals):
        return False, 'no meaningful text content'

    # Section-specific checks
    if section == 'funding':
        if not entry.get('company', '').strip():
            return False, 'funding entry missing company'
    elif section == 'contracts':
        if not entry.get('program', '').strip() and not entry.get('awardee', '').strip():
            return False, 'contract missing program and awardee'

    return True, ''


# ── CLI: run validation on existing DB ───────────────────────────────

if __name__ == '__main__':
    import json
    import os
    import sys

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(repo_root, 'DroneClear Components Visualizer', 'forge_database.json')

    with open(db_path) as f:
        db = json.load(f)

    total_issues = 0
    for cat, parts in db.get('components', {}).items():
        if not isinstance(parts, list):
            continue
        for p in parts:
            p_copy = dict(p)
            p_copy.setdefault('category', cat)
            ok, reason = validate_part(p_copy)
            if not ok:
                total_issues += 1
                print(f'  FAIL [{cat}] "{p.get("name","")}" — {reason}')

    if total_issues:
        print(f'\n{total_issues} entries would be rejected by the quality gate.')
        sys.exit(1)
    else:
        print('All entries pass validation.')
        sys.exit(0)
