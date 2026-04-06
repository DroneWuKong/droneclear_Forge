# Changelog

## [Session — Analytics Overhaul + Gap Analyzer + Groq] - 2026-04-06

### Added
- **Gap Analyzer** — slide-in panel in Wingman AI; auto-detects entity pairs from conversation, compares spec/compliance/supply chain gaps via AI, color-coded gap cards with severity, "open chat" CTA
- **Trends tab** on analytics.html — 30/60/90-day PIE projections, R² confidence, sparklines, anomaly detection; reads from pie_trends.json (no password gate)
- **Usage tab** on analytics.html — page views, sessions, Wingman query categories, top gap entity pairs, surface breakdown, daily activity spark (behind admin gate)
- **Admin gate** on User Signals + Usage tabs — password prompt (key: forge-admin-2026), session-persisted, auto-unlocks via ?key= param
- **Groq/Llama proxy** (netlify/functions/groq-proxy.mjs) — rate-limited server-side proxy for Groq API; mirrors gemini-proxy pattern
- **Groq provider in Wingman** — three-button provider selector: Gemini (free) · Groq/Llama (free) · Claude (private BYOK); model chip rotates between public providers; Groq BYOK optional
- Page-level event tracking injected into patterns.html, intel.html, platforms.html, patterns-home.html
- Gap analysis run events tracked (entity pairs, gap count, critical count, provider)
- pie_trends.json + pie_predictions.json + llm_predictions.json reported in build

### Changed
- analytics.mjs batch event handler — was silently dropping all page_view/click/scroll events; now handles type:batch + type:gap_analysis
- analytics.html GET response includes summary block (pageViews, searches, compares, gapRuns, bySurface)
- Wingman model chip cycles gemini-2.5-flash ↔ llama-3.3-70b for public users (Claude excluded from cycle)
- analytics.html DASH_FN added — fetches from analytics-dashboard function for richer usage data

### Fixed
- bluefairy.netlify.app analytics dashboard was fetching from forgeprole.netlify.app (wrong alias) — all 5 URLs updated to nvmillbuilditmyself.com


## [Military Firmware + DB Expansion] - 2026-04-05

### Added
- **military_firmware** category (8 entries) — MILELRS v2.30 (ELRS 3.3.2 fork, multiband encrypted), MILBETA v1.23 (Betaflight fork, EW OSD), BarvinokLRS (independent Ukrainian control link), Barvinok-5 Video (encrypted FHSS digital video, prototype), "1001" DJI mod (Russian, 200K drones, disrupted), CIAJeepDoors (DJI Remote ID disable), mLRS (LoRa RC+MAVLink 7-87 km), DroneBridge ESP32 (AES-256 telemetry bridge)
- `docs/Military_Firmware_Forks.docx` — comprehensive reference document covering all 9 military firmware systems with Forge DB entry specs, handbook integration plan, and sources

### Changed
- Total components: 3575 → 3583 (8 new military firmware entries)
- Total categories: 31 → 32

## [5 New Component Categories] - 2026-04-04

### Added
- **c2_datalinks** (13 entries) — uAvionix microLink/muLTElink, Silvus SC4200EP/SL5200, CubePilot Herelink, Ultra ADSI gateway, DTC BluSDR/SOL8SDR, L3Harris AMORPHOUS swarm C2, XTEND XOS, Shield AI Hivemind, PDW Blackwave, Kutta KGS
- **ew_systems** (14 entries) — DroneShield DroneGun Tactical/Mk4/DroneSentry/RfPatrol, Flex Force Dronebuster, D-Fend EnforceAir2, NT Service EDM4S SkyWiper, infiniDome GPSdome, Aselsan KORAL, Raytheon NGJ-MB, Krasukha-4, Murmansk-BN, Pole-21, GIDS Spider-AD
- **navigation_pnt** (12 entries) — SBG Pulse-40, Inertial Labs VINS/M-AJ-QUATRO, Advanced Nav Boreas D90/Certus Evo, Honeywell HGuide o480, Infleqtion Tiqker/quantum IMU, Q-CTRL Ironstone Opal, ModalAI VIO, Teledyne DVL+INS, Anello photonic INS
- **ai_accelerators** (13 entries) — Hailo-8/10H, Ambarella CV5/CV7, Google Coral, Kneron KL720, DeepX DX-M1, NVIDIA Jetson Orin Nano, Qualcomm RB5, Intel Movidius, Kinara Ara-2, Axelera Metis (214 TOPS), Syntiant NDP250
- **ground_control_stations** (13 entries) — Inspired Flight GS-ONE, QGroundControl, Mission Planner, MAVProxy, MotioNew M10, UgCS, Winmate rugged, GA-ASI Advanced Cockpit, ARK Just a Jetson, UAV Nav VECTOR, Veronte, Auterion Mission Control, VOTIX DroneOS
- 5 new categories added to `build_static.py` COMPONENT_CATEGORIES for data sync persistence

