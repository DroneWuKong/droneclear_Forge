#!/usr/bin/env python3
"""Apply or verify the cross-surface integration for cited Ask PIE retrieval.

``--apply`` performs narrow, idempotent edits. ``--check`` is the explicit
software-only/no-write validation path. The patch has no network or hardware
requirements.
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
    marker_count: int = 1
    replace_all: bool = False


ASK_CARD = '''        <a class="product" data-tone="purple" href="/ask-pie/">
          <span class="product-icon" aria-hidden="true">ASK</span>
          <span><span class="product-title">Ask PIE <span class="tag">Cited retrieval</span></span><span class="product-desc">Turn a question into a deterministic evidence packet with source links, dates, match reasons, coverage, and limitations—without a generated conclusion.</span><span class="product-meta">What does the indexed evidence show?</span></span>
          <span class="arrow" aria-hidden="true">›</span>
        </a>
'''

REPLACEMENTS = (
    Replacement(
        'build_static.py',
        "'ask-pie.html': 'ask-pie/index.html'",
        "    'priorities.html': 'priorities/index.html',\n    'tools-home.html': 'tools-home/index.html',",
        "    'priorities.html': 'priorities/index.html',\n    'ask-pie.html': 'ask-pie/index.html',\n    'tools-home.html': 'tools-home/index.html',",
    ),
    Replacement(
        'build_static.py',
        "'ask-pie.html': (",
        "    'pie-search.html': (\n        'PIE Search — Flags, Predictions, Actors, Entities & Intel',",
        """    'ask-pie.html': (
        'Ask PIE — Cited UAS Evidence Retrieval',
        'Ask a UAS question and receive a deterministic evidence packet with source citations, dates, match reasons, collection coverage, and limitations. No generated conclusion.',
        'cited UAS evidence, Ask PIE, drone intelligence sources, public source UAS research, evidence retrieval, drone supply chain citations',
    ),
    'pie-search.html': (
        'PIE Search — Flags, Predictions, Actors, Entities & Intel',""",
    ),
    Replacement(
        'build_static.py',
        "'ask-pie/':       'https://uas-patterns.com/ask-pie/'",
        "    'priorities/':      'https://uas-patterns.com/priorities/',\n    'clock/':          'https://uas-patterns.com/clock/',",
        "    'priorities/':      'https://uas-patterns.com/priorities/',\n    'ask-pie/':       'https://uas-patterns.com/ask-pie/',\n    'clock/':          'https://uas-patterns.com/clock/',",
    ),
    Replacement(
        'build_static.py',
        '"ask-pie.html": "patterns"',
        '    "priorities.html": "patterns",\n    "pie-trends.html": "patterns",',
        '    "priorities.html": "patterns",\n    "ask-pie.html": "patterns",\n    "pie-trends.html": "patterns",',
    ),
    Replacement(
        'build_static.py',
        'data-page="ask-pie">Ask PIE</a>',
        '      <a class="dc-dom-sublink" href="https://uas-patterns.com/priorities/" data-page="priorities">Priority View</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/brief/" data-page="brief">Daily Brief</a>',
        '      <a class="dc-dom-sublink" href="https://uas-patterns.com/priorities/" data-page="priorities">Priority View</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/ask-pie/" data-page="ask-pie">Ask PIE</a>\n      <a class="dc-dom-sublink" href="https://uas-patterns.com/brief/" data-page="brief">Daily Brief</a>',
    ),
    Replacement(
        'build_static.py',
        "'ask-pie':'Ask PIE'",
        "    'patterns-home':'P.I.E Hub','priorities':'Priority View','brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',",
        "    'patterns-home':'P.I.E Hub','priorities':'Priority View','ask-pie':'Ask PIE','brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',",
    ),
    Replacement(
        'forge-source/patterns-home.html',
        '<a href="/ask-pie/">Ask PIE</a>',
        '      <a href="/priorities/">Priorities</a>\n      <a href="#current">Current</a>',
        '      <a href="/priorities/">Priorities</a>\n      <a href="/ask-pie/">Ask PIE</a>\n      <a href="#current">Current</a>',
    ),
    Replacement(
        'forge-source/patterns-home.html',
        'Build cited evidence packet',
        '          <a class="button primary" href="/brief/">Read the daily brief <span aria-hidden="true">→</span></a>\n          <a class="button" href="/priorities/">Open priority view</a>',
        '          <a class="button primary" href="/brief/">Read the daily brief <span aria-hidden="true">→</span></a>\n          <a class="button" href="/ask-pie/">Build cited evidence packet</a>\n          <a class="button" href="/priorities/">Open priority view</a>',
    ),
    Replacement(
        'forge-source/patterns-home.html',
        'Ask PIE <span class="tag">Cited retrieval</span>',
        '        <a class="product" data-tone="amber" href="/pie-search/">\n          <span class="product-icon" aria-hidden="true">SRC</span>',
        ASK_CARD + '        <a class="product" data-tone="amber" href="/pie-search/">\n          <span class="product-icon" aria-hidden="true">SRC</span>',
    ),
    Replacement(
        'forge-source/patterns-home.html',
        'Raw corpus search',
        '<span><span class="product-title">Global evidence search</span><span class="product-desc">Search indexed flags, actors, entities, predictions, and public reporting from one surface.</span><span class="product-meta">Show me the supporting record.</span></span>',
        '<span><span class="product-title">Raw corpus search</span><span class="product-desc">Search indexed flags, actors, entities, predictions, and public reporting without an evidence-packet interpretation layer.</span><span class="product-meta">Show every literal match.</span></span>',
    ),
    Replacement(
        'forge-source/pie-search.html',
        'Use <a href="/ask-pie/">Ask PIE</a> for a cited evidence packet',
        '    Multi-term AND match, case-insensitive, indexed client-side on load.\n  </p>',
        '    Multi-term AND match, case-insensitive, indexed client-side on load.\n    Use <a href="/ask-pie/">Ask PIE</a> for a cited evidence packet with match reasons, coverage, and limitations.\n  </p>',
    ),
    Replacement(
        'forge-source/pie-search.html',
        "'article mentions'",
        "    var sub = 'threat ' + (a.threat_score != null ? Number(a.threat_score).toFixed(2) : '—')\n      + ' · ' + esc(a.incident_count != null ? a.incident_count : '?') + ' incidents'",
        "    var sub = 'activity/exposure ' + (a.threat_score != null ? Number(a.threat_score).toFixed(2) : '—')\n      + ' · ' + esc(a.article_mention_count != null ? a.article_mention_count : (a.incident_count != null ? a.incident_count : '?')) + ' article mentions'",
    ),
    Replacement(
        'tools/smoke_public_deployment.py',
        '"ask-pie",',
        '''        Target(
            "data-quality",
            urljoin(patterns, "miner-health/"),''',
        '''        Target(
            "ask-pie",
            urljoin(patterns, "ask-pie/"),
            (
                "Cited retrieval · no generated conclusion",
                "Ask PIE for the evidence—not a confident-sounding answer.",
                "No LLM writes the answer or changes the ranking.",
            ),
            ("automatic conclusion", "incident count"),
        ),
        Target(
            "data-quality",
            urljoin(patterns, "miner-health/"),''',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_ask_pie_retrieval.cjs',
        '      - "tests/test_pir_priority_view.cjs"\n      - "build_static.py"',
        '      - "tests/test_pir_priority_view.cjs"\n      - "tests/test_ask_pie_retrieval.cjs"\n      - "build_static.py"',
        expected_count=2,
        marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tools/apply_ask_pie_patch.py',
        '      - "tools/apply_priority_view_patch.py"\n      - "tests/test_public_site_audit.py"',
        '      - "tools/apply_priority_view_patch.py"\n      - "tools/apply_ask_pie_patch.py"\n      - "tests/test_public_site_audit.py"',
        expected_count=2,
        marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_pir_priority_view.cjs \\\n            tests/test_ask_pie_retrieval.cjs',
        '            tests/test_forge_data_projections.mjs \\\n            tests/test_pir_priority_view.cjs',
        '            tests/test_forge_data_projections.mjs \\\n            tests/test_pir_priority_view.cjs \\\n            tests/test_ask_pie_retrieval.cjs',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'node --check forge-source/ask-pie-retrieval.js',
        '          node --check forge-source/pir-priority-view.js\n          node --check workers/forge-data-projections.mjs',
        '          node --check forge-source/pir-priority-view.js\n          node --check forge-source/ask-pie-retrieval.js\n          node --check workers/forge-data-projections.mjs',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'python tools/apply_ask_pie_patch.py --check',
        '          python tools/apply_priority_view_patch.py --check',
        '          python tools/apply_priority_view_patch.py --check\n          python tools/apply_ask_pie_patch.py --check',
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'Verify built cited Ask PIE surface',
        '''      - name: Summary
        if: always()''',
        '''      - name: Verify built cited Ask PIE surface
        run: |
          test -f build/ask-pie/index.html
          test -f build/static/ask-pie-retrieval.js
          grep -F "Cited retrieval · no generated conclusion" build/ask-pie/index.html
          grep -F "Ask PIE for the evidence—not a confident-sounding answer." build/ask-pie/index.html
          grep -F "No LLM writes the answer or changes the ranking." build/ask-pie/index.html
          grep -F "Ask PIE" build/patterns-home/index.html

      - name: Summary
        if: always()''',
    ),
)


def apply_one(root: Path, replacement: Replacement, apply: bool) -> str:
    path = root / replacement.path
    if not path.exists():
        raise RuntimeError(f'missing file: {replacement.path}')
    current = path.read_text(encoding='utf-8')
    present = current.count(replacement.marker)
    if present >= replacement.marker_count:
        return 'present'
    if not apply:
        raise RuntimeError(
            f'{replacement.path}: required marker missing or incomplete: '
            f'{replacement.marker!r} ({present}/{replacement.marker_count})'
        )
    count = current.count(replacement.old)
    if count != replacement.expected_count:
        raise RuntimeError(
            f'{replacement.path}: expected {replacement.expected_count} anchor(s) '
            f'for {replacement.marker!r}; found {count}'
        )
    updated = current.replace(replacement.old, replacement.new) if replacement.replace_all else current.replace(replacement.old, replacement.new, 1)
    if updated.count(replacement.marker) < replacement.marker_count:
        raise RuntimeError(f'{replacement.path}: patch did not create {replacement.marker!r}')
    path.write_text(updated, encoding='utf-8')
    return 'applied'


def run(root: Path, apply: bool) -> list[str]:
    return [f'{item.path}: {apply_one(root, item, apply)} — {item.marker}' for item in REPLACEMENTS]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        results = run(args.root.resolve(), apply=args.apply)
    except RuntimeError as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    for result in results:
        print(result)
    print('Ask PIE cross-surface patch: PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
