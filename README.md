# DroneClear Forge

> The public-facing drone component browser, build planner, and integration guide hub.
> **Live at [forgeprole.netlify.app](https://forgeprole.netlify.app)**

## What This Is

Forge is the front door to the AI Wingman ecosystem. It gives operators, builders, and integrators free access to:

- **3,200+ drone components** across 16 categories (motors, ESCs, FCs, frames, antennas, etc.)
- **150+ drone platforms** with specs, compliance status, and manufacturer details
- **Build planning tools** — model builder, build audit, compatibility checks
- **Integration guides** — FC firmware, mesh networking, TAK, SLAM, C-UAS, AI, swarm coordination
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
