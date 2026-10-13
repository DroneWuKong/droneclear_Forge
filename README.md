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

## Build

```bash
python3 build_static.py --offline
```

The static builder writes the deployable site to `build/`. Local builds use committed inputs. Upstream builds must instead pass `--data-ref <40-character-commit>` and configure `GITHUB_PAT`; failed synchronization stops the build. `--data-dir <directory>` explicitly selects local PIE inputs. Source files are staged in a temporary directory and are never overwritten. `build/build-manifest.json` records input and artifact hashes. Private exports require `--include-private` and the same pinned upstream commit. See [repair and rollout notes](docs/AUDIT_REPAIRS_2026-09-09.md).

## Software-only validation

The final site and data-quality gates require no physical hardware:

```bash
python -m unittest -v tests/test_public_site_audit.py
python tools/audit_public_site.py --all --strict --require-catalog --dry-run
python3 build_static.py --offline
python tools/audit_public_site.py --all --strict --require-catalog --site-dir build --built --dry-run
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

The ecosystem's partner entry point is `/partners/`: email/password signup creates
a separate company workspace with draft editing, and returning users can log in
to upload JSON/CSV products or BOMs and edit saved records.
Ordinary partner accounts do not grant access to `/private/*`, platform
provisioning, other companies, or catalog publication. Access-authenticated
teams retain their existing portal.

Production deployment verifies and applies the ecosystem migrations before deploying
both the private partner email sender and the catalog import worker. Verification
and password-reset emails use Cloudflare Email Sending from `accounts@uas-forge.com`.
Requests are persisted and retried; only expiring, single-use token hashes are
stored. Password resets revoke existing sessions. Email links carry tokens in
URL fragments, and the partner account page excludes optional analytics.

A customer-visible product requires the existing identity/technical fields,
a description, `productKind` (`COMPONENT` or `ASSEMBLY`), supporting evidence,
and `completionState: "COMPLETE"`. An assembly also needs a reviewed BOM for its
exact revision, with every line resolved to a complete, published component
revision. Publishing an assembly and its BOM is atomic. Drafts, reviewed-only
records, and historical records without completeness approval stay private on
all public product, BOM, and offer endpoints. Partners can check missing
requirements in the portal before submitting. Withdrawing an assembly's required
published BOM hides that assembly from customers.

Publication reviewers are assigned explicitly to verified partner account IDs
in `ecosystem_partner_reviewers`; ordinary signup grants no reviewer authority.
Reviewers can inspect submitted partner products and approve their publication
in `/partners/`, without gaining platform provisioning, team administration, or
private intelligence access. Existing Cloudflare Access platform administrators
can also review from `/private/catalog/`. Reviewer assignment is an operator
setup action, not an email-domain match or a self-service upgrade.
After the chosen reviewer creates and verifies an account, run the production
deployment workflow with mode `assign-reviewer` and their `reviewer_email`.
The setup resolves that verified account to its exact ID and verifies the grant.

Validate with `npm run test:partners` after building, and
`python -m unittest tests/test_partner_schema.py` for migration preservation.

Cloudflare Pages deploys from `master` using the project configuration in `wrangler.jsonc`.

| Setting | Value |
|---|---|
| Build command | `python3 build_static.py --offline` |
| Publish directory | `build` |
| Primary data source | `DroneWuKong/Ai-Project` |
| Public data quality | `/miner-health/` |
| Intel pipeline operations | `/intel-health/` |

## Interpretation rules

- An article mention is not a confirmed incident or formal attribution.
- A score is a triage and prioritization aid, not an operational probability.
- Relationship proximity is not an allegation.
- Weak indexed procurement evidence is not proof that no funding, program, or capability exists.
- Compliance and procurement decisions must be checked against current authoritative records.

---

*Buddy up.*