### Changed
- Total components: 3510 → 3575 (65 new entries across 5 categories)
- Total categories: 26 → 31

## [Data Quality Gate] - 2026-04-02

### Added
- `miners/validate_entry.py` — quality gate that validates part names, manufacturers, categories, and PIDs before any mined data enters the DB
- Validation wired into all 3 commercial miners (`mine_getfpv.py`, `mine_rdq.py`, `mine_manufacturer.py`) — garbage entries are logged and rejected before merge

### Fixed
- Removed 9 garbage entries from `forge_database.json` (empty names, generic "VTX"/"VTX SMA" entries from vtx.in.ua scraper)
- Removed 34 exact duplicate entries across frames, VTX, receivers, and motors
- Fixed 261 missing manufacturer fields by extracting brand names from product names (Gemfan, HQProp, Lumenier, RunCam, DALProp, iFlight, etc.)
- Total parts: 3553 → 3510 (cleaner, no junk in front of users)

## [Firmware Miner + Bulk Data Enrichment] - 2026-04-02

### Added
- Firmware config miner (`miners/firmware/mine_firmware_configs.py`) — mines 1,717 target definitions from Betaflight (1,027), iNav (214), ArduPilot (419), PX4 (57) source repos
- Wingman RAG now indexes firmware target configs with dedicated context formatting
- FW Targets stat card on Wingman dashboard
- Platform image scraper (`miners/enrichment/fetch_platform_images.py`) for OG image extraction
- 23 verified Wikimedia Commons platform images (DJI, Baykar, Skydio, Parrot, Shield AI, etc.)
- Appendix B: UART Maps for 416 common FCs (handbook)

### Changed
- Receiver `frequency_ghz`: 30% → 100% (277 filled via protocol pattern matching)
- ESC `continuous_current_a`: 0% → 89% (148 filled from name)
- Motor `kv`: 0% → 93% (282 filled from name)
- Motor `stator_diameter_mm`: 95% → 99% (14 filled)
- GPS `constellations` + `gnss_chipset`: 0% → 71% (53 filled)
- Propeller `diameter_inches` / `pitch_inches`: 0% → 82% (399 filled)
- FC `is_aio`: 38% → 100% (197 classified)
- Receiver `size_class`: 32% → 56% (94 classified)
- FC `mcu_family`: 9 cross-referenced from firmware miner
- ESC `cell_count`: 6 filled from voltage range
- `build_static.py`: added fetch rewrite for `forge_firmware_configs.json`

## [Wingman UI — Forge Layout Redesign] - 2026-03-25

### Added
- Wingman AI chat tool (wingman.html) — AI-powered drone troubleshooting with GitHub repo fetch + live web search + multi-image visual triage
- Wingman AI deployed as standalone HTML at /wingman/ route
- Orqa POC mode toggle in Wingman AI (orange theme, Orqa product persona)

