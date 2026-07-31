#!/usr/bin/env python3
"""Make Ask PIE multiword terms punctuation-tolerant.

The matcher normalized profile/query terms but required literal whitespace
between their words, so ``Blue UAS`` did not match ``Blue-UAS``. ``--apply``
performs the one idempotent source edit; ``--check`` is the no-write path.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "forge-source" / "ask-pie-retrieval.js"
OLD = "const body = value.split(' ').map(escapeRegex).join('\\\\s+');"
NEW = "const body = value.split(' ').map(escapeRegex).join('[^a-z0-9]+');"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()

    current = TARGET.read_text(encoding="utf-8")
    if NEW in current:
        print("Ask PIE punctuation-tolerant term matcher: PASS")
        return 0
    if args.check:
        print("ERROR: punctuation-tolerant term matcher is not applied", file=sys.stderr)
        return 1
    if current.count(OLD) != 1:
        print(
            f"ERROR: expected one term-pattern anchor; found {current.count(OLD)}",
            file=sys.stderr,
        )
        return 1
    TARGET.write_text(current.replace(OLD, NEW, 1), encoding="utf-8")
    print("Ask PIE punctuation-tolerant term matcher: APPLIED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
