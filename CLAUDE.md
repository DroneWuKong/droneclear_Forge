# DroneClear Forge — Project Instructions

## Project Overview

DroneClear Forge is a **static site** (no backend) that serves as the public-facing drone component browser, build planner, and integration guide hub. It deploys to **forgeprole.netlify.app** via Netlify.

## Quick Orientation

- **Static pages**: `DroneClear Components Visualizer/` — 20 HTML pages, ~20 JS files, ~7 CSS files
- **Build script**: `build_static.py` — Python script that copies HTML/CSS/JS into `build/` directory with proper routing
- **Data**: `DroneClear Components Visualizer/forge_database.json` — local fallback; build script pulls fresh data from Ai-Project repo if `GITHUB_PAT` env var is set
- **Domain knowledge**: `docs/fpv_domain_knowledge.md` — FPV drone expertise (compatibility rules, naming conventions, specs)
- **Backlog**: [BACKLOG.md](BACKLOG.md) — tracked issues
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) — session-by-session history

## Build & Deploy

```bash
python3 build_static.py    # Outputs to build/
# Netlify auto-deploys from build/ on push to master
```

Netlify config is in `netlify.toml`. Build command: `python3 build_static.py`, publish dir: `build`.

### Environment Variables (Netlify dashboard)

- `GITHUB_PAT` — repo read access to DroneWuKong/Ai-Project for fresh data sync. Without it, falls back to local stale data.

## Architecture

- **No backend.** Django was removed. All data is static JSON.
- **20 pages** across: The Bench (home), Builder, Guide, Audit, Academy, Platforms, Browse, Contribute, Analytics, SLAM Selector, and 8 integration guides (FC Firmware, Mesh, TAK, AI, C-UAS, Swarm, SLAM, Guides Hub).
- **Data flows from Ai-Project repo** → `data/parts-db/*.json` → merged into `forge_database.json` at build time.
- **Analytics** snippet injected into all pages, reporting to the Netlify Functions endpoint at `thebluefairy.netlify.app/.netlify/functions/analytics-ingest` (see `build_static.py:157`). The sibling product domains are: `nvmillbuilditmyself.com` (Forge, this repo), `illdoitmyself.com` (Handbook, `drone-integration-handbook` repo), `nvmillfindoutmyself.com` (Patterns/PIE intel). Ai-Project itself has no custom domain — it deploys to `thebluefairy.netlify.app`. **NOTE:** large chunks of this repo and the two sibling repos still reference `nvmilldoitmyself.com` as if it were the handbook domain — that's a stale/typo reference throughout the codebase, ~120 occurrences spanning analytics functions' `ALLOWED_ORIGINS` (CORS), contribution form fetch URLs, user-facing nav links, and the sitemap. Not yet mass-replaced because the scope is large and deserves a dedicated pass.

## Key Files

| File | Purpose |
|------|---------|
| `build_static.py` | Static site generator |
| `netlify.toml` | Netlify build + redirect config |
| `DroneClear Components Visualizer/*.html` | Source HTML pages |
| `DroneClear Components Visualizer/forge_database.json` | Local data fallback |
| `docs/fpv_domain_knowledge.md` | Domain expertise reference |
