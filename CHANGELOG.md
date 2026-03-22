# DroneClear Changelog

> Session-by-session development log. Newest sessions at the top.
> Each entry is written at session close using `/close-session`.

---
## Session 2026-03-22 — vtx.in.ua Database Cross-Check & Ukrainian Component Import

**Agent**: Claude
**Branch**: `master`

### Summary
Full scrape and cross-reference of vtx.in.ua against Forge DB. Site runs on a single Google Sheet ([redacted], updated daily). 737 catalog entries parsed across 5 tabs. 199 new entries merged into forge_database.json. 4 entirely new component categories added.

### Added
- 199 Ukrainian-sourced component entries (vtx.in.ua, verified March 2026)
- 4 new component categories: `fpv_detectors`, `payload_droppers`, `video_scramblers`, `control_link_tx`
- 30 FPV signal detector products ($57–$1,073) — Ukrainian counter-UAS detection ecosystem (VIDIK, KARA DAG, BlueBird, Kseonics, БАБАЙ, FPV Mafia, etc.)
- 5 payload dropper systems incl. Carrier Electronics FPV v1.3/v2.0 + Mavic 3 kits
- 5 video scrambler/encryption products (Sezam video, Carrier Electronics Chameleon)
- 15 Ukrainian control link TX units (COALAS, Radion MaxLink, ЧДБ, Aeronetix LR1121)
- 21 UA VTX products (Stingbee, DEC1, FT, Flytex, KaraFPV, Scream Industries)
- 22 UA FC products (603700 Halychyna/Boryspil, Bloomtech, DiFly, FT, Flytex, Kiwi, Stingbee)
- 13 UA ESC products (603700 Frankivsk/Stryi, DiFly, FT, Flytex, KaraFPV, LEADER Tech, SkyPulse, Stingbee)
- 15 UA FC+ESC stacks, 22 UA frames, 13 UA props, 13 UA RX, 15 UA motors

### Changed
- video_transmitters: 103 → 124
- receivers: 127 → 140
- motors: 288 → 303
- flight_controllers: 300 → 322
- escs: 152 → 165
- stacks: 99 → 114
- frames: 355 → 377
- propellers: 471 → 484
- fpv_cameras: 190 → 193
- thermal_cameras: 31 → 38

---

---

## Session 2026-03-08-5 — Seed Drone Models, Build Guides & Bug Fixes

**Agent**: Claude
**Branch**: `claude/xenodochial-panini`
**Commit(s)**: *(see below)*

### Summary
Created 12 curated seed drone models and 3 expert-quality build guides (42 total steps) as golden seed data. Fixed critical relations format mismatch across frontend and backend that caused `[object Object]` rendering and build session 500 errors. Replaced blocking `alert()` calls with toast notifications and added UI padding fix to build overview.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | 12 seed drone models (5"/6"/7"/10" builds) with real component PIDs | `docs/golden_parts_db_seed/drone_models.json` (new) |
| feat | 3 detailed build guides — freestyle, long range, HD digital — 42 steps with Betaflight CLI, safety warnings, tools | `docs/golden_parts_db_seed/build_guides.json` (new) |
| feat | Seed system loads drone models + build guides on golden reset and auto-seed | `components/seed.py`, `components/apps.py` |
| fix | Relations format: frontend now handles both string PIDs and `{pid, quantity}` objects | `guide-state.js`, `guide-selection.js`, `guide-editor.js` |
| fix | Build session 500 — `perform_create` crashed adding list to set from relations | `components/views.py` |
| fix | Replace 7 `alert()` calls with `showToast()` in guide module | `guide-selection.js`, `guide-editor.js`, `guide-camera.js`, `guide-runner.js`, `audit.js` |
| style | Build overview glass panel padding (20px/24px) | `guide.css` |

### Backlog Updates
- Completed: FEAT-015, BUG-008, BUG-009, BUG-010, POLISH-021
- Added: FEAT-015, BUG-008, BUG-009, BUG-010, POLISH-021 (all completed this session)

### Notes
- Drone models span 5 size classes: 5" freestyle/racing/HD, 6" long range, 7" long range/cinema, 10" cinelifter.
- Build guides include realistic Betaflight CLI dump commands, per-step component references, and expert-level assembly descriptions written as if by an FPV professional.
- Relations format now supports both legacy string PIDs (from user-saved builds via `persist.js`) and the canonical `[{pid, quantity}]` format from the schema and seed data.
- All 92 tests pass. Seed verified: 33 categories, 3,113 components, 13 drone models, 3 build guides.

---

## Session 2026-03-08-4 — FPV Academy, Dynamic Versioning & DroneClear Rebrand

