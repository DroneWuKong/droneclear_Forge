# EU supplier observations

The supplier directory at `/suppliers/` and offer panels in Browse and Builder
consume one hash-validated publication from Ai-Project. Supplier profiles,
observations, changes, ECB reference rates, and collection health are shared with
the Patterns research index. Public observations are separate from authenticated
partner offers and never acquire partner verification or compliance authority.

## Publication contract

Ai-Project owns `data/supply-chain/eu-suppliers/`. Six public files are allowlisted
by `tools/public_inputs.py`; review queues, candidate collection configuration,
private source bodies, and historical run details are not exported by the build.
The public routes are `/data/suppliers/{suppliers,offers,changes,fx,health,manifest}.v1.json`.
The build validates the complete manifest before copying any supplier input;
the browser verifies each downloaded file against that same manifest.

Each offer retains its original price, tax basis, quantity qualifier, source URL,
observation/expiry time, extractor version, source content hash, and optional
exact part-ID match. Unknown tax, dispatch location, quantity, and lead time are
not filled from assumptions. Public-page availability expires after 72 hours.
Browser freshness is recomputed even if the last publication is old.

The original currency remains visible. ECB units-per-EUR rates convert through
EUR; rates older than seven days are not used. Converted values are references,
not checkout or delivered-price quotes. The existing partner API groups prices
by currency instead of ordering different currencies as one price scale.

## Private automation

All `/api/suppliers/` automation routes require the existing
`PATTERNS_REVIEW_TOKEN` as a bearer token. The Ai-Project workflow uses its
existing `PATTERNS_AUTONOMY_REVIEW_TOKEN` secret. Do not expose either token in
browser code or new public feeds.

- `POST /api/suppliers/evidence/{sha256}` accepts at most 2 MiB, verifies the
  exact-byte hash, and stores an immutable object in private `RESEARCH_EVIDENCE`.
- `POST /api/suppliers/discover` accepts only an EU country and the current ISO
  week task ID (`YYYY-Www-CC`). It returns candidates, not verified suppliers.
- `GET /api/suppliers/status` reports the current UTC-month budget and pending
  reservations to authenticated operators.

The existing `forge-model-budget` Durable Object gains a separate supplier
ledger. The $25 monthly limit does not change existing proxy budget behavior.
Before a paid call, the ledger reserves the full input-context bound for all
possible tool turns, 2,000 output tokens, and three search calls. Actual token
and search usage settles that reservation. Missing usage, transport failures,
or uncertain outcomes retain it. Duplicate tasks do not call the provider again.
Ten country tasks per ISO week rotate through EU27. A price table older than
90 days disables paid discovery until reviewed; deterministic collection keeps
running. Pricing/model changes require corresponding budget tests, not a silent
fallback model.

## Deploy, monitor, roll back

Deploy the budget Worker before the Pages bundle; the existing production
workflow now enforces that order. Then deploy the Ai-Project collector/workflow.
Run the `suppliers` group with `dry_run=true` first, then a normal supplier run.
The collector publishes through the existing data-only helper. After final
pipeline health publication, it dispatches the existing pinned Pages deployment.
Branch test runs cannot trigger that production deployment.

Inspect collector counts/errors, unmatched and stale offers, and authenticated
budget status. The first release seeds five profiles, with FPV24 and Rotorama
enabled; other researched companies remain candidates. A seed publication has
no fabricated offers. Successful live offers require archived evidence.

Acceptance requires seven distinct daily successful observations for both
initial suppliers; unit tests and a live dry run do not satisfy that soak period.
To stop collection, disable the `suppliers` job/dispatch and revert the public
manifest bundle to the last valid generated-data commit. Do not delete source
evidence, alter partner ownership, or enable global autonomous advisory publication.

## Validation

```sh
node --test tests/test_supplier_budget.mjs tests/test_suppliers.cjs tests/test_model_budget_runtime.mjs
python3 -m unittest tests.test_supplier_inputs tests.test_public_inputs
python3 build_static.py --offline
node tests/browser_suppliers.cjs build
```

For an existing local Chromium installation, the browser test accepts
`BROWSER_EXECUTABLE`; CI installs the pinned Playwright browser.
