# DroneClear Forge — Architecture

## Overview

Forge is a **static site** built from HTML/CSS/JS source files in `forge-source/`. A Python build script (`build_static.py`) copies and routes pages into `build/` for Cloudflare Pages deployment.

## Build Pipeline

```
forge-source/*.html  →  build_static.py  →  build/  →  Cloudflare Pages
                                              ↑
                                    Ai-Project/data/parts-db/*.json
                                    (pulled via sparse-checkout if GITHUB_PAT set)
```

## Data Flow

1. **Source of truth**: `DroneWuKong/Ai-Project` repo → `data/parts-db/*.json`
2. **Build-time sync**: `build_static.py` clones Ai-Project (sparse), merges all JSON into `forge_database.json`
3. **Fallback**: If no `GITHUB_PAT`, uses local `forge_database.json` (may be stale)
4. **Client-side**: Pages load `forge_database.json` via `<script>` tag, filter/render in browser

## Page Routing

Build script maps source HTML to clean URL paths:

| Source | Built To | URL |
|--------|----------|-----|
| `mission-control.html` | `index.html` | `/` (The Bench) |
| `index.html` | `builder/index.html` | `/builder/` |
| `academy.html` | `academy/index.html` | `/academy/` |
| `platforms.html` | `platforms/index.html` | `/platforms/` |
| `contribute.html` | `contribute/index.html` | `/contribute/` |
| ... | ... | See `PAGES` dict in `build_static.py` |

## Runtime evidence services

Static pages use same-origin Cloudflare Worker routes for bounded data APIs,
analytics, and the autonomous-evidence ledger. Ask PIE ranking remains
deterministic in the browser/API contract. Optional explicit feedback is written
to the append-only D1 evidence log for private human review; it cannot change
the live ranker. See [UAS Patterns autonomous evidence](AUTONOMOUS_EVIDENCE.md).

## Analytics

All pages include an inline analytics snippet that reports to the same-origin Cloudflare Worker endpoint `/api/analytics/ingest` (routed via `functions/api/[[path]].js` → `workers/analytics-ingest.js`). No cookies, no PII.

## Key Decisions

- **No application server.** Django was removed. Published data is static JSON;
  narrowly scoped same-origin Worker routes provide runtime APIs and evidence
  capture.
- **No framework.** Vanilla JS + CSS. No React, no build toolchain.
- **Data lives in Ai-Project.** Forge is a read-only consumer.