**Agent**: Claude
**Branch**: `claude/elastic-brattain`
**Commit(s)**: `274812a`, `8bb53b8`

### Summary
Built the FPV Academy educational module (FEAT-014) — an 8-section learning hub for FPV beginners covering components, size classes, video systems, compatibility rules, first build checklist, tips, and glossary. Also added a git-based dynamic version context processor, rebranded "DroneClear Configurator" → "DroneClear" with red gradient logo, and activated the Mission Control FPV Academy card.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | FPV Academy page — hero, 8 topic cards, 8 `<details>` article sections with tables, callouts, glossary | `academy.html` (new) |
| feat | FPV Academy CSS — `acad-` prefixed styles, accent colors, responsive, dark mode | `academy.css` (new) |
| feat | FPV Academy JS — IIFE with card→article scroll/open, back-to-top, smooth anchors | `academy.js` (new) |
| feat | Dynamic build version from git — context processor injects `dc_version` into all templates | `droneclear_backend/version.py` (new), `settings/base.py` |
| style | Rebrand logo: "DroneClear Configurator" → "DroneClear", red gradient, 32px | `layout.css`, all 7 HTML templates |
| style | Replace hardcoded version string with `{{ dc_version }}` template tag | all 7 HTML templates |
| feat | Activate FPV Academy card on Mission Control (div→a, remove coming-soon) | `mission-control.html` |
| feat | Add FPV Academy sidebar link on all 6 existing pages | `index.html`, `editor.html`, `template.html`, `guide.html`, `audit.html`, `mission-control.html` |
| fix | Add `?v=3` cache buster to layout.css across all templates | all 7 HTML templates |
| feat | Register `/academy/` URL route | `droneclear_backend/urls.py` |
| docs | Build version convention documented in CLAUDE.md | `CLAUDE.md` |

### Backlog Updates
- Completed: FEAT-014

### Notes
- Academy uses native `<details>/<summary>` for accessible no-JS accordion behavior.
- Content seeded from `docs/fpv_domain_knowledge.md` — covers the full beginner journey from "What is FPV?" to glossary of terms.
- Version context processor reads `git rev-list --count HEAD` and `git rev-parse --short HEAD` once at server startup — zero per-request overhead.
- Logo uses CSS `background-clip: text` with `var(--accent-red)` → `var(--accent-darkred)` gradient.
- Cache buster `?v=3` on `layout.css` was necessary to pick up the logo size change — browser was serving stale stylesheet despite dev server restart.

---

## Session 2026-03-08-3 — Mission Control Dashboard (FEAT-013) & FPV Academy Placeholder (FEAT-014)

**Agent**: Claude
**Branch**: `claude/crazy-lovelace`
**Commit(s)**: `0046f04`

### Summary
Added a Mission Control welcome page as the new root `/` landing page. Displays live system stats, 6 module navigation cards (with per-card accent colors), and a "Coming Soon" FPV Academy placeholder. Model Builder moved to `/builder/`. All 6 pages updated with new sidebar navigation.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | Mission Control page — hero, live stats, module cards grid, About section | `mission-control.html` (new) |
| feat | Mission Control CSS — `mc-` prefixed styles, accent colors, responsive grid, dark mode | `mission-control.css` (new) |
| feat | Mission Control JS — parallel API fetch for stats with graceful degradation | `mission-control.js` (new) |
| feat | FPV Academy "Coming Soon" placeholder card with purple accent badge | `mission-control.html` |
| refactor | URL routing — Mission Control at `/`, Model Builder moved to `/builder/` | `droneclear_backend/urls.py` |
| refactor | Sidebar nav updated on all 5 existing pages — added Mission Control link, updated builder href | `index.html`, `editor.html`, `template.html`, `guide.html`, `audit.html` |

### Backlog Updates
- Completed: FEAT-013
- Added: FEAT-013 (Mission Control dashboard), FEAT-014 (FPV Academy educational module — next sprint)

### Notes
- Mission Control icon is `ph-command` (command center feel, matches drone/aerospace theme).
- Stats fetch uses `textContent` assignment (inherently XSS-safe, no `escapeHTML()` needed).
- FPV Academy activation requires: change `<div>` to `<a href="/academy/">`, remove `mc-card-coming-soon` class, add route + sidebar link.
- The maintenance JS (restart, bug report, reset) is duplicated from other pages — reinforces DEBT-007.

---

## Session 2026-03-08-2 — Guide Media Upload (FEAT-007) & StepPhoto Validation (SEC-003)

**Agent**: Claude
**Branch**: `claude/vigilant-dirac`
**Commit(s)**: `31ae493`, `d384773`

