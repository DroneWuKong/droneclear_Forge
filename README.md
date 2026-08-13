# DroneClear Forge + UAS Patterns

This repository builds the public delivery layer for two connected UAS products:

- **[UAS Forge](https://uas-forge.com/)** — component and platform discovery, comparison, integration guidance, build planning, and compliance-oriented due diligence.
- **[UAS Patterns](https://uas-patterns.com/)** — public-source intelligence, evidence, actor and TTP signals, teardown analysis, historical trends, forecasts, and data-quality disclosure.

Forge answers **what can be built, bought, compared, integrated, and verified**. Patterns answers **what changed, what evidence supports it, how confident the assessment is, and what remains uncertain**.

## Public data contract

Do not maintain public record counts, coverage dates, or freshness claims by hand. The source of truth is:

```text
forge-source/dataset_catalog.json
```

The catalog is generated from the real `DroneWuKong/Ai-Project` corpus and records, for each major public dataset:

- purpose and public surface;
- current, historical, reference, evidence, forecast, or operations role;
- dataset-specific record-count meaning;
- generation and coverage dates;
- freshness target and current status;
- provenance and quality indicators;
- caveats and known collection limits.

Current analytic datasets may fail closed when stale or malformed. Historical and reference data remain available only with their actual coverage and limitations visible.

## API contracts

Two versioned interfaces sit in front of the Cloudflare data bindings:

| Contract | Base URL | Access |
|---|---|---|
| Public v1 | `https://uas-patterns.com/api/v1` | Anonymous, read-only, curated allowlist, open CORS |
| Private v1 | `https://uas-patterns.com/api/private/v1` | Bearer-authenticated, exact-key read/write, restricted CORS, no static fallback |

Public discovery and OpenAPI are available at `/api/v1` and
`/api/v1/openapi.json`. The legacy `/api/data?type=` endpoint remains available
for compatibility. Private routes require the `PRIVATE_API_KEY` Cloudflare
secret; `PUT ...?dry_run=1` validates a private write without mutating KV.

See [docs/api.md](docs/api.md) and [docs/private-api.md](docs/private-api.md).

## Build

```bash
python3 build_static.py
```

The static builder writes the deployable site to `build/`. It can synchronize upstream data when credentials are configured and otherwise uses committed local fallbacks.

## Software-only validation

The final site and data-quality gates require no physical hardware:

```bash
python -m unittest -v tests/test_public_site_audit.py
python tools/audit_public_site.py --strict --require-catalog --dry-run
python3 build_static.py
python tools/audit_public_site.py --strict --require-catalog --site-dir build --built --dry-run
```

`--dry-run` is the explicit no-write/simulation path. Camera or other browser hardware features are not required for the audit.

The audit checks the critical public surfaces for:

- duplicate IDs and malformed document structure;
- unsafe links and unisolated new-window links;
- broken internal routes;
- missing accessibility landmarks and names;
- retired or contradictory public wording;
- missing response-security headers;
- invalid or duplicate data-catalog records;
- inline JavaScript syntax errors when Node.js is available.

## Repository layout

```text
forge-source/                     Source HTML, JavaScript, CSS, JSON, and assets
workers/                          Cloudflare Worker routes
functions/                        Serverless functions
build_static.py                   Static-site builder
build/                            Generated deployment output (not authoritative source)
tools/audit_public_site.py        Read-only public-site quality gate
tests/test_public_site_audit.py   Software-only audit fixtures
_headers                          Cloudflare Pages response and cache headers
docs/                             Architecture, operations, and product documentation
```

## Deployment

Cloudflare Pages deploys from `master` using the project configuration in `wrangler.jsonc`.

| Setting | Value |
|---|---|
| Build command | `python3 build_static.py` |
| Publish directory | `build` |
| Primary data source | `DroneWuKong/Ai-Project` |
| Public data status | `/miner-health/` |

## Interpretation rules

- An article mention is not a confirmed incident or formal attribution.
- A score is a triage and prioritization aid, not an operational probability.
- Relationship proximity is not an allegation.
- Weak indexed procurement evidence is not proof that no funding, program, or capability exists.
- Compliance and procurement decisions must be checked against current authoritative records.

---

*Buddy up.*
