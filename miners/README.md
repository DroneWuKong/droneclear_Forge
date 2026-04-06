# Forge Intelligence Miners

Python scripts that scrape public sources and update Forge data files.
All miners flow through `mine_all.py` which is the single orchestrator
called by CI.

---

## Architecture

```
miners/
├── mine_all.py              ← Orchestrator — run this
├── mine_from_analytics.py   ← Analytics-driven gap miner
├── merge_mined_entries.py   ← Merge reviewed TS entries into DB
├── format_gap_summary.py    ← CI summary formatter
├── validate_entry.py        ← Quality gate (shared utility)
│
├── commercial/              ← Parts data (writes forge_database.json)
│   ├── mine_getfpv.py       GetFPV catalog — receivers, VTX, control TX, goggles
│   ├── mine_rdq.py          RaceDayQuads — price comparison + gap fill
│   └── mine_manufacturer.py Direct OEM sites — LiDAR, mesh, thermal, companion
│
├── defense/                 ← DoD/NATO data (writes forge_database.json + forge_intel.json)
│   ├── mine_diu.py          DIU portal — Blue UAS, DDP, Replicator tracking
│   ├── mine_sam.py          SAM.gov — federal contract awards
│   ├── mine_ai_accelerators.py  Edge AI chips (Hailo, Jetson, Coral, etc.)
│   ├── mine_c2_datalinks.py     C2 radio systems (Silvus, Herelink, uAvionix)
│   ├── mine_ew_systems.py       EW + C-UAS systems (DroneShield, D-Fend, infiniDome)
│   ├── mine_ground_control_stations.py  GCS hardware + software
│   └── mine_navigation_pnt.py   Navigation/PNT systems (SBG, ModalAI, Inertial Labs)
│
├── enrichment/              ← Fill gaps in existing entries (writes forge_database.json)
│   ├── enrich_descriptions.py   Template-based descriptions for parts missing them
│   ├── enrich_platform_specs.py Fill speed/range/endurance/payload from known data
│   └── fetch_platform_images.py Fetch OG images from manufacturer pages (opt-in)
│
├── firmware/                ← FC firmware configs (writes forge_firmware_configs.json)
│   └── mine_firmware_configs.py Betaflight, iNav, ArduPilot, PX4 target definitions
│
└── troubleshooting/         ← Community knowledge (writes forge_troubleshooting.json)
    └── mine_troubleshooting.py  Betaflight wiki, ArduPilot wiki, Oscar Liang, PX4
```

---

## Running miners

```bash
# Run everything (full pipeline)
python3 miners/mine_all.py

# Run a single group
python3 miners/mine_all.py --group intel
python3 miners/mine_all.py --group defense
python3 miners/mine_all.py --group commercial
python3 miners/mine_all.py --group enrichment
python3 miners/mine_all.py --group firmware
python3 miners/mine_all.py --group troubleshooting

# Preview without writing
python3 miners/mine_all.py --dry-run
python3 miners/mine_all.py --group commercial --dry-run

# Analytics-driven gap mining
python3 miners/mine_from_analytics.py --analyze --days 7
python3 miners/mine_from_analytics.py --mine --top 5 --days 30

# Enable platform image fetching (network-heavy, opt-in)
FORGE_FETCH_IMAGES=1 python3 miners/mine_all.py --group enrichment
```

---

## CI triggers

| Schedule | Job | Groups |
|----------|-----|--------|
| Daily 06:00 UTC | `daily` | intel + analytics gap analysis |
| Sunday 04:00 UTC | `weekly-full` | all groups end-to-end |
| Manual dispatch | `single-group` or `weekly-full` | any group or `full` |

### Manual dispatch options

Trigger via **Actions → Forge Intelligence Pipeline → Run workflow**:

| Group | What it runs |
|-------|-------------|
| `intel` | DroneLife, SBIR, Blue UAS, DIU |
| `defense` | SAM.gov, AI accelerators, C2, EW, GCS, Navigation PNT |
| `commercial` | GetFPV, RaceDayQuads, manufacturer OEM sites |
| `enrichment` | Description fill, platform specs, (images with flag) |
| `firmware` | Betaflight/iNav/ArduPilot/PX4 config miner |
| `troubleshooting` | Community wiki + forums |
| `analytics` | Analytics gap analysis only (no mining) |
| `full` | All groups in order |

---

## Output files

| File | Written by |
|------|-----------|
| `forge_database.json` | commercial, defense, enrichment miners |
| `forge_intel.json` | intel, defense/sam, defense/diu miners |
| `forge_firmware_configs.json` | firmware miner |
| `forge_troubleshooting.json` | troubleshooting, analytics miners |

---

## Required secrets

| Secret | Used by |
|--------|---------|
| `ANALYTICS_ADMIN_KEY` | mine_from_analytics.py |
| `SMTP_USER` / `SMTP_PASS` | Email notifications |
| `MINER_PAT` | validate-flags.yml (auto-commit) |
| `SYNC_PAT` | sync_to_aiproject.yml |

---

## Data quality

All mined entries pass through `validate_entry.py` before insertion:
- Rejects garbage/generic names
- Requires minimum name length (4 chars)
- Deduplicates by PID or name+manufacturer
- Normalizes units to SI (metric primary, US secondary)
