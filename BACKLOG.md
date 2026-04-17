# DroneClear Backlog

> **Single source of truth** for all tracked issues, bugs, and feature requests.
> Each item has a permanent ID. Do NOT duplicate items — update existing entries.
> When completing an item, move it to the Completed section with the session date.

## How to Use This File

- Before starting work, read the full backlog
- Before adding an item, **search by keyword** to avoid duplicates
- Use the next available ID in the appropriate prefix
- When completing an item, move it to "Completed" at the bottom with the date

## ID Prefixes

- `SEC-` — Security issues
- `BUG-` — Bugs and data integrity issues
- `DEBT-` — Technical debt and code quality
- `FEAT-` — Feature requests and enhancements
- `POLISH-` — Low-priority polish and cleanup

---

## Critical — Security

| ID | Issue | Location | Description | Added |
|----|-------|----------|-------------|-------|

## High — Data Integrity

| ID | Issue | Location | Description | Added |
|----|-------|----------|-------------|-------|
| | *(All items completed — see Completed section)* | | | |

## Medium — Technical Debt

| ID | Issue | Location | Description | Added |
|----|-------|----------|-------------|-------|
| DEBT-013 | Zero test coverage for seed.py | `components/seed.py` | `seed_golden()` and `seed_examples()` completely untested. Affects auto-seeding on migration. N/A for static Forge — Django backend only. | 2026-03-08 |
| | *(All other DEBT items completed — see Completed section)* | | | |

## Low — Polish

| ID | Issue | Location | Description | Added |
|----|-------|----------|-------------|-------|
| POLISH-013 | Global scope pollution | All JS files | WONTFIX — intentional for cross-file function calls in static build. | 2026-03-06 |
| POLISH-014 | `components.css` is 3000+ lines | `components.css` | WONTFIX — CSS split requires all HTML import updates, risk > benefit. | 2026-03-06 |
| | *(All other POLISH items completed — see Completed section)* | | | |

## Feature Requests

