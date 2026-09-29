#!/usr/bin/env python3
"""Append an explicit, content-bound private relationship review (no network)."""
import argparse
import json
from pathlib import Path

from private_evidence import REVIEWS_PATH, build_evidence, read_json, valid_date


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream-dir', type=Path, required=True)
    parser.add_argument('--upstream-ref', required=True)
    parser.add_argument('--record-id', required=True)
    parser.add_argument('--status', choices=['supported', 'not_supported', 'disputed', 'rejected', 'superseded'], required=True)
    parser.add_argument('--reviewer', required=True)
    parser.add_argument('--reviewed-on', required=True)
    parser.add_argument('--rationale', required=True)
    parser.add_argument('--expected-fingerprint', required=True, help='Fingerprint from the reviewed export; rejects changed evidence')
    args = parser.parse_args()
    payload = build_evidence(args.upstream_dir, args.upstream_ref)
    row = next((r for r in payload['relationships'] if r['id'] == args.record_id), None)
    if not row or row['fingerprint'] != args.expected_fingerprint:
        parser.error('Record missing or evidence changed; export and inspect it again')
    if row['review_gaps']:
        parser.error('Repair source provenance before recording a review')
    if not valid_date(args.reviewed_on) or not args.reviewer.strip() or not args.rationale.strip():
        parser.error('A valid ISO date, reviewer and rationale are required')
    if args.status == 'supported' and not any(e.get('supports') == 'claim' for e in row['evidence']):
        parser.error('Source-supported review requires a primary source attributed to this claim')
    path = args.upstream_dir / REVIEWS_PATH
    ledger = read_json(path, {'schema_version': 1, 'reviews': []})
    ledger['reviews'].append({'record_id': row['id'], 'fingerprint': row['fingerprint'],
        'status': args.status, 'reviewed_on': args.reviewed_on, 'reviewer': args.reviewer,
        'rationale': args.rationale, 'review_type': 'source_checked',
        'sequence': len(ledger['reviews']) + 1})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Recorded {args.status} review for {row["id"]}')


if __name__ == '__main__':
    main()
