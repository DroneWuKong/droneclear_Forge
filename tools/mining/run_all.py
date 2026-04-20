"""
Forge mining orchestrator.

Runs each miner in sequence, then runs each normalizer to produce the
forge_*.json files consumed by the DCV static site.

Usage:
    python tools/mining/run_all.py                 # run all miners + normalizers
    python tools/mining/run_all.py --miner rotorbuilds
    python tools/mining/run_all.py --dry           # miners only, skip normalizers
    python tools/mining/run_all.py --max 25        # cap records per miner

Env vars:
    SAM_GOV_API_KEY    — required for sam_gov miner
    FORGE_MINE_UA      — optional override for user-agent

All miners respect robots.txt by default. To override (DO NOT use in CI or
unattended runs), set FORGE_MINE_RESPECT_ROBOTS=0.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

# Allow importing `mining.*` when run as `python tools/mining/run_all.py`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mining.miners.rotorbuilds import RotorBuildsMiner
from mining.miners.ardupilot_discourse import ArduPilotDiscourseMiner
from mining.miners.blue_uas import BlueUASMiner
from mining.miners.sam_gov import SamGovMiner
from mining.miners.mine_pilotinstitute import PilotInstituteMiner
from mining.miners.diyfpv_catalog import DiyfpvCatalogMiner


MINERS = {
    "rotorbuilds": RotorBuildsMiner,
    "ardupilot_discourse": ArduPilotDiscourseMiner,
    "blue_uas": BlueUASMiner,
    "sam_gov": SamGovMiner,
    "pilotinstitute": PilotInstituteMiner,
    "diyfpv_catalog": DiyfpvCatalogMiner,
}


def run_miners(selected: list[str], max_records: int | None):
    for name in selected:
        cls = MINERS[name]
        cfg = cls.default_config()
        if os.environ.get("FORGE_MINE_RESPECT_ROBOTS") == "0":
            cfg.respect_robots = False
        miner = cls(cfg)
        t0 = time.monotonic()
        try:
            records = miner.run(max_records=max_records)
            print(f"[{name}] {len(records)} records in {time.monotonic() - t0:.1f}s")
        except Exception as e:
            print(f"[{name}] FAILED: {type(e).__name__}: {e}")


def run_normalizers():
    # Import and run each normalizer. Keep them simple — one function per file.
    try:
        from mining.normalizers import aggregate_cooccurrence
        aggregate_cooccurrence.main()
    except Exception as e:
        print(f"[normalizer:aggregate_cooccurrence] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import ardupilot_to_cooccurrence
        ardupilot_to_cooccurrence.main()
    except Exception as e:
        print(f"[normalizer:ardupilot_to_cooccurrence] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import sam_gov_to_solicitations
        sam_gov_to_solicitations.main()
    except Exception as e:
        print(f"[normalizer:sam_gov_to_solicitations] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import diyfpv_to_prices
        diyfpv_to_prices.main()
    except Exception as e:
        print(f"[normalizer:diyfpv_to_prices] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import blue_uas_to_cleared
        blue_uas_to_cleared.main()
    except Exception as e:
        print(f"[normalizer:blue_uas_to_cleared] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import parts_canonical
        parts_canonical.main()
    except Exception as e:
        print(f"[normalizer:parts_canonical] FAILED: {type(e).__name__}: {e}")

    try:
        from mining.normalizers import platform_cooccurrence
        platform_cooccurrence.main()
    except Exception as e:
        print(f"[normalizer:platform_cooccurrence] FAILED: {type(e).__name__}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--miner", choices=list(MINERS.keys()),
                    help="Run only this miner. Default: all.")
    ap.add_argument("--dry", action="store_true",
                    help="Miners only; skip normalizers.")
    ap.add_argument("--max", type=int, default=50,
                    help="Max records per miner (default 50 — scaffolding safety).")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    selected = [args.miner] if args.miner else list(MINERS.keys())
    run_miners(selected, args.max)
    if not args.dry:
        run_normalizers()


if __name__ == "__main__":
    main()