### Summary
Implemented direct file upload for guide step media (FEAT-007) with a production-ready architecture using Django's storage API for future cloud migration. Created shared validation module that also fixes SEC-003 (StepPhotoUploadView lacked file validation). Added upload button UI to guide editor with thumbnail previews and toast notifications.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | `GuideMediaFile` model — UUID PK, `FileField` with storage API, compartmentalized by guide PID | `components/models.py`, `migrations/0010_guidemediafile.py` |
| feat | `GuideMediaUploadView` — POST `/api/guide-media/upload/` with full validation pipeline | `components/views.py`, `components/urls.py` |
| feat | Shared upload validation module — size (10MB), MIME whitelist, PIL verify, UUID filenames | `components/upload_utils.py` (new) |
| feat | Guide editor upload button + thumbnail preview + toast notifications | `guide-editor.js`, `guide-state.js`, `guide.css` |
| fix | SEC-003: StepPhotoUploadView now validates file size, MIME type, and image content | `components/views.py` |
| test | 10 new tests — 8 for GuideMediaUpload, 2 for StepPhoto validation (92 total) | `components/tests.py` |
| config | Upload size limits in Django settings | `droneclear_backend/settings/base.py` |
| docs | Updated CLAUDE.md — Claude is sole developer (removed multi-agent section) | `CLAUDE.md` |

### Backlog Updates
- Completed: FEAT-007, SEC-003

### Notes
- **Production migration path**: Swap `STORAGES["default"]` to S3/Azure backend — all `GuideMediaFile.file.url` calls automatically return signed/CDN URLs. Zero code changes needed.
- Files stored at `guide_media/<guide_pid>/<uuid>.<ext>` for per-guide access policies.
- `upload_utils.py` is reusable for any future upload endpoint.
- `alert()` dialogs in upload handler replaced with `showToast()` for consistent UX.

---

## Session 2026-03-08-1 — Data Integrity Fixes (BUG-001 through BUG-004)

**Agent**: Claude
**Branch**: `claude/hungry-ishizaka`
**Commit(s)**: `fd83ba8`

### Summary
Resolved all four high-priority data integrity bugs identified in the codebase audit. Fixed cascade-delete of photos on guide edit, serial number race condition, audit trail immutability violation, and missing transaction wrapping. Added 10 new tests (82 total).

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| fix | BUG-001: StepPhoto.step FK changed to SET_NULL; serializer update() rewritten to update-in-place instead of delete+recreate | `models.py`, `serializers.py` |
| fix | BUG-002: Serial number generation wrapped in transaction.atomic() with select_for_update() and 3-attempt retry | `views.py` |
| fix | BUG-003: BuildEvent.session FK changed from CASCADE to PROTECT; BuildSession.guide FK changed to SET_NULL | `models.py` |
| fix | BUG-004: ImportPartsView uses per-item transaction.atomic() savepoints | `views.py` |
| fix | Null guards for StepPhoto.step in audit view and __str__ | `views.py`, `models.py` |
| test | 10 new tests for all four fixes across 4 test classes | `tests.py` |
| migration | 0009_data_integrity_fixes — alters BuildEvent, BuildSession, StepPhoto FKs | `migrations/0009_data_integrity_fixes.py` |

### Backlog Updates
- Completed: BUG-001, BUG-002, BUG-003, BUG-004

### Notes
- The PROTECT on BuildEvent means sessions with audit events cannot be deleted without explicitly removing events first — this is intentional for audit trail integrity.
- SET_NULL on BuildSession.guide means guide_snapshot (frozen at build start) is the source of truth for audit, not the live guide FK.
- The serializer update-in-place approach matches steps by `order` field, preserving step IDs and their photo FK references.
- ResetToGoldenView was already protected by `@transaction.atomic` on `seed_golden()` — no change needed.

---

## Session 2026-03-07-1 — Golden Seed, Schema Merge, Guide Fixes & Build Components Panel

**Agent**: Claude
**Branch**: `claude/great-sinoussi`
**Commits**: `8ebb110`, `c458ddb`, `5743ae7`, `c92defb`, `8fcbbf1`, `b618870`, `b724789`

