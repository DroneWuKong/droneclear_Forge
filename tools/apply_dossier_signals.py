#!/usr/bin/env python3
"""Apply the first Phase 1 entity-dossier integration.

Deterministic, software-only repository migration. It patches known dossier and
quality-gate snippets and performs no network or hardware access.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOSSIER = ROOT / "forge-source" / "dossier.html"
AUDIT = ROOT / "tools" / "audit_public_site.py"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        print(f"already patched: {path}")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one patch target in {path}; found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched: {path}")


def patch_css() -> None:
    old = """      /* Meta strip */
"""
    new = """      /* Current Patterns signals + decision support */
      .signal-shell{background:linear-gradient(135deg,rgba(168,85,247,.08),var(--card));border:1px solid rgba(168,85,247,.28);border-radius:10px;padding:15px;margin-bottom:26px}
      .signal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}
      .signal-title{font:700 13px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--c-purple);display:flex;align-items:center;gap:7px}
      .signal-status{font:700 9px var(--mono);text-transform:uppercase;letter-spacing:.06em;padding:3px 7px;border-radius:4px;border:1px solid var(--border);color:var(--text-d)}
      .signal-status.fresh{color:var(--c-green);border-color:rgba(34,197,94,.35);background:var(--c-green-d)}
      .signal-status.delayed,.signal-status.stale{color:var(--c-yellow);border-color:rgba(234,179,8,.35);background:var(--c-yellow-d)}
      .signal-status.invalid,.signal-status.unavailable,.signal-status.invalid-future{color:var(--c-red);border-color:rgba(239,68,68,.35);background:var(--c-red-d)}
      .signal-context{font-size:11px;color:var(--text-d);line-height:1.55;margin-bottom:10px}
      .signal-context strong{color:var(--text-s)}
      .signal-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:10px}
      .signal-stat{background:rgba(12,12,10,.55);border:1px solid var(--border);border-radius:6px;padding:8px 10px}
      .signal-stat-label{font:600 8px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--text-xd)}
      .signal-stat-value{font:700 14px var(--mono);color:var(--text);margin-top:2px}
      .signal-grid{display:grid;gap:7px}
      .signal-card{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--text-xd);border-radius:7px;padding:10px 12px}
      .signal-card.sev-critical,.signal-card.sev-high{border-left-color:var(--c-red)}
      .signal-card.sev-warning,.signal-card.sev-medium{border-left-color:var(--c-yellow)}
      .signal-card.sev-watch,.signal-card.sev-low{border-left-color:var(--c-blue)}
      .signal-card-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
      .signal-name{font:700 12px var(--font);color:var(--text);line-height:1.4}
      .signal-badges{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
      .signal-badge{font:700 8px var(--mono);text-transform:uppercase;letter-spacing:.04em;padding:2px 5px;border-radius:3px;border:1px solid var(--border);color:var(--text-d);white-space:nowrap}
      .signal-badge.direct{color:var(--c-green);border-color:rgba(34,197,94,.3)}
      .signal-badge.contextual{color:var(--c-yellow);border-color:rgba(234,179,8,.3)}
      .signal-detail{font-size:11px;color:var(--text-d);line-height:1.55;margin-top:6px}
      .signal-meta{display:flex;gap:8px;flex-wrap:wrap;font:500 9px var(--mono);color:var(--text-xd);margin-top:7px}
      .signal-evidence{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
      .signal-source{font:600 9px var(--mono);color:var(--c-blue);border:1px solid rgba(59,130,246,.25);background:var(--c-blue-d);border-radius:3px;padding:2px 6px;text-decoration:none}
      .signal-source:hover{border-color:var(--c-blue)}
      .review-box{margin-top:10px;background:rgba(12,12,10,.55);border:1px solid var(--border);border-radius:7px;padding:10px 12px}
      .review-title{font:700 9px var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--c-amber);margin-bottom:5px}
      .review-list{margin:0;padding-left:18px;color:var(--text-s);font-size:11px;line-height:1.55}
      .signal-empty{font-size:11px;color:var(--text-d);line-height:1.6;padding:4px 0}
      .signal-footer{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;font:500 9px var(--mono);color:var(--text-xd)}
      .signal-footer a{color:var(--c-purple)}
      @media(max-width:640px){.signal-card-top{display:block}.signal-badges{justify-content:flex-start;margin-top:5px}}

      /* Meta strip */
"""
    replace_once(DOSSIER, old, new)


def patch_script_include() -> None:
    old = """</main>

<script>
(function(){
  'use strict';
"""
    new = """</main>

<script src="static/dossier-signals.js"></script>
<script>
(function(){
  'use strict';
"""
    replace_once(DOSSIER, old, new)


def patch_state_and_loader() -> None:
    old = """  let altData = null;    // forge_alternatives.json
  let partsBySlug = {};  // slug → [parts]
"""
    new = """  let altData = null;    // forge_alternatives.json
  let flagsData = [];    // Patterns active public-source signals
  let catalogData = { datasets: [] }; // freshness, coverage, and caveats
  let partsBySlug = {};  // slug → [parts]
"""
    replace_once(DOSSIER, old, new)

    old_loader = """  // Load all four data sources in parallel.
  async function loadData() {
    const [mfgRes, sheetsRes, altRes, dbRes] = await Promise.all([
      fetch('forge_manufacturer_status.json').catch(() => null),
      fetch('forge_848_spec_sheets.json').catch(() => null),
      fetch('forge_alternatives.json').catch(() => null),
      fetch('forge_database.json').catch(() => null),
    ]);

    mfgData = mfgRes && mfgRes.ok ? await mfgRes.json() : { manufacturers: {} };
    sheetsData = sheetsRes && sheetsRes.ok ? await sheetsRes.json() : { spec_sheets: [] };
    altData = altRes && altRes.ok ? await altRes.json() : { categories: {} };
    const db = dbRes && dbRes.ok ? await dbRes.json() : { components: {} };
"""
    new_loader = """  async function fetchDataset(candidates, fallback) {
    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const documentValue = await response.json();
        return window.ForgeDossierSignals
          ? window.ForgeDossierSignals.unwrapApi(documentValue)
          : (documentValue && documentValue.data !== undefined ? documentValue.data : documentValue);
      } catch (error) {
        // Try the next public or static source. The page exposes the resulting
        // unavailable state instead of silently asserting that no signal exists.
      }
    }
    return fallback;
  }

  // Load reference records and current Patterns evidence in parallel. Absolute
  // static paths remain valid on the nested /dossier/ route and in local builds.
  async function loadData() {
    const [mfgDoc, sheetsDoc, altDoc, db, flagsDoc, catalogDoc] = await Promise.all([
      fetchDataset(['/static/forge_manufacturer_status.json'], { manufacturers: {} }),
      fetchDataset(['/static/forge_848_spec_sheets.json'], { spec_sheets: [] }),
      fetchDataset(['/static/forge_alternatives.json'], { categories: {} }),
      fetchDataset(['/static/forge_database.json'], { components: {} }),
      fetchDataset(['/api/data?type=pie_flags', '/static/pie_flags.json'], []),
      fetchDataset(['/api/data?type=dataset_catalog', '/static/dataset_catalog.json'], { datasets: [] }),
    ]);

    mfgData = mfgDoc && typeof mfgDoc === 'object' ? mfgDoc : { manufacturers: {} };
    sheetsData = sheetsDoc && typeof sheetsDoc === 'object' ? sheetsDoc : { spec_sheets: [] };
    altData = altDoc && typeof altDoc === 'object' ? altDoc : { categories: {} };
    flagsData = Array.isArray(flagsDoc) ? flagsDoc : [];
    catalogData = catalogDoc && typeof catalogDoc === 'object' ? catalogDoc : { datasets: [] };
"""
    replace_once(DOSSIER, old_loader, new_loader)


def patch_render_helpers() -> None:
    old = """    return mentions;
  }

  function renderDetail(slug) {
"""
    new = """    return mentions;
  }

  function catalogRow(id) {
    return (catalogData.datasets || []).find(row => row && row.id === id) || null;
  }

  function formatDate(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed)
      ? new Date(parsed).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';
  }

  function severityClass(value) {
    return 'sev-' + String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function renderPatternSignals(slug, rec, signals) {
    const api = window.ForgeDossierSignals;
    const flagsMeta = catalogRow('flags');
    const status = String(flagsMeta?.status || (flagsData.length ? 'available-unversioned' : 'unavailable'));
    const statusClass = status.replace(/[^a-z0-9-]+/gi, '-');
    const coverage = flagsMeta?.coverage_end || flagsMeta?.generated_at || null;
    const caveat = flagsMeta?.caveat || 'Signals are analytic leads, not allegations, legal findings, or compliance determinations.';

    if (!api) {
      return `<div class="signal-shell" data-test-id="dossier-pattern-signals"><div class="signal-empty">Patterns signal matching is unavailable. Reference and parts data remain available.</div></div>`;
    }

    const summary = api.summarize(signals);
    const prompts = api.reviewPrompts(signals);
    const critical = (summary.severity_counts.critical || 0) + (summary.severity_counts.high || 0);
    const warning = (summary.severity_counts.warning || 0) + (summary.severity_counts.medium || 0);
    const searchUrl = 'https://uas-patterns.com/pie-search/?q=' + encodeURIComponent(rec.name || slug);

    const cards = signals.slice(0, 8).map(signal => {
      const sourceLinks = (signal.sources || []).filter(source => source && /^https?:\\/\\//i.test(String(source.url || ''))).slice(0, 4);
      const detail = String(signal.detail || signal.summary || signal.description || '').trim();
      const clipped = detail.length > 420 ? detail.slice(0, 417) + '…' : detail;
      const reasons = (signal._match_reasons || []).join(' + ') || 'context';
      return `
        <article class="signal-card ${severityClass(signal.severity)}">
          <div class="signal-card-top">
            <div class="signal-name">${ESC(signal.title || signal.id || 'Untitled signal')}</div>
            <div class="signal-badges">
              <span class="signal-badge">${ESC(signal.severity || 'unknown')}</span>
              <span class="signal-badge ${ESC(signal._match_confidence || 'contextual')}">${ESC(signal._match_confidence || 'contextual')} match</span>
            </div>
          </div>
          ${clipped ? `<div class="signal-detail">${ESC(clipped)}</div>` : ''}
          <div class="signal-meta">
            <span>last seen ${ESC(formatDate(signal.last_seen || signal.timestamp || signal.date))}</span>
            <span>confidence ${ESC(signal.confidence == null ? '—' : signal.confidence)}</span>
            <span>basis ${ESC(reasons)}</span>
          </div>
          ${sourceLinks.length ? `<div class="signal-evidence">${sourceLinks.map((source, index) => `<a class="signal-source" href="${ESC(source.url)}" target="_blank" rel="noopener noreferrer">${ESC(source.name || source.type || ('source ' + (index + 1)))}</a>`).join('')}</div>` : ''}
        </article>`;
    }).join('');

    return `
      <section class="signal-shell" data-test-id="dossier-pattern-signals" aria-labelledby="patterns-signal-heading">
        <div class="signal-head">
          <div class="signal-title" id="patterns-signal-heading"><i class="ph ph-wave-sine"></i> Current Patterns Signals</div>
          <span class="signal-status ${ESC(statusClass)}">${ESC(status)}</span>
        </div>
        <div class="signal-context">
          Vendor-centered join against active indexed flags. <strong>${ESC(caveat)}</strong>
          ${coverage ? ` Public coverage through ${ESC(formatDate(coverage))}.` : ' Coverage timestamp unavailable.'}
        </div>
        ${signals.length ? `
          <div class="signal-stats">
            <div class="signal-stat"><div class="signal-stat-label">matched signals</div><div class="signal-stat-value">${summary.count}</div></div>
            <div class="signal-stat"><div class="signal-stat-label">critical / high</div><div class="signal-stat-value">${critical}</div></div>
            <div class="signal-stat"><div class="signal-stat-label">warning / medium</div><div class="signal-stat-value">${warning}</div></div>
            <div class="signal-stat"><div class="signal-stat-label">unique sources</div><div class="signal-stat-value">${summary.unique_source_count}</div></div>
            <div class="signal-stat"><div class="signal-stat-label">direct / contextual</div><div class="signal-stat-value">${summary.direct_match_count} / ${summary.contextual_match_count}</div></div>
          </div>
          <div class="signal-grid">${cards}</div>
          ${prompts.length ? `<div class="review-box"><div class="review-title">Review next — verification prompts</div><ul class="review-list">${prompts.map(prompt => `<li>${ESC(prompt)}</li>`).join('')}</ul></div>` : ''}
        ` : `<div class="signal-empty">No active signal matched this manufacturer in the indexed public corpus. This does not establish absence of risk, coverage, legal restrictions, or supply-chain exposure.</div>`}
        <div class="signal-footer">
          <span>Match method: exact entity/manufacturer/component or explicit vendor text. Contextual matches require source review.</span>
          <a href="${ESC(searchUrl)}" target="_blank" rel="noopener noreferrer">Search all Patterns evidence →</a>
        </div>
      </section>`;
  }

  function renderDetail(slug) {
"""
    replace_once(DOSSIER, old, new)


def patch_signal_join_and_section() -> None:
    old = """    const sheets = findSheetsFor(slug, rec);
    const altMentions = findAltMentions(slug, rec);

    // Build parent + subsidiaries family tree
"""
    new = """    const sheets = findSheetsFor(slug, rec);
    const altMentions = findAltMentions(slug, rec);
    const matchedSignals = window.ForgeDossierSignals
      ? window.ForgeDossierSignals.matchFlags(flagsData, slug, rec, allParts)
      : [];

    // Build parent + subsidiaries family tree
"""
    replace_once(DOSSIER, old, new)

    old_section = """      </div>

      ${parentRec || subsidiaries.length ? `
"""
    new_section = """      </div>

      ${renderPatternSignals(slug, rec, matchedSignals)}

      ${parentRec || subsidiaries.length ? `
"""
    replace_once(DOSSIER, old_section, new_section)


def patch_copy_and_trust() -> None:
    old = """            <p>One page per vendor — status, M&amp;A history, parts, spec sheets, alternatives, and risk flags. Pulls from the Forge manufacturer registry, the §848 spec sheet index, the alternatives map, and the <span data-parts-count>3,800</span>+ part database. Click any vendor to open their full dossier.</p>
"""
    new = """            <p>One page per vendor — status, M&amp;A history, parts, spec sheets, alternatives, and current Patterns signals with linked evidence and verification prompts. Pulls from the Forge registries, public PIE flags, and the generated data-quality catalog. Click any vendor to open their full dossier.</p>
"""
    replace_once(DOSSIER, old, new)

    old_trust = """        forge_manufacturer_status.json · forge_848_spec_sheets.json · forge_alternatives.json · forge_database.json.
"""
    new_trust = """        forge_manufacturer_status.json · forge_848_spec_sheets.json · forge_alternatives.json · forge_database.json · pie_flags.json · dataset_catalog.json.
"""
    replace_once(DOSSIER, old_trust, new_trust)


def patch_audit_scope() -> None:
    old = """    "forecast-accountability",
)
"""
    new = """    "forecast-accountability",
    "dossier",
)
"""
    replace_once(AUDIT, old, new)


if __name__ == "__main__":
    patch_css()
    patch_script_include()
    patch_state_and_loader()
    patch_render_helpers()
    patch_signal_join_and_section()
    patch_copy_and_trust()
    patch_audit_scope()