### Changed
- layout.css: compact Wingman-style topbar across all pages (10px padding vs 30px, no backdrop-filter)
- layout.css: page titles now prefixed with // in monospace cyan
- layout.css: nav active state uses cyan fill instead of gradient border
- layout.css: content-body padding tightened (28px vs 40px)
- mission-control.html (The Bench): welcome card replaced with centered floating bubble layout
- The Bench: 4-column stat grid (Categories / Platforms / Components / Build Guides)
- The Bench: // Quick Launch pill links including Wingman AI entry point


## [Intel Lobby Feeds] - 2026-03-23

### Added
- `/intel-defense/` â Defense feed with lobby mode (red accent)
- `/intel-financial/` â Financial/contract feed with lobby mode (amber accent)
- `/intel-commercial/` â Commercial/COTS feed with lobby mode (teal accent)
- All three pages: source filter, full-text search, `?lobby=1` kiosk URL
- Intel Feed card on mission-control with DEF/FIN/COM quick-launch buttons

### Fixed
- `build_static.py`: now fetches intel JSON from `dronewukong.github.io/forge-data/intel/`
  via urllib â no auth, no Ai-Project clone required
- Removed `data/intel-db` from sparse checkout (data now flows via forge-data pipeline)

### Data Flow
`Ai-Project/data/intel-db/` â `sync-forge-data.yml` â `forge-data/intel/` â build fetches â `/static/intel_*.json`

# DroneClear Changelog

> Session-by-session development log. Newest sessions at the top.
> Each entry is written at session close using `/close-session`.

---

## Session 2026-03-22 (cont.) â MafiaLRS Target Database Import

**Agent**: Claude
**Branch**: `master`

### Summary
Full parse of BUSHA/targets@mafia-targets repo (Ukrainian MafiaLRS ELRS fork).
377 device targets extracted (254 RX, 123 TX) across 65 manufacturer groups.
376 net-new entries merged into Forge DB. Total components now 3,533.

### Added
- 254 new RX entries from MafiaLRS target database
- 122 new TX entries added to control_link_tx category
- All entries include: platform, firmware type, lua_name, layout_file, upload_methods, min_fw_version
- Source attributed: BUSHA/targets@mafia-targets (vtx.in.ua ecosystem)

### Data Highlights
- 73 Ukrainian-origin devices (50 RX + 23 TX): AERONETIX, BAYCKRC, AYZ, Cyclone, FPV Mafia, Flytex, DiFly, STELLAR/Stingbee, Edifier, BelinRC, MaxLink
- 60 non-standard/combat frequency devices (433/490/500/520/560/735 MHz) tagged ew_resistant
- 80 LR1121 wideband devices (150 MHzâ2.1 GHz) tagged lr1121, wideband_150_2100mhz
- Tags applied per entry: elrs, mafiÐ°Ð»rs_compatible, ukraine, combat_proven, non_standard_freq, lr1121, dual_band as appropriate

### Changed
- receivers: 140 â 394
- control_link_tx: 15 â 137

---

## Session 2026-03-23 â Intel Hub, Miners, Currency Picker, 7-Company Deep Mine

**Agent**: Claude
**Branch**: `master`
**Commits**: 20+

### Summary
Built Industry Intel hub (/intel/) with Commercial/Defense/Finance tabs, created 4 miner scripts for automated data extraction, added global currency picker (11 currencies), deep-mined 7 defense companies (Shield AI, Fortem, Red Cat, Tekever, XTEND, Firestorm, Doodle Labs), mined Obsidian Sensors from spec sheet, fixed mobile drawer, enriched GCS/thermal/contracts/funding data, completed parts pricing to 99.7%, and wrote comprehensive extraction plan for 20+ future miners.