| ID | Feature | Description | Added |
|----|---------|-------------|-------|
| FEAT-003 | Photo AI analysis | Run CV models on captured step photos for quality assurance. Needs backend CV server. | 2026-03-06 |
| FEAT-004 | Schema audit logging | Track who changed what in the schema and parts library. Needs database persistence. | 2026-03-06 |
| FEAT-005 | Tag vocabulary | Controlled tag taxonomy per category instead of free-form strings. Needs schema changes. | 2026-03-06 |
| FEAT-006 | Additional data sources | Pipeline at `tools/mining/`. RotorBuilds miner now produces real parts data (DOM extraction working, 448 pairs from 10 builds). Blue UAS miner blocked by robots.txt (bluelist.dcma.mil disallows). ArduPilot Discourse + SAM.gov miners scaffolded. Next: ArduPilot Discourse parse() + SAM.gov API key. | 2026-03-06 |
| ~~FEAT-020~~ | ~~RotorBuilds DOM extraction~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| ~~FEAT-021~~ | ~~Blue UAS authoritative registry~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| ~~FEAT-022~~ | ~~Wingman co-occurrence signal~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| ~~FEAT-023~~ | ~~Manufacturer Dossier page~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| FEAT-024 | Entity graph visualizer | `/patterns/graph/` — force-directed graph of `entity_graph.json` (manufacturers ↔ parts ↔ contracts ↔ articles). Data already exists; nothing renders it today. Blocked: `entity_graph.json` is gated — needs product decision on access method. | 2026-04-11 |
| ~~FEAT-025~~ | ~~Lifecycle timeline~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| ~~FEAT-026~~ | ~~Shareable build URLs~~ | ~~Resolved — see Completed section~~ | 2026-04-11 |
| FEAT-027 | Featured builds gallery | `/gallery/` — hand-curated `forge_featured_builds.json` with 10-30 reference builds (7" NDAA long-range, cinelifter, Blue UAS Framework reference, ORQA NDAA FPV, etc.). Each deep-links into `/builder/?b=`. | 2026-04-11 |
| FEAT-008 | Build guide versioning | Track guide revisions so sessions reference a specific version. Needs database versioning. | 2026-03-06 |
| ~~FEAT-013~~ | ~~Mission Control dashboard~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |
| ~~FEAT-014~~ | ~~FPV Academy educational module~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |
| ~~FEAT-015~~ | ~~Seed drone models & build guides~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |

---

## Completed

| ID | Issue | Completed | Session |
|----|-------|-----------|---------|
| ~~FEAT-026~~ | Shareable build URLs — `?b=<base64url-pids>` on `/builder/`. Share button in drawer; hydrates build from URL param on load. | 2026-04-16 | `index.html`: encodeBuildParam/decodeBuildParam helpers + btn-share + URL hydration in init() |
| ~~FEAT-022~~ | Wingman 5th co-occurrence check — `buildCooccurrenceContext()` injected into buildPrompt(); loads `forge_co_occurrence.json` non-blocking. Step 5 added to BUILD-VALIDITY CHECK. | 2026-04-16 | `wingman.html`: coData var + loadCooccurrence + buildCooccurrenceContext() |
| ~~FEAT-020~~ | RotorBuilds DOM extraction — real DOM selectors verified on live site. `parse()` extracts category/name/vendor from `<td class='tag' data-tag=...>` rows. 9-part builds extracted cleanly. Sample page cached at `tools/mining/fixtures/rotorbuilds_build_36877.html`. | 2026-04-16 | `tools/mining/miners/rotorbuilds.py` rewritten; end-to-end tested: 448 pairs from 10 builds |
| ~~FEAT-021~~ | Blue UAS normalizer — `tools/mining/normalizers/blue_uas_to_cleared.py` writes `forge_blue_uas_cleared.json`. Registered in `run_all.py`. Note: bluelist.dcma.mil and diu.mil both block scraping via robots.txt; populating real data requires Excel download or operator permission. | 2026-04-16 | `tools/mining/normalizers/blue_uas_to_cleared.py` (new); `run_all.py` updated |
| ~~FEAT-023~~ | Manufacturer Dossier page — `dossier.html` already fully implemented (754 lines, picker + detail views). Backlog was stale. | 2026-04-16 | Backlog reconciliation |
| ~~FEAT-025~~ | Lifecycle/Regulatory Timeline — `timeline.html` already fully implemented (432 lines, law/regulation/list_update/ma/program/enforcement filter pills). Backlog was stale. | 2026-04-16 | Backlog reconciliation |
| ~~BUG-mesh-001~~ | Mesh planner map never initializes | 2026-04-13 | tools.html nav clicks captured local showTool closure, bypassing window.showTool overrides |
| ~~DEBT-risk-001~~ | risk_scores.json separate from entities.json | 2026-04-13 | Merged inline into entities.json schema |
| ~~BUG-link-001~~ | PIE→ and Full analysis→ links broken in brief | 2026-04-13 | Now switch tabs in-page |
| ~~BUG-redirect-001~~ | 9 missing netlify.toml redirects | 2026-04-13 | compliance-matrix, dossier, guides-hub, intel-commercial, intel-dfr, intel/feed, payload-compare, spec-sheets, stack-builder |
| ~~XSS-M1~~ | `components.js` innerHTML XSS | 2026-03-06 | 2026-03-06-3 |
| ~~XSS-M2~~ | `modal.js` innerHTML XSS | 2026-03-06 | 2026-03-06-3 |
| ~~XSS-M3~~ | `build.js` innerHTML XSS | 2026-03-06 | 2026-03-06-3 |
| ~~XSS-M4~~ | `persist.js` innerHTML XSS | 2026-03-06 | 2026-03-06-3 |
| ~~XSS-M5~~ | `editor.js` innerHTML XSS | 2026-03-06 | 2026-03-06-3 |
| ~~FEAT-010~~ | Golden seed system (3,113 real parts auto-seeded) | 2026-03-07 | 2026-03-07-1 |
| ~~FEAT-011~~ | Reset to Examples button on all pages | 2026-03-07 | 2026-03-07-1 |
| ~~FEAT-012~~ | Build Components quick-select panel in guide step editor | 2026-03-07 | 2026-03-07-1 |
| ~~BUG-005~~ | `getCookie is not defined` on guide page (missing utils.js import) | 2026-03-07 | 2026-03-07-1 |
| ~~BUG-006~~ | Schema field mismatch — 79 seed fields missing from schema blueprints | 2026-03-07 | 2026-03-07-1 |
| ~~BUG-007~~ | Guide save fails with blank step title/description (DRF 400 validation) | 2026-03-07 | 2026-03-07-1 |
| ~~BUG-001~~ | Guide update cascade-deletes photos — SET_NULL + update-in-place | 2026-03-08 | 2026-03-08-1 |
| ~~BUG-002~~ | Serial number race condition — select_for_update + transaction + retry | 2026-03-08 | 2026-03-08-1 |
| ~~BUG-003~~ | BuildEvent CASCADE breaks immutability — changed to PROTECT; BuildSession.guide to SET_NULL | 2026-03-08 | 2026-03-08-1 |
| ~~FEAT-007~~ | Media upload — GuideMediaFile model + upload endpoint + editor UI | 2026-03-08 | 2026-03-08-2 |
| ~~SEC-003~~ | StepPhotoUploadView file validation — size, MIME, PIL verify | 2026-03-08 | 2026-03-08-2 |
| ~~FEAT-013~~ | Mission Control dashboard — welcome page with live stats, module cards, FPV Academy placeholder | 2026-03-08 | 2026-03-08-3 |
| ~~FEAT-014~~ | FPV Academy — 8-section educational hub with hero, topic cards, articles, glossary | 2026-03-08 | 2026-03-08-4 |
| ~~FEAT-015~~ | Seed drone models (12) & build guides (3 with 42 steps) — golden seed system | 2026-03-08 | 2026-03-08-5 |
| ~~BUG-008~~ | Relations format mismatch — frontend expected string PIDs, seed uses `{pid, quantity}` objects | 2026-03-08 | 2026-03-08-5 |
| ~~BUG-010~~ | Guide JS uses `alert()` instead of `showToast()` — blocking system prompts for errors | 2026-03-08 | 2026-03-08-5 |
| ~~POLISH-021~~ | Build overview glass panel missing padding — components overrun panel edges | 2026-03-08 | 2026-03-08-5 |
| ~~DEBT-001~~ | Dead code: `notesHtml` removed | 2026-03-06 | prior session |
| ~~DEBT-002~~ | Missing i18n key `errLoadDesc` added to state.js | 2026-03-06 | prior session |
| ~~DEBT-003~~ | Duplicate Escape handler removed from app.js | 2026-03-06 | prior session |
| ~~DEBT-004~~ | `body *` transition scoped to layout elements only | 2026-03-06 | prior session |
| ~~DEBT-005~~ | Event listener stacking — removeEventListener + cloneNode pattern | 2026-03-06 | prior session |
| ~~DEBT-006~~ | Weight filter race — separate debounce timers in state.js | 2026-03-06 | prior session |
| ~~DEBT-007~~ | Maintenance script extracted to maintenance.js | 2026-03-06 | prior session |
| ~~DEBT-008~~ | Inline styles in template.html — 15 CSS classes extracted, 80→48 inline styles | 2026-03-06 | 2026-03-21 |
| ~~DEBT-009~~ | Event listener leaks audited — all safe (DOMContentLoaded, _done guards, cloneNode, removeEventListener) | 2026-03-08 | 2026-03-21 |
| ~~DEBT-010~~ | Fetch error handling — showToast added to 11 silent catch blocks across 5 JS files | 2026-03-08 | 2026-03-21 |
| ~~DEBT-012~~ | escapeHTML audit — all innerHTML in audit.js/guide-runner.js already use _esc()/escHTML(). No XSS risk. | 2026-03-08 | 2026-03-21 |
| ~~POLISH-003~~ | /editor/ → /library/ redirect in netlify.toml | 2026-03-06 | 2026-03-21 |
| ~~POLISH-009~~ | .sr-only class + labels on all search inputs (8 pages) | 2026-03-06 | 2026-03-21 |
| ~~POLISH-010~~ | tabindex + role=button on guide cards for keyboard nav | 2026-03-06 | 2026-03-21 |
| ~~POLISH-011~~ | Three.js geometry/material dispose in destroySTLViewer | 2026-03-06 | 2026-03-21 |
| ~~POLISH-012~~ | Blob URL revocation on camera preview + file upload | 2026-03-06 | 2026-03-21 |
| ~~POLISH-015~~ | Cache busting ?v=2 on guide.html + audit.html scripts | 2026-03-06 | 2026-03-21 |
| ~~POLISH-016~~ | data-theme=dark + early theme script on index.html | 2026-03-08 | 2026-03-21 |
| ~~POLISH-017~~ | @media print styles — hide nav/drawers, readable layout | 2026-03-08 | 2026-03-21 |
| ~~POLISH-018~~ | Guide editor form validation — require name, reject neg time | 2026-03-08 | 2026-03-21 |
| ~~POLISH-019~~ | role=dialog + aria-modal on all modal overlays | 2026-03-08 | 2026-03-21 |
| ~~POLISH-020~~ | Toast on camera permission denied (was silent fallback) | 2026-03-08 | 2026-03-21 |
| ~~FEAT-001~~ | Component cloning — clone icon on item rows, pre-fills form with "(Copy)" | 2026-03-06 | 2026-03-21 |
| ~~FEAT-002~~ | Build export CSV — Export CSV button in drawer, downloads BOM with totals | 2026-03-06 | 2026-03-21 |
| ~~FEAT-009~~ | Audit Print/PDF — Print button on audit record, uses @media print styles | 2026-03-06 | 2026-03-21 |
