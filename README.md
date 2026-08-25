# DroneClear Forge + UAS Patterns

**The public delivery layer for UAS component/platform discovery, integration planning, and evidence-aware pattern analysis.**

| Surface | Purpose |
|---|---|
| [UAS Forge](https://uas-forge.com/) | Discover, compare, plan, and verify components, platforms, builds, and integration paths |
| [UAS Patterns](https://uas-patterns.com/) | Track public-source evidence, actors, TTP signals, teardowns, trends, forecasts, confidence, and uncertainty |

Forge answers **what can be built, bought, compared, integrated, and checked**. Patterns answers **what changed, what evidence supports it, how confident the assessment is, and what remains uncertain**.

## At a glance

| Item | Current truth |
|---|---|
| Lifecycle | Active public surface |
| Architecture | Static site plus Cloudflare Workers/Functions |
| Deployment | Cloudflare Pages from `master` |
| Source pages | `forge-source/` |
| Generated output | `build/` |
| Current data contract | `forge-source/dataset_catalog.json` |
| Physical hardware required for validation | No |

## Public data contract

Do not maintain record counts, coverage dates, or freshness claims by hand. [`forge-source/dataset_catalog.json`](forge-source/dataset_catalog.json) is generated from the source corpus and records each public dataset's:

- purpose and public surface;
- current, historical, reference, evidence, forecast, or operations role;
- record-count meaning;
- generation and coverage dates;
- freshness target and current condition;
- provenance, quality indicators, caveats, and collection limits.

Current analytic datasets may fail closed when stale or malformed. Historical and reference data remain available only with their actual coverage and limits visible.

## Build and validate

```bash
python3 build_static.py
python -m unittest -v tests/test_public_site_audit.py
python tools/audit_public_site.py --strict --require-catalog --site-dir build --built --dry-run
```

The explicit `--dry-run` path performs no write and requires no camera, browser hardware, or other physical device.

The audit checks critical public surfaces for malformed structure, duplicate IDs, unsafe links, broken internal routes, accessibility failures, contradictory wording, missing security headers, invalid catalog records, and inline JavaScript syntax errors when Node.js is available.

## Repository map

| Path | Responsibility |
|---|---|
| `forge-source/` | Authoritative HTML, JavaScript, CSS, JSON, and assets |
| `build_static.py` | Static-site build and source-data synchronization |
| `workers/`, `functions/` | Same-origin Cloudflare `/api/*` routes |
| `forge-source/dataset_catalog.json` | Public dataset status contract |
| `tools/audit_public_site.py` | Read-only site and data-quality gate |
| `tests/` | Site, contract, and regression checks |
| `build/` | Generated deployment output; not authoritative source |
| `docs/` | Architecture, operations, and product documentation |

## Deployment

| Setting | Value |
|---|---|
| Build command | `python3 build_static.py` |
| Publish directory | `build` |
| Cloudflare configuration | [`wrangler.jsonc`](wrangler.jsonc) |
| Primary private source corpus | `DroneWuKong/Ai-Project` |
| Public health/status surface | `/miner-health/` |

## Interpretation rules

- An article mention is not a confirmed incident or formal attribution.
- A score is a triage aid, not an operational probability.
- Relationship proximity is not an allegation.
- Weak indexed procurement evidence is not proof that no funding, program, or capability exists.
- Compliance and procurement decisions require current authoritative records.

## Security

Report vulnerabilities through [`SECURITY.md`](SECURITY.md). Do not commit private source data, credentials, tokens, or non-public evidence to this repository.