### Changes
| Category | Description |
|----------|-------------|
| feat | **Industry Intel hub** (`/intel/`) â 3-tab dashboard: Commercial (sources, manufacturers), Defense (contracts, Blue UAS, regulatory), Finance (funding rounds, deals) |
| feat | **Currency picker** â 11 currencies (USD/EUR/GBP/UAH/PLN/HRK/TRY/ILS/AUD/CAD/JPY), persists via localStorage, wired to all price displays |
| feat | Component cloning (FEAT-001), Build CSV export (FEAT-002), Audit print/PDF (FEAT-009) |
| feat | Modal price/country/source chips â replace raw spec rows |
| feat | 4 miner scripts: mine_dronelife.py, mine_sbir.py, mine_blueuas.py, mine_all.py |
| fix | Mobile build drawer (100dvh), Obsidian country USA (was Ukraine from shop sync) |
| fix | UAHâUSD conversion for 163 parts |
| data | **Obsidian Sensors** deep mine â 6 products from spec sheet + research |
| data | **7-company intel mine**: Shield AI ($12B talks), Fortem (Replicator 2), Red Cat (RCAT), Tekever (â¬1.33B unicorn), XTEND, Firestorm, Doodle Labs |
| data | Parts pricing: 6% â 99.7% (3,528/3,538) |
| data | Thermal sensors: 28% â 66%, Contracts: 14% â 26%, Funding: 22% â 36%, GCS: 26% â 51% |
| data | forge_intel.json: 28 funding + 29 contracts + 8 grants = 65 entries |
| debt | 12/12 DEBT closed, 11/13 POLISH closed (2 WONTFIX), 3/8 FEAT closed |
| docs | OpenIPC handbook section, Industry Intelligence handbook page |
| docs | EXTRACTION_PLAN.md â 20+ miner architecture, 4-week schedule |
| docs | Obsidian Sensors intel report (EN + HR PDFs) |

### Backlog Updates
- FEAT-001/002/009: Closed
- POLISH-003/009/010/011/012/015/016/017/018/019/020: Closed
- Remaining: FEAT-003/004/005/006/008 (need backend)




---
## Session 2026-03-22 â vtx.in.ua Database Cross-Check & Ukrainian Component Import

**Agent**: Claude
**Branch**: `master`

### Summary
Full scrape and cross-reference of vtx.in.ua against Forge DB. Site runs on a single Google Sheet (community-maintained, updated daily). 737 catalog entries parsed across 5 tabs. 199 new entries merged into forge_database.json. 4 entirely new component categories added.

### Added
- 199 Ukrainian-sourced component entries (vtx.in.ua, verified March 2026)
- 4 new component categories: `fpv_detectors`, `payload_droppers`, `video_scramblers`, `control_link_tx`
- 30 FPV signal detector products ($57â$1,073) â Ukrainian counter-UAS detection ecosystem (VIDIK, KARA DAG, BlueBird, Kseonics, ÐÐÐÐÐ, FPV Mafia, etc.)
- 5 payload dropper systems incl. Carrier Electronics FPV v1.3/v2.0 + Mavic 3 kits
- 5 video scrambler/encryption products (Sezam video, Carrier Electronics Chameleon)
- 15 Ukrainian control link TX units (COALAS, Radion MaxLink, Ð§ÐÐ, Aeronetix LR1121)
- 21 UA VTX products (Stingbee, DEC1, FT, Flytex, KaraFPV, Scream Industries)
- 22 UA FC products (603700 Halychyna/Boryspil, Bloomtech, DiFly, FT, Flytex, Kiwi, Stingbee)
- 13 UA ESC products (603700 Frankivsk/Stryi, DiFly, FT, Flytex, KaraFPV, LEADER Tech, SkyPulse, Stingbee)
- 15 UA FC+ESC stacks, 22 UA frames, 13 UA props, 13 UA RX, 15 UA motors

### Changed
- video_transmitters: 103 â 124
- receivers: 127 â 140
- motors: 288 â 303
- flight_controllers: 300 â 322
- escs: 152 â 165
- stacks: 99 â 114
- frames: 355 â 377
- propellers: 471 â 484
- fpv_cameras: 190 â 193
- thermal_cameras: 31 â 38

---

---

## Session 2026-03-08-5 â Seed Drone Models, Build Guides & Bug Fixes

**Agent**: Claude
**Branch**: `claude/xenodochial-panini`
**Commit(s)**: *(see below)*

