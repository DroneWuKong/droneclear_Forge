# Patterns / Forge Data API

Public, read-only JSON access to every dataset behind uas-patterns.com and
uas-forge.com. Rendered, user-facing version of this reference:
**https://uas-patterns.com/api-docs/** (source: `forge-source/api-docs.html`).

## Endpoint

```
GET https://uas-patterns.com/api/data?type=<dataset>
```

No authentication. CORS open (`Access-Control-Allow-Origin: *`).

**Response envelope (200):**

```json
{
  "data":   { "…dataset payload…": "" },
  "type":   "pie_brief",
  "tier":   "free",
  "source": "static"
}
```

`source: "static"` appears only when the dataset was served from the static
fallback bundled with the Pages deployment instead of KV (i.e. it missed the
last pipeline sync — content may be one cycle stale).

**Errors:** `400` — missing `type` (response body lists every available
dataset); `404` — unknown dataset, or dataset present in the allowlist but
missing from both KV and static fallback.

**Implementation:** `workers/forge-data.js` (route owned by
`functions/api/[[path]].js` → `workers/index.js`). The dataset allowlist
(`DATASETS`) and the KV-namespace mapping (`PIE_OUTPUTS_KEYS` → `PIE_OUTPUTS`,
everything else → `PIE_DB`) in that file are the source of truth — **keep this
doc and `api-docs.html` in sync when adding a dataset there.**

## Freshness

The PIE pipeline (`DroneWuKong/Ai-Project`, `.github/workflows/pie-daily.yml`)
regenerates and syncs the PIE datasets daily at **14:30 UTC**, with a repair
pass at 15:10 UTC. Parts/intel masters sync from the upstream forge pipeline
(10:00 UTC). Data changes at most once per day — cache accordingly; polling
more than hourly buys nothing.

## Datasets

### Core PIE

| `type` | Contents | Cadence |
|---|---|---|
| `flags` | Full current flag set (~470 signals): severity, confidence, lifecycle (`first_seen`/`last_seen`/`age_days`/`status`), sources, component/platform refs | daily |
| `pie_flags` | Board-serving flag artefact (what `/patterns/` renders) | daily |
| `pie_brief` | Daily brief: headline, lead story, supply-chain + gray-zone windows, watch list, predictions, delta summary | daily |
| `pie_brief_history` | Rolling ~90-day brief archive | daily |
| `pie_delta` | Day-over-day flag movement (new/resolved/escalated/de-escalated) | daily |
| `pie_trends` | 56-day metric history + linear projections | daily |
| `pie_weekly` | Weekly digest | weekly |
| `clock_score` | UAS Ecosystem Clock UERI snapshot | daily |

### Predictions & accountability

| `type` | Contents |
|---|---|
| `predictions` / `pie_predictions` | Current ensemble forecasts (probability, confidence, drivers, hedge) |
| `llm_predictions` | Raw multi-provider LLM forecasts (audit copy) |
| `predictions_best` / `predictions_archive` | Best-graded picks / full archive |
| `prediction_outcomes` / `calibration_scores` | Resolved calls + Brier calibration (powers `/forecast-accountability/`) |
| `gap_analysis_latest` | Latest coverage-gap analysis |

### Analytical lenses

| `type` | Contents |
|---|---|
| `entity_graph` | Entity relationship graph + gray-zone risk scores |
| `actor_fingerprints` / `threat_scores` | Threat-actor signatures and composite scores |
| `adversary_bom` | Captured-platform teardown component rows |
| `component_mirroring_index` | Western parts profiles resembling captured platforms |
| `sanctions_evasion_graph` | Entities reachable from gray-zone seeds |
| `ttp_counter_gap` | UAS TTPs vs. defensive procurement signal |
| `market_lens` | Supply concentration / lead time / NDAA alignment cuts |
| `ddg1` / `ddg2` | Defense Drone Gauntlet scoreboards |

### Intel feeds & reference data

| `type` | Contents |
|---|---|
| `intel_articles` / `intel_companies` / `intel_platforms` / `intel_programs` | Article corpus, funding/M&A, platform + program intel |
| `forge_intel` / `commercial_master` / `dfr_master` / `defense_master` | Sector intel masters |
| `solicitations` / `federal_awards` / `sam_watchlist` | Procurement signals |
| `forge_database` / `drone_database` | Parts catalog + platform DB |
| `forge_firmware_versions` / `forge_troubleshooting` / `forge_incompatibilities` / `topic_component_map` | Firmware matrix, troubleshooting KB, incompatibility rules, topic map |
| `miner_health` / `miner_registry` | Pipeline observability |

### RSS

`/flags.xml` and `/brief.xml` — same daily cycle, pull-based.

## Interpreting the data

- Risk labels are **analytic signals, not allegations**.
- Flag `confidence` grades the **evidence chain**, not event probability;
  prediction `probability` and `confidence` are separate axes. The published
  lexicon is at **https://uas-patterns.com/lexicon/**; methodology of record at
  **https://uas-handbook.com/pipeline/pie-methodology**.

## Fair use

Free for research, journalism, and internal tooling. Cache responses,
attribute **uas-patterns.com** on republication. Schemas are stable but
unversioned; breaking changes are announced in the daily brief.

## Admin write path (internal)

`POST /api/data?type=<dataset>` with `Authorization: Bearer
$FORGE_BLOBS_ADMIN_KEY` writes a dataset to KV. Used by the Ai-Project
pipeline sync; not for public use.