### Summary
Major data foundation session: seeded the database with 3,113 real FPV drone parts from golden seed JSON files (12 categories), merged 79 missing fields into schema blueprints, and added a Reset to Examples button on all pages. Fixed guide page getCookie bug, added Build Components quick-select panel to the guide step editor (so linked drone model parts appear as one-click toggle buttons instead of requiring PID search), and fixed guide save failure caused by DRF 400 validation on blank step title/description.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | Golden seed system — 3,113 real parts auto-seeded via post_migrate signal | `components/seed.py`, `components/apps.py`, `docs/golden_parts_db_seed/*.json` (12 files) |
| feat | Reset to Examples button on index, editor, template pages | `index.html`, `editor.html`, `template.html` |
| feat | Build Components quick-select panel in guide step editor | `guide-editor.js`, `guide.html`, `guide.css` |
| fix | Merge 79 seed data fields into schema v3 blueprints | `drone_parts_schema_v3.json` (both root and frontend copies) |
| fix | Add missing `utils.js` import to guide page (getCookie not defined) | `guide.html` |
| fix | Allow blank title/description on BuildGuideStep for new empty steps | `components/models.py`, `components/serializers.py`, migration `0008` |
| docs | FPV domain knowledge file, updated CLAUDE.md with seed data and domain docs | `docs/fpv_domain_knowledge.md`, `CLAUDE.md` |

### Backlog Updates
- Completed: FEAT-010, FEAT-011, FEAT-012, BUG-005, BUG-006, BUG-007
- Added: FEAT-010 through FEAT-012, BUG-005 through BUG-007 (all completed this session)

### Notes
- Golden seed loads once via `post_migrate` signal; subsequent migrations skip if data exists. `reset_to_golden` management command available for full reset.
- Build Components panel resolves the UX gap where guide step editors required manual PID entry despite having a linked drone model with all parts already associated.
- The `allow_blank` fix on BuildGuideStep was necessary because "+ Add Step" creates steps with empty fields — DRF's default validation rejects blank strings even with `required=False`.
- FPV domain knowledge (`docs/fpv_domain_knowledge.md`) is a living document capturing compatibility rules, naming conventions, and retailer patterns discovered during seed data analysis.

---

## Session 2026-03-06-4 — Documentation Refactor

**Agent**: Claude
**Branch**: `claude/frosty-johnson`
**Commit**: `fb404c9`

### Summary
Refactored the 710-line README into a modular documentation system. Created BACKLOG.md as single source of truth for tracked issues, CHANGELOG.md for session history, CLAUDE.md for session context, and `/close-session` slash command for standardized session-close workflow.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| docs | Slim README from 710 → ~120 lines | `README.md` |
| docs | Extract architecture reference | `docs/ARCHITECTURE.md` |
| docs | Extract model reference | `docs/MODELS.md` |
| docs | Extract feature reference | `docs/FEATURES.md` |
| docs | Create living backlog (37 items migrated from AUDIT_REPORT) | `BACKLOG.md` |
| docs | Create session changelog | `CHANGELOG.md` |
| docs | Create project instructions with session-close procedure | `CLAUDE.md` |
| docs | Create /close-session slash command | `.claude/commands/close-session.md` |
| docs | Archive original audit report | `docs/archive/AUDIT_REPORT.md` |

### Backlog Updates
- Added: All items from AUDIT_REPORT.md migrated with permanent IDs (SEC-001–005, BUG-001–004, DEBT-001–008, POLISH-001–015, FEAT-001–009)
- XSS-M1 through XSS-M5 marked as completed (already resolved in prior session)

### Notes
This session establishes the documentation system going forward. All future sessions should use `/close-session` to maintain the backlog and changelog. The AUDIT_REPORT.md has been archived — its content lives in BACKLOG.md and this changelog.

---

## Session 2026-03-06-3 — XSS Vulnerability Fixes

**Agent**: Claude
**Branch**: `claude/frosty-johnson`
**Commit**: `3c3cfcc`

### Summary
Resolved all remaining innerHTML XSS vulnerabilities (M1-M5 from the codebase audit). Applied `escapeHTML()` to all database-sourced content injected via innerHTML. Replaced inline `onclick` handlers with `data-*` attributes + `addEventListener` to eliminate JS-context injection vectors.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| fix | Card PID, name, manufacturer, description, tags, compat badges, price, weight, image src | `components.js` |
| fix | Tags, spec labels/values, compat labels/values, similar item cards | `modal.js` |
| fix | Build slot names, price, weight; warning titles/messages | `build.js` |
| fix | Build summary names; saved builds list; onclick→data-pid+addEventListener | `persist.js` |
| fix | Item row PIDs and names | `editor.js` |

### Backlog Updates
- Completed: XSS-M1, XSS-M2, XSS-M3, XSS-M4, XSS-M5

---

## Session 2026-03-06-2 — Django Test Suite

**Agent**: Claude
**Commit**: `c41e452`

### Summary
Added 72-test Django test suite covering all API endpoints and models. Tests span 13 test classes including model constraints, CRUD operations, import/export round-trip, serial number generation, snapshot immutability, event append-only enforcement, photo SHA-256 integrity, and schema validation.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| test | 72 tests across 13 test classes | `components/tests.py` |

