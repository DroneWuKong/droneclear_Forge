# DroneClear Forge — Project Instructions

## Project Overview

DroneClear Forge is a **static site** that serves as the public-facing drone component browser, build planner, and integration guide hub. It deploys to **Cloudflare Pages** (project `forge`, see `wrangler.jsonc`) and is served at **uas-forge.com**. Dynamic endpoints run as Cloudflare Workers under `/api/*` (see `workers/` + `functions/api/[[path]].js`). Netlify has been retired.

## Quick Orientation

- **Static pages**: `forge-source/` — 20 HTML pages, ~20 JS files, ~7 CSS files
- **Build script**: `build_static.py` — Python script that copies HTML/CSS/JS into `build/` directory with proper routing
- **Data**: `forge-source/forge_database.json` — local fallback; build script pulls fresh data from Ai-Project repo if `GITHUB_PAT` env var is set
- **Domain knowledge**: `docs/fpv_domain_knowledge.md` — FPV drone expertise (compatibility rules, naming conventions, specs)
- **Backlog**: [BACKLOG.md](BACKLOG.md) — tracked issues
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) — session-by-session history

## Build & Deploy

```bash
python3 build_static.py    # Outputs to build/
# Cloudflare Pages auto-deploys from build/ on push to the default branch
```

Cloudflare Pages config is in `wrangler.jsonc` (`pages_build_output_dir: build`). Build command: `python3 build_static.py`. Redirects/headers live in `_redirects` / `_headers` (CF Pages format); `/api/*` routing is owned by `functions/api/[[path]].js` → `workers/index.js`.

### Environment Variables / Secrets (Cloudflare dashboard)

- `GITHUB_PAT` — repo read access to DroneWuKong/Ai-Project for fresh data sync. Without it, falls back to local stale data.
- `TURSO_URL`, `TURSO_AUTH_TOKEN` — FAA Part 107 airmen lookup (`workers/faa-lookup.js`).
- Worker API keys: `PRICES_API_KEY`, `ANALYTICS_*`, model proxy keys, doctrine KV/R2 bindings (see `wrangler.jsonc`).

## Architecture

- **No stateful application server.** Django was removed. Public pages remain
  static; versioned public/private data APIs run as Cloudflare Pages Functions
  over explicitly bound KV namespaces.
- **76 pages** (the `PAGES` dict in `build_static.py` is the source of truth) spanning the core surfaces — The Bench (home), Builder, Guide, Audit, Academy, Platforms, Browse, Contribute, Analytics, SLAM Selector — the integration guides (FC Firmware, Mesh, TAK, AI, C-UAS, Swarm, SLAM, Guides Hub), plus reference, legal, and intel pages.
- **Data flows from Ai-Project repo** → `data/parts-db/*.json` → merged into `forge_database.json` at build time.
- **Analytics** snippet injected into all pages, reporting to the same-origin Cloudflare Worker endpoint at `/api/analytics/ingest` (see `build_static.py` `_ANALYTICS_SNIPPET`). The canonical product domains are: `uas-forge.com` (Forge, this repo), `uas-handbook.com` (Handbook, `drone-integration-handbook` repo), `uas-patterns.com` (Patterns/PIE intel — **`uas-intel.com` has been merged into this**; old intel URLs 301 to `uas-patterns.com`). The `build_static.py` `rewrite_legacy_domains()` pass still normalizes any stray legacy vanity names (`uas-intel.com`, `illdoitmyself.com`, `uas-patterns.pro`) to their canonical equivalents at build time as a safety net; source files now use canonical domains directly.

## Key Files

| File | Purpose |
|------|---------|
| `build_static.py` | Static site generator |
| `wrangler.jsonc` | Cloudflare Pages config + KV/R2/queue bindings |
| `_redirects` / `_headers` | CF Pages redirect + header rules |
| `workers/` + `functions/api/[[path]].js` | `/api/*` Cloudflare Workers |
| `workers/public-api-v1.js` | Read-only `/api/v1/*` public contract |
| `workers/private-api-v1.js` | Bearer-gated `/api/private/v1/*` contract |
| `forge-source/*.html` | Source HTML pages |
| `forge-source/forge_database.json` | Local data fallback |
| `docs/fpv_domain_knowledge.md` | Domain expertise reference |
