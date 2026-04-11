# Forge Mining Framework

Tools for mining public data sources into structured JSON files consumed by the Forge static site.

## Why this exists

Forge's job is to make professional operators (defense integrators, procurement officers, tier-1 operators) as hardware-fluent as a 17-year-old with 2,000 hours on a freestyle quad. The hobby FPV community has the highest-volume ground truth on what hardware actually works together — Forge harvests that ground truth and pipes it into Wingman, `forge_database.json`, and the compliance layer so professionals don't have to ask r/fpv.

**"Professional" is the end user, not the data source.** A Foxeer camera on a 5" freestyle is the same camera as on a defense ISR quad — the hardware doesn't care which community bought it. Filters in this framework are quality gates (non-empty, non-spam, has parts), never category gates.

## Architecture

```
tools/mining/
├── lib/                    # BaseMiner + shared plumbing
│   └── base_miner.py       # Rate limit, cache, robots.txt, fetch, retry
├── miners/                 # One file per data source
│   ├── rotorbuilds.py          # Build graph + part co-occurrence
│   ├── ardupilot_discourse.py  # ArduPilot community via Discourse JSON API
│   ├── blue_uas.py             # DIU Blue UAS Cleared + Framework (gov PD)
│   └── sam_gov.py              # Federal drone RFPs via SAM.gov API
├── normalizers/            # Raw → forge_*.json transforms
│   └── aggregate_cooccurrence.py
├── output/
│   ├── .cache/             # HTTP response cache (gitignored)
│   └── raw/                # Raw JSONL records per miner run (gitignored)
├── run_all.py              # Orchestrator
├── requirements.txt
└── README.md               # this file
```

Output files land in `DroneClear Components Visualizer/`:
- `forge_co_occurrence.json` — pair counts for "part A appears with part B in N builds"
- (future) `forge_price_observations.json` — price points across retailers
- (future) `forge_pro_archetypes.json` — canonical build templates
- (future) `forge_blue_uas_cleared.json` — government authoritative list

## Legal stance

**Aggregate/derived extraction is fair use.** The controlling precedent (hiQ Labs v. LinkedIn, 9th Circuit, repeatedly reaffirmed) holds that scraping public data for statistical transformation is not a violation of the CFAA or copyright. Authors Guild v. Google and the Google Books ruling extended this to the transformative-use analysis.

**What we do:**
- Extract **derived statistics** (co-occurrence counts, popularity ranks, price observations)
- Extract **factual metadata** (part names, categories, vendors)
- Transform into a statistical graph that doesn't reproduce the source
- Respect `robots.txt` as a liability shield (not moral authority — we respect it to stay inside the legal envelope)
- Rate-limit aggressively to stay below anti-bot triggers
- Use honest user-agents that identify us with a contact email

**What we DO NOT do:**
- Mirror or republish verbatim user content (photos, writeups, comments)
- Bypass CAPTCHAs, login walls, or paywalls
- Use stolen credentials or evasive IP rotation
- Retain raw scraped content in the committed repo (only in gitignored `output/`)

If a source's operator asks us to stop, we stop. That's both policy and ethics — and the contact email in the user-agent makes it trivial for them to reach us.

## Data sources and current status

| Source | Type | Legal shield | Value | Status |
|---|---|---|---|---|
| RotorBuilds | Scrape | Fair use (aggregate) + robots.txt | Build co-occurrence, part aliases, prices | **SCAFFOLD** (filter fixed, DOM selectors TBD) |
| ArduPilot Discourse | Public JSON API | Sanctioned public API | Pro integrator hardware graph | SCAFFOLD |
| DIU Blue UAS | Scrape or static HTML | US Gov public domain | Authoritative NDAA cleared list | SCAFFOLD |
| SAM.gov | Public JSON API | US Gov public domain + sanctioned API | Live federal drone RFPs | SCAFFOLD (needs `SAM_GOV_API_KEY`) |

## Usage

### Setup

```bash
cd tools/mining
pip install -r requirements.txt
```

### Run a single miner

```bash
# Dry-run a single miner with a hard record cap.
python tools/mining/run_all.py --miner rotorbuilds --max 25 --dry
```

`--dry` skips the normalizer step so you can inspect raw output before aggregating.

### Run everything

```bash
export SAM_GOV_API_KEY=...  # only if running sam_gov
python tools/mining/run_all.py --max 100
```

### Force a re-fetch (bypass cache)

Delete the cache for a specific source:
```bash
rm -rf tools/mining/output/.cache/rotorbuilds-*
```

### Override robots.txt (careful)

```bash
FORGE_MINE_RESPECT_ROBOTS=0 python tools/mining/run_all.py --miner rotorbuilds
```

**Only** do this when you've confirmed by email with the site owner that it's OK. Never in unattended runs. Never in CI.

## Tomorrow's work (see BACKLOG.md FEAT-006)

1. **DOM inspection for RotorBuilds.** Save 3-5 representative build pages to `output/.cache/`, inspect by hand, fill in real selectors in `rotorbuilds.py` `parse()`. Emit structured `parts` arrays.
2. **First small real run.** `--miner rotorbuilds --max 50` with the real parser. Verify output by eye before scaling up.
3. **Normalizer wire-up.** Confirm `aggregate_cooccurrence.py` produces a meaningful `forge_co_occurrence.json`.
4. **Wingman integration.** Update `wingman.html` to fetch `forge_co_occurrence.json` and use it in the build-validity check as a "this combo is common (N builds)" signal — complements the "vendor alive" and "has PIE flag" checks already in place.
5. **Blue UAS as the next miner.** Government public-domain data is the least legally risky and the most authoritative — should be priority #2.

## Risk register

| Risk | Mitigation |
|---|---|
| Rate limit too aggressive → IP banned | `min_request_interval_sec` is conservative (4s for RotorBuilds); start with `--max 25` |
| DOM changes silently break parsers | Snapshot the cache; diff before each run; fail loud on zero-records |
| Scraped data stale within weeks | Treat as a quarterly refresh, not real-time |
| Normalization errors pollute forge_database.json | Normalizers write to SEPARATE `forge_co_occurrence.json` etc., never overwrite `forge_database.json` |
| Someone commits raw scrape output | `.gitignore` blocks `output/raw/` and `output/.cache/` |
