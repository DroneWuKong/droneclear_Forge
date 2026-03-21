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
| POLISH-003 | Duplicate `/editor/` route | `urls.py:28` | Both `/library/` and `/editor/` serve same view. Use `RedirectView`. | 2026-03-06 |
| POLISH-009 | Missing `<label>` elements | All 5 HTML pages | Search inputs lack `<label>` for screen readers. | 2026-03-06 |
| POLISH-010 | Guide cards not keyboard-accessible | `guide-selection.js:72` | Cards use `onclick` on `div`, no `tabindex` or `role`. | 2026-03-06 |
| POLISH-011 | Three.js memory leak | `guide-viewer.js` | `destroySTLViewer` doesn't dispose geometries/materials. | 2026-03-06 |
| POLISH-012 | Camera blob URL not revoked | `guide-camera.js:82-83` | `URL.createObjectURL` never revoked. | 2026-03-06 |
| POLISH-013 | Global scope pollution | All JS files | No module system. Risk of naming collisions. | 2026-03-06 |
| POLISH-014 | `components.css` is 2800+ lines | `components.css` | Should split into focused files. | 2026-03-06 |
| POLISH-015 | No cache-busting on guide/audit | `guide.html`, `audit.html` | Script tags lack `?v=` unlike other pages. | 2026-03-06 |
| POLISH-016 | Dark mode flash on index.html | `index.html` | Missing `data-theme="light"` on `<html>` tag unlike all other pages. Flash of wrong theme on first load. | 2026-03-08 |
| POLISH-017 | No print media styles | All CSS files | No `@media print` rules. Audit records, build guides, component details can't be printed readably. | 2026-03-08 |
| POLISH-018 | Guide editor form validation | `guide-editor.js` | No `checkValidity()` before API submit. Empty guide names, negative time estimates saved without error. | 2026-03-08 |
| POLISH-019 | Missing ARIA/keyboard on modals | Multiple JS + HTML | No `role="dialog"`, `aria-modal`, focus trap in modals. WCAG 2.1 AA non-compliant. | 2026-03-08 |
| POLISH-020 | Camera permission no fallback UI | `guide-camera.js` | Denied camera shows empty video element with no user-facing error message. | 2026-03-08 |

## Feature Requests

| ID | Feature | Description | Added |
|----|---------|-------------|-------|
| FEAT-001 | Component cloning | Duplicate an existing part or schema category to speed up data entry. | 2026-03-06 |
| FEAT-002 | Build export | Export a completed build to CSV or PDF from the wizard. | 2026-03-06 |
| FEAT-003 | Photo AI analysis | Run CV models on captured step photos for quality assurance. | 2026-03-06 |
| FEAT-004 | Schema audit logging | Track who changed what in the schema and parts library. | 2026-03-06 |
| FEAT-005 | Tag vocabulary | Controlled tag taxonomy per category instead of free-form strings. | 2026-03-06 |
| FEAT-006 | Additional data sources | Scrape GetFPV, RaceDayQuads, or manufacturer sites for broader coverage. | 2026-03-06 |
| ~~FEAT-007~~ | ~~Media upload~~ | ~~Resolved — see Completed section~~ | 2026-03-06 |
| FEAT-008 | Build guide versioning | Track guide revisions so sessions reference a specific version. | 2026-03-06 |
| FEAT-009 | Audit PDF export | Generate downloadable PDF audit reports from the audit viewer. | 2026-03-06 |
| ~~FEAT-013~~ | ~~Mission Control dashboard~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |
| ~~FEAT-014~~ | ~~FPV Academy educational module~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |
| ~~FEAT-015~~ | ~~Seed drone models & build guides~~ | ~~Resolved — see Completed section~~ | 2026-03-08 |

---

## Completed

| ID | Issue | Completed | Session |
|----|-------|-----------|---------|
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
