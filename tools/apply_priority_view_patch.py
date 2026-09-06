#!/usr/bin/env python3
"""Apply or verify the small cross-surface edits for the local Priority View.

The Priority Intelligence Requirement implementation is isolated in new source
files. This helper makes narrow, idempotent edits to the existing site builder,
Patterns hub, public-data worker, quality workflow, and production smoke target.

Use ``--apply`` to write changes and ``--check`` for the software-only/no-write
validation path. No network or physical hardware is required.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Replacement:
    path: str
    marker: str
    old: str
    new: str
    expected_count: int = 1
    expected_marker_count: int = 1
    replace_all: bool = False


PRIORITY_CARD = '''        <a class="product" data-tone="purple" href="/priorities/">
          <span class="product-icon" aria-hidden="true">PIR</span>
          <span><span class="product-title">Priority intelligence view <span class="tag">Local</span></span><span class="product-desc">Rank the current public corpus by declared FPV, compliance, procurement, adversary, C-UAS, DFR, or autonomy terms without hiding the full datasets.</span><span class="product-meta">What matters to my role?</span></span>
          <span class="arrow" aria-hidden="true">›</span>
        </a>
'''


REPLACEMENTS = (
    Replacement(
        'build_static.py',
        "'priorities.html': 'priorities/index.html'",
        "    'patterns-home.html': 'patterns-home/index.html',\n    'tools-home.html': 'tools-home/index.html',",
        "    'patterns-home.html': 'patterns-home/index.html',\n    'priorities.html': 'priorities/index.html',\n    'tools-home.html': 'tools-home/index.html',",
    ),
    Replacement(
        'build_static.py',
        "'priorities.html': (",
        "SEO_META = {\n    'pie-search.html': (",
        """SEO_META = {
    'priorities.html': (
        'Priority Intelligence View — Local PIR Ranking for UAS Patterns',
        'Choose a transparent local-only profile for FPV supply, NDAA and Blue UAS, procurement, adversary systems, counter-UAS, DFR, or autonomy. Declared terms rank current indexed records without hiding the full corpus.',
        'priority intelligence requirements, PIR, UAS intelligence profile, FPV supply chain, NDAA Blue UAS, counter-UAS intelligence',
    ),
    'pie-search.html': (""",
    ),
    Replacement(
        'build_static.py',
        "'priorities/':      'https://uas-patterns.com/priorities/'",
        "    'patterns-home/':  'https://uas-patterns.com/patterns-home/',\n    'clock/':          'https://uas-patterns.com/clock/',",
        "    'patterns-home/':  'https://uas-patterns.com/patterns-home/',\n    'priorities/':      'https://uas-patterns.com/priorities/',\n    'clock/':          'https://uas-patterns.com/clock/',",
    ),
    Replacement(
        'build_static.py',
        '"priorities.html": "patterns"',
        '    "patterns-home.html": "patterns",\n    "pie-trends.html": "patterns",',
        '    "patterns-home.html": "patterns",\n    "priorities.html": "patterns",\n    "pie-trends.html": "patterns",',
    ),
    Replacement(
        'build_static.py',
        'data-page="priorities">Priority View</a>',
        '      <a class="dc-dom-sublink" href="https://uas-patterns.com/patterns-home/" data-page="patterns-home">P.I.E Hub</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/brief/" data-page="brief">Daily Brief</a>',
        '      <a class="dc-dom-sublink" href="https://uas-patterns.com/patterns-home/" data-page="patterns-home">P.I.E Hub</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/priorities/" data-page="priorities">Priority View</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/brief/" data-page="brief">Daily Brief</a>',
    ),
    Replacement(
        'build_static.py',
        "'priorities':'Priority View'",
        "    'patterns-home':'P.I.E Hub','brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',",
        "    'patterns-home':'P.I.E Hub','priorities':'Priority View','brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',",
    ),
    Replacement(
        'forge-source/patterns-home.html',
        '<a href="/priorities/">Priorities</a>',
        '      <a href="#current">Current</a>\n      <a href="#evidence">Evidence</a>',
        '      <a href="/priorities/">Priorities</a>\n      <a href="#current">Current</a>\n      <a href="#evidence">Evidence</a>',
    ),
    Replacement(
        'forge-source/patterns-home.html',
        'Open priority view',
        '          <a class="button primary" href="/brief/">Read the daily brief <span aria-hidden="true">→</span></a>\n          <a class="button" href="/patterns/">Review current signals</a>',
        '          <a class="button primary" href="/brief/">Read the daily brief <span aria-hidden="true">→</span></a>\n          <a class="button" href="/priorities/">Open priority view</a>\n          <a class="button" href="/patterns/">Review current signals</a>',
    ),
    Replacement(
        'forge-source/patterns-home.html',
        'Priority intelligence view <span class="tag">Local</span>',
        '      <div class="product-grid">\n        <a class="product" href="/brief/">',
        '      <div class="product-grid">\n' + PRIORITY_CARD + '        <a class="product" href="/brief/">',
    ),
    Replacement(
        'workers/forge-data.js',
        "['source_coverage_matrix', 72 * 60 * 60 * 1000]",
        "  ['dataset_catalog', 72 * 60 * 60 * 1000],\n]);",
        "  ['dataset_catalog', 72 * 60 * 60 * 1000],\n  ['source_coverage_matrix', 72 * 60 * 60 * 1000],\n]);",
    ),
    Replacement(
        'workers/forge-data.js',
        "  'dataset_catalog',\n  'source_coverage_matrix',\n  'data_quality_score',\n  'intel_articles',",
        "  'dataset_catalog',\n  'intel_articles',",
        "  'dataset_catalog',\n  'source_coverage_matrix',\n  'intel_articles',",
    ),
    Replacement(
        'workers/forge-data.js',
        "  'dataset_catalog',\n  'source_coverage_matrix',\n  'data_quality_score',\n  'solicitations',",
        "  'dataset_catalog',\n  'solicitations',",
        "  'dataset_catalog',\n  'source_coverage_matrix',\n  'solicitations',",
    ),
    Replacement(
        'tools/smoke_public_deployment.py',
        '"source_coverage_matrix",',
        '    "miner_health",\n}',
        '    "miner_health",\n    "source_coverage_matrix",\n}',
    ),
    Replacement(
        'tools/smoke_public_deployment.py',
        '"priority-view",',
        '''        Target(
            "data-quality",
            urljoin(patterns, "miner-health/"),''',
        '''        Target(
            "priority-view",
            urljoin(patterns, "priorities/"),
            (
                "Local-only Priority Intelligence Requirement view",
                "Put the signals you care about first—without hiding the rest.",
                "No LLM participates in the ranking.",
            ),
            ("profile match is proof",),
        ),
        Target(
            "data-quality",
            urljoin(patterns, "miner-health/"),''',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_pir_priority_view.cjs',
        '      - "tests/test_forge_data_projections.mjs"\n      - "build_static.py"',
        '      - "tests/test_forge_data_projections.mjs"\n      - "tests/test_pir_priority_view.cjs"\n      - "build_static.py"',
        expected_count=2,
        expected_marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tools/apply_priority_view_patch.py',
        '      - "tools/apply_record_dossier_patch.py"\n      - "tests/test_public_site_audit.py"',
        '      - "tools/apply_record_dossier_patch.py"\n      - "tools/apply_priority_view_patch.py"\n      - "tests/test_public_site_audit.py"',
        expected_count=2,
        expected_marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_forge_data_projections.mjs \\\n            tests/test_pie_quality_surfaces.cjs \\\n            tests/test_pir_priority_view.cjs',
        '''          node --test tests/test_dossier_signals.cjs tests/test_record_dossiers.cjs tests/test_patterns_decision_support.cjs \\
            tests/test_actor_event_evidence.cjs \\
            tests/test_forge_data_projections.mjs''',
        '''          node --test tests/test_dossier_signals.cjs tests/test_record_dossiers.cjs tests/test_patterns_decision_support.cjs \\
            tests/test_actor_event_evidence.cjs \\
            tests/test_forge_data_projections.mjs \\
            tests/test_pir_priority_view.cjs''',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'node --check forge-source/pir-priority-view.js',
        '''          node --check forge-source/actor-event-evidence.js
          node --check workers/forge-data-projections.mjs''',
        '''          node --check forge-source/actor-event-evidence.js
          node --check forge-source/pir-priority-view.js
          node --check workers/forge-data-projections.mjs''',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'python tools/apply_priority_view_patch.py --check',
        '          python tools/apply_record_dossier_patch.py --check',
        '          python tools/apply_record_dossier_patch.py --check\n          python tools/apply_priority_view_patch.py --check',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'Verify built Priority Intelligence Requirement surface',
        '''      - name: Summary
        if: always()''',
        '''      - name: Verify built Priority Intelligence Requirement surface
        run: |
          test -f build/priorities/index.html
          test -f build/static/pir-priority-view.js
          test -f build/static/pir_profiles.json
          grep -F "Local-only Priority Intelligence Requirement view" build/priorities/index.html
          grep -F "without hiding the rest" build/priorities/index.html
          grep -F "No LLM participates in the ranking" build/priorities/index.html
          grep -F "source_coverage_matrix" workers/forge-data.js

      - name: Summary
        if: always()''',
    ),
)


def apply_one(root: Path, replacement: Replacement, apply: bool) -> str:
    path = root / replacement.path
    if not path.exists():
        raise RuntimeError(f'missing file: {replacement.path}')
    current = path.read_text(encoding='utf-8')
    marker_count = current.count(replacement.marker)
    if marker_count >= replacement.expected_marker_count:
        return 'present'
    if not apply:
        raise RuntimeError(
            f'{replacement.path}: required marker missing or incomplete: '
            f'{replacement.marker!r} ({marker_count}/{replacement.expected_marker_count})'
        )
    anchor_count = current.count(replacement.old)
    if anchor_count != replacement.expected_count:
        raise RuntimeError(
            f'{replacement.path}: expected {replacement.expected_count} anchor(s) '
            f'for {replacement.marker!r}; found {anchor_count}'
        )
    updated = current.replace(replacement.old, replacement.new) if replacement.replace_all else current.replace(replacement.old, replacement.new, 1)
    if updated.count(replacement.marker) < replacement.expected_marker_count:
        raise RuntimeError(f'{replacement.path}: patch did not create {replacement.marker!r}')
    path.write_text(updated, encoding='utf-8')
    return 'applied'


def run(root: Path, apply: bool) -> list[str]:
    return [f'{replacement.path}: {apply_one(root, replacement, apply)} — {replacement.marker}' for replacement in REPLACEMENTS]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true', help='write the idempotent cross-surface edits')
    mode.add_argument('--check', action='store_true', help='verify every edit without writing')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        results = run(args.root.resolve(), apply=args.apply)
    except RuntimeError as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    for result in results:
        print(result)
    print('Priority View cross-surface patch: PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
