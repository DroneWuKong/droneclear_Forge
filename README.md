# DroneClear Forge

> The public-facing drone component browser, build planner, and intelligence hub.
> **Live at [nvmillbuilditmyself.com](https://nvmillbuilditmyself.com)**
> PIE intelligence at [nvmillfindoutmyself.com](https://nvmillfindoutmyself.com)

## What This Is

Forge is the front door to the DroneClear ecosystem. It gives operators, builders, and integrators free access to:

- **3,885+ drone components** across 38 categories — all fields enriched to 95-100% coverage
- **271 drone platforms** with specs, compliance status, and manufacturer details (25 Blue UAS)
- **PIE v0.9** — Pattern Intelligence Engine: 237 flags, 10 predictions, 4 gray zone entities tracked
- **Build planning tools** — model builder, build audit, compatibility checks
- **Integration guides** — FC firmware, mesh networking, TAK, SLAM, C-UAS, AI, swarm coordination
- **Intel feeds** — defense procurement, solicitations, gray zone enforcement, grant windows
- **FPV Academy** — learning resources for new operators
- **Community contributions** — submit new components and platforms

## Quick Start

```bash
python3 build_static.py    # Build static site → build/
```

The build pulls fresh data from the Ai-Project repo if `GITHUB_PAT` is set. Without it, falls back to local data.

## Deploy

Netlify auto-deploys from `master` branch. Config in `netlify.toml`.

| Setting | Value |
|---------|-------|
| Build command | `python3 build_static.py` |
| Publish directory | `build` |
| Required env var | `GITHUB_PAT` (repo read access to DroneWuKong/Ai-Project) |

## Project Structure

```
├── DroneClear Components Visualizer/   # Source HTML/CSS/JS (20 pages)
├── build_static.py                     # Static site generator
├── netlify.toml                        # Netlify config + redirects
├── archive/                            # Historical data (CSVs, old JSON)
├── docs/
│   ├── ARCHITECTURE.md                 # How the build pipeline works
│   ├── FEATURES.md                     # UI feature reference
│   └── fpv_domain_knowledge.md         # FPV expertise for AI/compatibility
├── CHANGELOG.md                        # Session-by-session dev history
├── BACKLOG.md                          # Tracked issues
└── CLAUDE.md                           # AI assistant project instructions
```

## Data Source

Component and platform data lives in [`DroneWuKong/Ai-Project`](https://github.com/DroneWuKong/Ai-Project) → `data/parts-db/*.json`. Forge is a read-only consumer that syncs at build time.

---

*Buddy up.*
