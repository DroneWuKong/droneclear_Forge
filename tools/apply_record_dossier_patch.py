#!/usr/bin/env python3
"""Apply or verify the small cross-surface links for record dossiers.

The component/platform dossier implementation is isolated in
``forge-source/record-dossiers.js``. This helper performs the narrow, audited
edits needed to load it from the existing dossier route and link existing Forge
and Patterns surfaces to exact records.

Use ``--apply`` to make the idempotent edits and ``--check`` for the software-
only/no-write validation path used in CI.
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


LOADER = r'''

/* data-record-dossier-loader: query-scoped component/platform dossier UI. */
(function () {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (!params.get('component') && !params.get('platform')) return;
  if (document.querySelector('script[data-record-dossier-loader]')) return;
  const script = document.createElement('script');
  script.src = '/static/record-dossiers.js';
  script.async = false;
  script.dataset.recordDossierLoader = 'true';
  document.head.appendChild(script);
})();
'''

REPLACEMENTS = (
    Replacement(
        'forge-source/dossier-signals.js',
        'data-record-dossier-loader',
        '\n',
        LOADER,
    ),
    Replacement(
        'forge-source/patterns-decision-support.js',
        "id: 'component_dossier'",
        """    if (row.component_id || matchedKinds.includes('supply_chain')) {
      links.push({
        id: 'components',""",
        """    if (row.component_id) {
      links.push({
        id: 'component_dossier',
        label: 'Forge component dossier',
        url: `https://uas-forge.com/dossier/?component=${encodeURIComponent(String(row.component_id))}`,
        reason: `Open the exact indexed component record (${String(row.component_id)}) with specifications, documented platform relationships, candidate alternatives, matched Patterns evidence, freshness, and limitations.`
      });
    }

    if (row.component_id || matchedKinds.includes('supply_chain')) {
      links.push({
        id: 'components',""",
    ),
    Replacement(
        'forge-source/patterns-decision-support.js',
        "id: 'platform_dossier'",
        """    if (row.platform_id || matchedKinds.includes('operational')) {
      links.push({
        id: 'platforms',""",
        """    if (row.platform_id) {
      links.push({
        id: 'platform_dossier',
        label: 'Forge platform dossier',
        url: `https://uas-forge.com/dossier/?platform=${encodeURIComponent(String(row.platform_id))}`,
        reason: `Open the exact indexed platform record (${String(row.platform_id)}) with specifications, documented BOM relationships, peer platforms, matched Patterns evidence, freshness, and limitations.`
      });
    }

    if (row.platform_id || matchedKinds.includes('operational')) {
      links.push({
        id: 'platforms',""",
    ),
    Replacement(
        'forge-source/browse.html',
        'Open component dossier',
        """

        modalContent.innerHTML = `""",
        """

        const dossierHtml = p.pid
            ? `<a href="/dossier/?component=${encodeURIComponent(p.pid)}" style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);border-radius:6px;font:600 11px var(--mono);color:#ef4444;text-decoration:none">Open component dossier →</a>`
            : '';

        modalContent.innerHTML = `""",
    ),
    Replacement(
        'forge-source/browse.html',
        '${dossierHtml}\n            ${handbookHtml}',
        """            ${tagsHtml}
            ${handbookHtml}""",
        """            ${tagsHtml}
            ${dossierHtml}
            ${handbookHtml}""",
    ),
    Replacement(
        'forge-source/platforms.js',
        'Open platform dossier',
        """                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                ${p.manufacturer_url ?""",
        """                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                ${p.id ? `<a href="/dossier/?platform=${encodeURIComponent(p.id)}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);color:#ef4444;font-family:var(--font-family);font-size:12px;font-weight:600;text-decoration:none;letter-spacing:.03em">Open platform dossier →</a>` : ''}
                ${p.manufacturer_url ?""",
    ),
    Replacement(
        'forge-source/dossier.html',
        '?component=${encodeURIComponent(p.pid || p.name)}',
        """                  <div class="part-name" title="${ESC(p.name)}">${ESC(p.name)}</div>""",
        """                  <a class="part-name" title="Open ${ESC(p.name)} component dossier" href="/dossier/?component=${encodeURIComponent(p.pid || p.name)}" style="color:inherit;text-decoration:none">${ESC(p.name)}</a>""",
    ),
    Replacement(
        'tests/test_patterns_decision_support.cjs',
        "link.id === 'component_dossier'",
        """  assert.ok(result.affected_links.some(link => link.id === 'components'));
  assert.ok(result.affected_links.some(link => link.id === 'compare'));""",
        """  assert.ok(result.affected_links.some(link => link.id === 'component_dossier'));
  assert.ok(result.affected_links.some(link => link.id === 'component_dossier' && /component=CAM-001/.test(link.url)));
  assert.ok(result.affected_links.some(link => link.id === 'components'));
  assert.ok(result.affected_links.some(link => link.id === 'compare'));""",
    ),
    Replacement(
        'tests/test_patterns_decision_support.cjs',
        "test('platform identifiers link to the exact platform dossier'",
        """test('source statistics deduplicate evidence URLs and count primary references', () => {""",
        """test('platform identifiers link to the exact platform dossier', () => {
  const links = support.affectedLinks({
    platform_id: 'PLAT-001',
    title: 'Operational platform update'
  });
  assert.ok(links.some(link => link.id === 'platform_dossier'));
  assert.ok(links.some(link => link.id === 'platform_dossier' && /platform=PLAT-001/.test(link.url)));
  assert.ok(links.some(link => link.id === 'platforms'));
});

test('source statistics deduplicate evidence URLs and count primary references', () => {""",
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_record_dossiers.cjs',
        """      - "tests/test_dossier_signals.cjs"
      - "tests/test_patterns_decision_support.cjs""",
        """      - "tests/test_dossier_signals.cjs"
      - "tests/test_record_dossiers.cjs"
      - "tests/test_patterns_decision_support.cjs""",
        expected_count=2,
        expected_marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tools/apply_record_dossier_patch.py',
        """      - "tools/audit_public_site.py"
      - "tests/test_public_site_audit.py""",
        """      - "tools/audit_public_site.py"
      - "tools/apply_record_dossier_patch.py"
      - "tests/test_public_site_audit.py""",
        expected_count=2,
        expected_marker_count=2,
        replace_all=True,
    ),
    Replacement(
        '.github/workflows/public-site-quality.yml',
        'tests/test_record_dossiers.cjs tests/test_patterns_decision_support.cjs',
        """          node --test tests/test_dossier_signals.cjs tests/test_patterns_decision_support.cjs
          node --check forge-source/dossier-signals.js
          node --check forge-source/patterns-decision-support.js""",
        """          node --test tests/test_dossier_signals.cjs tests/test_record_dossiers.cjs tests/test_patterns_decision_support.cjs
          node --check forge-source/dossier-signals.js
          node --check forge-source/record-dossiers.js
          node --check forge-source/patterns-decision-support.js
          python tools/apply_record_dossier_patch.py --check""",
    ),
)


def apply_one(root: Path, replacement: Replacement, apply: bool) -> str:
    path = root / replacement.path
    if not path.exists():
        raise RuntimeError(f'missing file: {replacement.path}')
    text = path.read_text(encoding='utf-8')
    if text.count(replacement.marker) >= replacement.expected_marker_count:
        return 'present'
    if not apply:
        raise RuntimeError(
            f'{replacement.path}: required marker missing or incomplete: '
            f'{replacement.marker!r} ({text.count(replacement.marker)}/'
            f'{replacement.expected_marker_count})'
        )
    if replacement.path == 'forge-source/dossier-signals.js' and replacement.old == '\n':
        updated = text.rstrip() + replacement.new
    else:
        count = text.count(replacement.old)
        if count != replacement.expected_count:
            raise RuntimeError(
                f'{replacement.path}: expected {replacement.expected_count} patch anchor(s) '
                f'for {replacement.marker!r}; found {count}'
            )
        if replacement.replace_all:
            updated = text.replace(replacement.old, replacement.new)
        else:
            updated = text.replace(replacement.old, replacement.new, 1)
    if updated.count(replacement.marker) < replacement.expected_marker_count:
        raise RuntimeError(
            f'{replacement.path}: patch did not create expected marker count for '
            f'{replacement.marker!r}'
        )
    path.write_text(updated, encoding='utf-8')
    return 'applied'


def run(root: Path, apply: bool) -> list[str]:
    results = []
    for replacement in REPLACEMENTS:
        state = apply_one(root, replacement, apply)
        results.append(f'{replacement.path}: {state} — {replacement.marker}')
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true', help='write the idempotent link/load edits')
    mode.add_argument('--check', action='store_true', help='validate all edits without writing')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        results = run(args.root.resolve(), apply=args.apply)
    except RuntimeError as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    for result in results:
        print(result)
    print('Record dossier cross-surface patch: PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