---

## Session 2026-03-06-1 — Comprehensive Codebase Audit & Refactor

**Agent**: Claude
**Branch**: `claude/trusting-galileo`
**Commits**: `ac8ed79`, `f9d5c2f`

### Summary
Full codebase audit across all backend (20 files) and frontend (19 JS, 6 CSS, 5 HTML) files. Fixed XSS in showToast, regex bug in template.js, broken DOM in index.html, CSRF token gaps, missing CSS variables and dependencies. Cleaned up dead files, organized archives. Added Reset to Golden feature and fixed import button UX. Produced AUDIT_REPORT.md with prioritized backlog of remaining issues.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| fix | XSS in `showToast()` — added `escapeHTML()` | `utils.js` |
| fix | Regex bug `/s+/g` → `/\s+/g` | `template.js` |
| fix | Orphaned DOM elements, stale v2 reference | `index.html` |
| fix | Build drawer shortcut class check | `shortcuts.js` |
| fix | CSRF tokens on 10+ mutating fetch calls | `editor.js`, `template.js`, `guide-state.js`, `guide-editor.js` |
| fix | `datetime.now()` → `timezone.now()` | `views.py` |
| fix | N+1 query — added `select_related('category')` | `views.py` |
| feat | Reset to Golden endpoint + UI button | `views.py`, `urls.py`, `index.html`, `editor.html`, `template.html` |
| feat | Import button always visible (empty DB fix) | `editor.html`, `editor.js` |
| refactor | Missing CSS variables, dependency pins, dead CSS, imports consolidation | Multiple files |
| docs | AUDIT_REPORT.md, architecture diagram | Root level |

---

## Session 2026-03-06-0 — Build Audit Module (Tier 10)

**Agent**: Claude
**Branch**: `claude/trusting-galileo`
**Commit**: `8ab4e56`

### Summary
Designed and implemented the entire Build Audit module in a single session — 16 files touched, 4 new files created, ~700 lines of new code. Added immutable event logging, guide/component snapshots frozen at build start, SHA-256 photo hashing, and a full audit viewer with serial lookup, event timeline, step accordion, BOM table, and integrity verification panel.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | Audit viewer page | `audit.html`, `audit.js`, `audit.css` |
| feat | BuildEvent model (append-only, 8 event types) | `models.py`, `migrations/0007_build_audit.py` |
| feat | Guide/component snapshots, step timing, SHA-256 | `models.py`, `views.py`, `serializers.py` |
| feat | Event emission + sendBeacon fallback | `guide-state.js`, `guide-runner.js` |
| feat | Audit API endpoints | `urls.py`, `views.py` |
| feat | Sidebar nav links on all pages | `guide.html`, `editor.html`, `template.html`, `index.html` |

---

## Historical Summary (Pre-Changelog)

Tiers 1–10 were completed between 2026-02-21 and 2026-03-06 across ~20 sessions.

| Tier | Focus | Key Deliverables |
|------|-------|-----------------|
| 1 | Core | Schema editor, parts CRUD, model builder |
| 2 | UX | Dark mode, keyboard shortcuts, filter/sort, list view, save/load builds |
| 3 | UI hardening | Inline confirmations, sidebar meta drawer, true black mode, Quick Add, wizard compat highlighting |
| 4 | Schema hardening | v3 schema with `_type`, `_required`, `_unit`, `_compat_hard`/`_compat_soft`; bulk import/export; LLM-assisted import |
| 5 | Data population | 836 components scraped from RotorVillage.ca; modal cleanup; card thumbnails; 5→12 compat checks; stack awareness; wizard overhaul (9→12 steps) |
| 6 | Build Guide + Filters | Dynamic category-specific filters; Build Guide module with serial tracking, photo capture, STL viewer, Betaflight CLI; 4 new Django models; seed data |
| 7 | Guide UX overhaul | Media carousel + lightbox; video embeds; editor media list; step transitions; build timer; step notes; markdown checklists; runner layout overhaul; nav bar grid |
| 8 | Parts integration | Batch PID endpoint; component resolution; overview enrichment; configurable checklist fields (13 options, max 5); runner component cards; editor component chips; scroll fix; 630+ real parts imported |
| 9 | Guide Editor UX | Drag-and-drop step reordering; collapsible step detail; Add Step restyle; action bar hierarchy |
| 10 | Build Audit | Audit page; BuildEvent model (append-only); guide/component snapshots; SHA-256 photo hashing; event emission with sendBeacon; audit viewer with timeline, accordion, BOM, integrity panel |