### Summary
Created 12 curated seed drone models and 3 expert-quality build guides (42 total steps) as golden seed data. Fixed critical relations format mismatch across frontend and backend that caused `[object Object]` rendering and build session 500 errors. Replaced blocking `alert()` calls with toast notifications and added UI padding fix to build overview.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | 12 seed drone models (5"/6"/7"/10" builds) with real component PIDs | `docs/golden_parts_db_seed/drone_models.json` (new) |
| feat | 3 detailed build guides â freestyle, long range, HD digital â 42 steps with Betaflight CLI, safety warnings, tools | `docs/golden_parts_db_seed/build_guides.json` (new) |
| feat | Seed system loads drone models + build guides on golden reset and auto-seed | `components/seed.py`, `components/apps.py` |
| fix | Relations format: frontend now handles both string PIDs and `{pid, quantity}` objects | `guide-state.js`, `guide-selection.js`, `guide-editor.js` |
| fix | Build session 500 â `perform_create` crashed adding list to set from relations | `components/views.py` |
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

## Session 2026-03-08-4 â FPV Academy, Dynamic Versioning & DroneClear Rebrand

**Agent**: Claude
**Branch**: `claude/elastic-brattain`
**Commit(s)**: `274812a`, `8bb53b8`

### Summary
Built the FPV Academy educational module (FEAT-014) â an 8-section learning hub for FPV beginners covering components, size classes, video systems, compatibility rules, first build checklist, tips, and glossary. Also added a git-based dynamic version context processor, rebranded "DroneClear Configurator" â "DroneClear" with red gradient logo, and activated the Mission Control FPV Academy card.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | FPV Academy page â hero, 8 topic cards, 8 `<details>` article sections with tables, callouts, glossary | `academy.html` (new) |
| feat | FPV Academy CSS â `acad-` prefixed styles, accent colors, responsive, dark mode | `academy.css` (new) |
| feat | FPV Academy JS â IIFE with cardâarticle scroll/open, back-to-top, smooth anchors | `academy.js` (new) |
| feat | Dynamic build version from git â context processor injects `dc_version` into all templates | `droneclear_backend/version.py` (new), `settings/base.py` |
| style | Rebrand logo: "DroneClear Configurator" â "DroneClear", red gradient, 32px | `layout.css`, all 7 HTML templates |
| style | Replace hardcoded version string with `{{ dc_version }}` template tag | all 7 HTML templates |
| feat | Activate FPV Academy card on Mission Control (divâa, remove coming-soon) | `mission-control.html` |
| feat | Add FPV Academy sidebar link on all 6 existing pages | `index.html`, `editor.html`, `template.html`, `guide.html`, `audit.html`, `mission-control.html` |
| fix | Add `?v=3` cache buster to layout.css across all templates | all 7 HTML templates |
| feat | Register `/academy/` URL route | `droneclear_backend/urls.py` |
| docs | Build version convention documented in CLAUDE.md | `CLAUDE.md` |

### Backlog Updates
- Completed: FEAT-014

### Notes
- Academy uses native `<details>/<summary>` for accessible no-JS accordion behavior.
- Content seeded from `docs/fpv_domain_knowledge.md` â covers the full beginner journey from "What is FPV?" to glossary of terms.
- Version context processor reads `git rev-list --count HEAD` and `git rev-parse --short HEAD` once at server startup â zero per-request overhead.
- Logo uses CSS `background-clip: text` with `var(--accent-red)` â `var(--accent-darkred)` gradient.
- Cache buster `?v=3` on `layout.css` was necessary to pick up the logo size change â browser was serving stale stylesheet despite dev server restart.

---

## Session 2026-03-08-3 â Mission Control Dashboard (FEAT-013) & FPV Academy Placeholder (FEAT-014)

**Agent**: Claude
**Branch**: `claude/crazy-lovelace`
**Commit(s)**: `0046f04`

