#!/usr/bin/env python3
"""format_gap_summary.py — Print gap analysis summary for GitHub Actions step summary."""
import json
import sys

if len(sys.argv) < 2:
    print("Usage: python3 format_gap_summary.py <gap_analysis.json>")
    sys.exit(1)

with open(sys.argv[1]) as f:
    data = json.load(f)

print(f"Total queries: {data.get('total_queries', 0)}")
print(f"Total sessions: {data.get('total_sessions', 0)}")
print()
for g in data.get('gaps', [])[:10]:
    print(f"{g['category']:<15} queries={g['queries']:<6} ts_entries={g['ts_entries']:<4} gap={g['gap_score']:<8} {g['priority']}")
