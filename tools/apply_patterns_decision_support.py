#!/usr/bin/env python3
"""Apply structured decision support to the Patterns flag detail view.

Deterministic and software-only: patches known source snippets, makes no network
requests, and is removed after the validated CI commit.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = ROOT / "forge-source" / "patterns.html"


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
    old = """/* ── Prediction cards ── */
"""
    new = """/* ── Decision support ── */
.decision-box{background:linear-gradient(135deg,rgba(124,58,237,.09),var(--surface));border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:11px 12px;margin:12px 0}
.decision-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px}
.decision-title{font:700 10px var(--mono);color:var(--purple);text-transform:uppercase;letter-spacing:.08em}
.decision-scope{font:600 9px var(--mono);color:var(--text-d);border:1px solid var(--border);border-radius:4px;padding:2px 6px}
.decision-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.decision-section{background:rgba(12,12,10,.48);border:1px solid var(--border);border-radius:6px;padding:9px 10px}
.decision-label{font:700 9px var(--mono);color:var(--text-d);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
.decision-list{margin:0;padding-left:16px;color:var(--text-s);font-size:10.5px;line-height:1.55}
.decision-links{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.decision-link{display:inline-flex;flex-direction:column;gap:2px;min-width:135px;flex:1 1 145px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:7px 9px;color:var(--text);text-decoration:none}
.decision-link:hover{border-color:var(--purple);text-decoration:none}
.decision-link-name{font:700 10px var(--mono);color:var(--purple)}
.decision-link-reason{font:400 9px var(--font);color:var(--text-d);line-height:1.35}
.decision-evidence{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;font:600 9px var(--mono);color:var(--text-d)}
.decision-evidence span{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:2px 6px}
.decision-limit{margin-top:8px;border-left:2px solid var(--text-xd);padding-left:8px;color:var(--text-d);font-size:9.5px;line-height:1.5}
@media(max-width:640px){.decision-grid{grid-template-columns:1fr}}

/* ── Prediction cards ── */
"""
    replace_once(PATTERNS, old, new)


def patch_script_include() -> None:
    old = """</head>
<body>
"""
    new = """<script src="static/patterns-decision-support.js"></script>
</head>
<body>
"""
    replace_once(PATTERNS, old, new)


def patch_renderer() -> None:
    old = """// ── Flag detail ──
function renderFlagDetail() {
"""
    new = """// ── Decision support ──
function renderDecisionSupportPanel(flag) {
  const api = window.PatternsDecisionSupport;
  if (!api) {
    return `<div class="decision-box" data-test-id="flag-decision-support">
      <div class="decision-title">Decision support unavailable</div>
      <div class="decision-limit">The underlying flag and evidence remain visible. No automated conclusion has been substituted.</div>
    </div>`;
  }

  const result = api.build(flag || {});
  const why = (result.why_it_matters || []).map(item => `<li>${esc_(item)}</li>`).join('');
  const verify = (result.verify_next || []).map(item => `<li>${esc_(item)}</li>`).join('');
  const links = (result.affected_links || []).map(link => `
    <a class="decision-link" href="${safeUrl_(link.url)}" target="_blank" rel="noopener noreferrer">
      <span class="decision-link-name">${esc_(link.label)} ↗</span>
      <span class="decision-link-reason">${esc_(link.reason)}</span>
    </a>`).join('');
  const limitations = (result.limitations || []).map(item => esc_(item)).join(' ');
  const stats = result.source_stats || {};
  const scopeBits = [
    result.scope?.entity && result.scope.entity !== 'all' ? `entity ${result.scope.entity}` : '',
    result.scope?.component_id ? `component ${result.scope.component_id}` : '',
    result.scope?.platform_id ? `platform ${result.scope.platform_id}` : '',
  ].filter(Boolean);
  const scopeLabel = scopeBits.length ? scopeBits.join(' · ') : 'category-level scope';

  return `<section class="decision-box" data-test-id="flag-decision-support" aria-label="Decision support review aid">
    <div class="decision-head">
      <div class="decision-title">So what / Now what — review aid</div>
      <span class="decision-scope">${esc_(scopeLabel)}</span>
    </div>
    <div class="decision-grid">
      <div class="decision-section">
        <div class="decision-label">Why it may matter</div>
        <ul class="decision-list">${why}</ul>
      </div>
      <div class="decision-section">
        <div class="decision-label">Verify next</div>
        <ul class="decision-list">${verify}</ul>
      </div>
    </div>
    ${links ? `<div class="decision-label" style="margin-top:9px">Affected Forge records and tools</div><div class="decision-links">${links}</div>` : ''}
    <div class="decision-evidence">
      <span>${Number(stats.reference_count || 0)} source references</span>
      <span>${Number(stats.unique_source_count || 0)} unique sources</span>
      <span>${Number(stats.primary_reference_count || 0)} primary references</span>
      <span>${esc_((result.kinds || ['general']).join(' · '))}</span>
    </div>
    <div class="decision-limit">${limitations}</div>
  </section>`;
}

// ── Flag detail ──
function renderFlagDetail() {
"""
    replace_once(PATTERNS, old, new)


def patch_detail_insertion() -> None:
    old = """  }
  // Follow this signal's topics (watchlist)
  html += flagFollowChips(f);
"""
    new = """  }

  // Structured review framing derived only from this flag's existing fields.
  html += renderDecisionSupportPanel(f);

  // Follow this signal's topics (watchlist)
  html += flagFollowChips(f);
"""
    replace_once(PATTERNS, old, new)


if __name__ == "__main__":
    patch_css()
    patch_script_include()
    patch_renderer()
    patch_detail_insertion()