### Summary
Added a Mission Control welcome page as the new root `/` landing page. Displays live system stats, 6 module navigation cards (with per-card accent colors), and a "Coming Soon" FPV Academy placeholder. Model Builder moved to `/builder/`. All 6 pages updated with new sidebar navigation.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | Mission Control page â hero, live stats, module cards grid, About section | `mission-control.html` (new) |
| feat | Mission Control CSS â `mc-` prefixed styles, accent colors, responsive grid, dark mode | `mission-control.css` (new) |
| feat | Mission Control JS â parallel API fetch for stats with graceful degradation | `mission-control.js` (new) |
| feat | FPV Academy "Coming Soon" placeholder card with purple accent badge | `mission-control.html` |
| refactor | URL routing â Mission Control at `/`, Model Builder moved to `/builder/` | `droneclear_backend/urls.py` |
| refactor | Sidebar nav updated on all 5 existing pages â added Mission Control link, updated builder href | `index.html`, `editor.html`, `template.html`, `guide.html`, `audit.html` |

### Backlog Updates
- Completed: FEAT-013
- Added: FEAT-013 (Mission Control dashboard), FEAT-014 (FPV Academy educational module â next sprint)

### Notes
- Mission Control icon is `ph-command` (command center feel, matches drone/aerospace theme).
- Stats fetch uses `textContent` assignment (inherently XSS-safe, no `escapeHTML()` needed).
- FPV Academy activation requires: change `<div>` to `<a href="/academy/">`, remove `mc-card-coming-soon` class, add route + sidebar link.
- The maintenance JS (restart, bug report, reset) is duplicated from other pages â reinforces DEBT-007.

---

## Session 2026-03-08-2 â Guide Media Upload (FEAT-007) & StepPhoto Validation (SEC-003)

**Agent**: Claude
**Branch**: `claude/vigilant-dirac`
**Commit(s)**: `31ae493`, `d384773`

### Summary
Implemented direct file upload for guide step media (FEAT-007) with a production-ready architecture using Django's storage API for future cloud migration. Created shared validation module that also fixes SEC-003 (StepPhotoUploadView lacked file validation). Added upload button UI to guide editor with thumbnail previews and toast notifications.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | `GuideMediaFile` model â UUID PK, `FileField` with storage API, compartmentalized by guide PID | `components/models.py`, `migrations/0010_guidemediafile.py` |
| feat | `GuideMediaUploadView` â POST `/api/guide-media/upload/` with full validation pipeline | `components/views.py`, `components/urls.py` |
| feat | Shared upload validation module â size (10MB), MIME whitelist, PIL verify, UUID filenames | `components/upload_utils.py` (new) |
| feat | Guide editor upload button + thumbnail preview + toast notifications | `guide-editor.js`, `guide-state.js`, `guide.css` |
| fix | SEC-003: StepPhotoUploadView now validates file size, MIME type, and image content | `components/views.py` |
| test | 10 new tests â 8 for GuideMediaUpload, 2 for StepPhoto validation (92 total) | `components/tests.py` |
| config | Upload size limits in Django settings | `droneclear_backend/settings/base.py` |
| docs | Updated CLAUDE.md â Claude is sole developer (removed multi-agent section) | `CLAUDE.md` |

### Backlog Updates
- Completed: FEAT-007, SEC-003

### Notes
- **Production migration path**: Swap `STORAGES["default"]` to S3/Azure backend â all `GuideMediaFile.file.url` calls automatically return signed/CDN URLs. Zero code changes needed.
- Files stored at `guide_media/<guide_pid>/<uuid>.<ext>` for per-guide access policies.
- `upload_utils.py` is reusable for any future upload endpoint.
- `alert()` dialogs in upload handler replaced with `showToast()` for consistent UX.

---

## Session 2026-03-08-1 â Data Integrity Fixes (BUG-001 through BUG-004)

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
| migration | 0009_data_integrity_fixes â alters BuildEvent, BuildSession, StepPhoto FKs | `migrations/0009_data_integrity_fixes.py` |

### Backlog Updates
- Completed: BUG-001, BUG-002, BUG-003, BUG-004

