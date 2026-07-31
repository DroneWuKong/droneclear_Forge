#!/usr/bin/env python3
"""Compatibility wrapper for the Ask PIE integration patch.

The original patcher expected the literal marker ``'article mentions'`` with
quote characters, while the generated JavaScript contains ``article mentions``
inside a concatenated string. This wrapper changes only that marker in memory
and delegates every write/check to the original idempotent implementation.

``--check`` remains the explicit no-write, software-only validation path.
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

base.REPLACEMENTS = tuple(
    replace(item, marker="article mentions")
    if item.path == "forge-source/pie-search.html"
    and item.marker == "'article mentions'"
    else item
    for item in base.REPLACEMENTS
)


if __name__ == "__main__":
    raise SystemExit(base.main())
