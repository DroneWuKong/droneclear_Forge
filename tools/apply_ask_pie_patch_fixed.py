#!/usr/bin/env python3
"""Compatibility wrapper for the Ask PIE integration patch.

The original patcher used two pre-final markers:

* a quoted ``'article mentions'`` token that is not present in the generated
  JavaScript concatenation; and
* the original patcher command rather than this corrected no-write wrapper.

This module changes only those marker expectations in memory and delegates all
writes/checks to the original idempotent implementation. ``--check`` remains the
explicit no-write, software-only validation path.
"""
from __future__ import annotations

import importlib.util
import sys
from dataclasses import replace
from pathlib import Path

BASE_PATH = Path(__file__).with_name("apply_ask_pie_patch.py")
SPEC = importlib.util.spec_from_file_location("apply_ask_pie_patch_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise SystemExit(f"ERROR: unable to load {BASE_PATH}")
base = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = base
SPEC.loader.exec_module(base)


def adjusted(item):
    if (
        item.path == "forge-source/pie-search.html"
        and item.marker == "'article mentions'"
    ):
        return replace(item, marker="article mentions")
    if (
        item.path == ".github/workflows/public-site-quality.yml"
        and item.marker == "python tools/apply_ask_pie_patch.py --check"
    ):
        return replace(
            item,
            marker="python tools/apply_ask_pie_patch_fixed.py --check",
        )
    return item


base.REPLACEMENTS = tuple(adjusted(item) for item in base.REPLACEMENTS)


if __name__ == "__main__":
    raise SystemExit(base.main())