### Notes
- The PROTECT on BuildEvent means sessions with audit events cannot be deleted without explicitly removing events first â this is intentional for audit trail integrity.
- SET_NULL on BuildSession.guide means guide_snapshot (frozen at build start) is the source of truth for audit, not the live guide FK.
- The serializer update-in-place approach matches steps by `order` field, preserving step IDs and their photo FK references.
- ResetToGoldenView was already protected by `@transaction.atomic` on `seed_golden()` â no change needed.

---

## Session 2026-03-07-1 â Golden Seed, Schema Merge, Guide Fixes & Build Components Panel

**Agent**: Claude
**Branch**: `claude/great-sinoussi`
**Commits**: `8ebb110`, `c458ddb`, `5743ae7`, `c92defb`, `8fcbbf1`, `b618870`, `b724789`

### Summary
Major data foundation session: seeded the database with 3,113 real FPV drone parts from golden seed JSON files (12 categories), merged 79 missing fields into schema blueprints, and added a Reset to Examples button on all pages. Fixed guide page getCookie bug, added Build Components quick-select panel to the guide step editor (so linked drone model parts appear as one-click toggle buttons instead of requiring PID search), and fixed guide save failure caused by DRF 400 validation on blank step title/description.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| feat | Golden seed system â 3,113 real parts auto-seeded via post_migrate signal | `components/seed.py`, `components/apps.py`, `docs/golden_parts_db_seed/*.json` (12 files) |
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
- The `allow_blank` fix on BuildGuideStep was necessary because "+ Add Step" creates steps with empty fields â DRF's default validation rejects blank strings even with `required=False`.
- FPV domain knowledge (`docs/fpv_domain_knowledge.md`) is a living document capturing compatibility rules, naming conventions, and retailer patterns discovered during seed data analysis.

---

## Session 2026-03-06-4 â Documentation Refactor

**Agent**: Claude
**Branch**: `claude/frosty-johnson`
**Commit**: `fb404c9`

### Summary
Refactored the 710-line README into a modular documentation system. Created BACKLOG.md as single source of truth for tracked issues, CHANGELOG.md for session history, CLAUDE.md for session context, and `/close-session` slash command for standardized session-close workflow.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| docs | Slim README from 710 â ~120 lines | `README.md` |
| docs | Extract architecture reference | `docs/ARCHITECTURE.md` |
| docs | Extract model reference | `docs/MODELS.md` |
| docs | Extract feature reference | `docs/FEATURES.md` |
| docs | Create living backlog (37 items migrated from AUDIT_REPORT) | `BACKLOG.md` |
| docs | Create session changelog | `CHANGELOG.md` |
| docs | Create project instructions with session-close procedure | `CLAUDE.md` |
| docs | Create /close-session slash command | `.claude/commands/close-session.md` |
| docs | Archive original audit report | `docs/archive/AUDIT_REPORT.md` |

### Backlog Updates
- Added: All items from AUDIT_REPORT.md migrated with permanent IDs (SEC-001â005, BUG-001â004, DEBT-001â008, POLISH-001â015, FEAT-001â009)
- XSS-M1 through XSS-M5 marked as completed (already resolved in prior session)

### Notes
This session establishes the documentation system going forward. All future sessions should use `/close-session` to maintain the backlog and changelog. The AUDIT_REPORT.md has been archived â its content lives in BACKLOG.md and this changelog.

---

## Session 2026-03-06-3 â XSS Vulnerability Fixes

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
| fix | Build summary names; saved builds list; onclickâdata-pid+addEventListener | `persist.js` |
| fix | Item row PIDs and names | `editor.js` |

### Backlog Updates
- Completed: XSS-M1, XSS-M2, XSS-M3, XSS-M4, XSS-M5

---

## Session 2026-03-06-2 â Django Test Suite

**Agent**: Claude
**Commit**: `c41e452`

### Summary
Added 72-test Django test suite covering all API endpoints and models. Tests span 13 test classes including model constraints, CRUD operations, import/export round-trip, serial number generation, snapshot immutability, event append-only enforcement, photo SHA-256 integrity, and schema validation.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| test | 72 tests across 13 test classes | `components/tests.py` |

---

## Session 2026-03-06-1 â Comprehensive Codebase Audit & Refactor

**Agent**: Claude
**Branch**: `claude/trusting-galileo`
**Commits**: `ac8ed79`, `f9d5c2f`

### Summary
Full codebase audit across all backend (20 files) and frontend (19 JS, 6 CSS, 5 HTML) files. Fixed XSS in showToast, regex bug in template.js, broken DOM in index.html, CSRF token gaps, missing CSS variables and dependencies. Cleaned up dead files, organized archives. Added Reset to Golden feature and fixed import button UX. Produced AUDIT_REPORT.md with prioritized backlog of remaining issues.

### Changes
| Category | Description | Files |
|----------|-------------|-------|
| fix | XSS in `showToast()` â added `escapeHTML()` | `utils.js` |
| fix | Regex bug `/s+/g` â `/\s+/g` | `template.js` |
| fix | Orphaned DOM elements, stale v2 reference | `index.html` |
| fix | Build drawer shortcut class check | `shortcuts.js` |
| fix | CSRF tokens on 10+ mutating fetch calls | `editor.js`, `template.js`, `guide-state.js`, `guide-editor.js` |
| fix | `datetime.now()` â `timezone.now()` | `views.py` |
| fix | N+1 query â added `select_related('category')` | `views.py` |
| feat | Reset to Golden endpoint + UI button | `views.py`, `urls.py`, `index.html`, `editor.html`, `template.html` |
| feat | Import button always visible (empty DB fix) | `editor.html`, `editor.js` |
| refactor | Missing CSS variables, dependency pins, dead CSS, imports consolidation | Multiple files |
| docs | AUDIT_REPORT.md, architecture diagram | Root level |

---

## Session 2026-03-06-0 â Build Audit Module (Tier 10)

**Agent**: Claude
**Branch**: `claude/trusting-galileo`
**Commit**: `8ab4e56`

### Summary
Designed and implemented the entire Build Audit module in a single session â 16 files touched, 4 new files created, ~700 lines of new code. Added immutable event logging, guide/component snapshots frozen at build start, SHA-256 photo hashing, and a full audit viewer with serial lookup, event timeline, step accordion, BOM table, and integrity verification panel.

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

Tiers 1â10 were completed between 2026-02-21 and 2026-03-06 across ~20 sessions.

| Tier | Focus | Key Deliverables |
|------|-------|-----------------|
| 1 | Core | Schema editor, parts CRUD, model builder |
| 2 | UX | Dark mode, keyboard shortcuts, filter/sort, list view, save/load builds |
| 3 | UI hardening | Inline confirmations, sidebar meta drawer, true black mode, Quick Add, wizard compat highlighting |
| 4 | Schema hardening | v3 schema with `_type`, `_required`, `_unit`, `_compat_hard`/`_compat_soft`; bulk import/export; LLM-assisted import |
| 5 | Data population | 836 components scraped from RotorVillage.ca; modal cleanup; card thumbnails; 5â12 compat checks; stack awareness; wizard overhaul (9â12 steps) |
| 6 | Build Guide + Filters | Dynamic category-specific filters; Build Guide module with serial tracking, photo capture, STL viewer, Betaflight CLI; 4 new Django models; seed data |
| 7 | Guide UX overhaul | Media carousel + lightbox; video embeds; editor media list; step transitions; build timer; step notes; markdown checklists; runner layout overhaul; nav bar grid |
| 8 | Parts integration | Batch PID endpoint; component resolution; overview enrichment; configurable checklist fields (13 options, max 5); runner component cards; editor component chips; scroll fix; 630+ real parts imported |
| 9 | Guide Editor UX | Drag-and-drop step reordering; collapsible step detail; Add Step restyle; action bar hierarchy |
| 10 | Build Audit | Audit page; BuildEvent model (append-only); guide/component snapshots; SHA-256 photo hashing; event emission with sendBeacon; audit viewer with timeline, accordion, BOM, integrity panel |
# Last build trigger: 2026-03-23 08:13 UTC
