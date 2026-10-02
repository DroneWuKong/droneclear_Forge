# UAS Patterns autonomous evidence

The autonomous-evidence service researches candidate analytic judgments without
turning model output into public facts. It is a private evidence and decision
layer behind the public UAS Patterns data pipeline.

The cross-repository target architecture is
[`SELF-IMPROVING-INTELLIGENCE.md`](https://github.com/DroneWuKong/Ai-Project/blob/main/docs/architecture/SELF-IMPROVING-INTELLIGENCE.md).
This repository owns the delivery-layer registry, serving pointer, monitoring,
and rollback portion of that contract; it does not own candidate training or
private manifest signing.

## Contract

- `POST /api/autonomy/runs` accepts one bounded research specification and
  starts exactly two OpenAI background Responses: `researcher` and `verifier`.
- `POST /api/autonomy/webhooks/openai` accepts only signed OpenAI webhook
  events. Completed responses are retrieved directly from OpenAI.
- Trusted Worker code downloads allowlisted HTTPS sources, follows only bounded
  allowlisted redirects, replaces model-supplied digests with SHA-256 of the
  exact retrieved bytes, and optionally saves private R2 snapshots.
- Deterministic code—not the model—adjudicates the paired evidence packets.
- `GET /api/autonomy/status` exposes counts and capability state only.
- Exception and eligible-decision routes require `PATTERNS_REVIEW_TOKEN`.
- `POST /api/autonomy/feedback` accepts strict, same-origin Ask PIE feedback
  tied to the exact query, input revision, ranking policy, result identity,
  position, and observed ranking features. Events deliberately omit session,
  account, and IP fields.
- `GET /api/autonomy/feedback` and
  `POST /api/autonomy/feedback/:event-id` require `PATTERNS_REVIEW_TOKEN`.
  Review dispositions are `accept-as-judgment`, `reject-as-noise`, and
  `needs-context`; new dispositions include a server `reviewed_at` timestamp.
- `POST /api/autonomy/candidates` accepts a locally reproduced private registry
  bundle only with reviewer authorization and stores a minimized immutable
  `registered-shadow-only` runtime record.
- `POST /api/autonomy/candidates/:version/shadow` lets a reviewer enable or
  disable comparison in the isolated shadow plane. It cannot change serving.
- `GET /api/autonomy/shadow/status` exposes only whether the invisible
  comparison is enabled and the two policy versions.
- `POST /api/autonomy/shadow` accepts a same-origin ranked feature snapshot,
  computes candidate order without returning it to rendering code, and stores
  a policy receipt with query and order digests instead of raw query text.
- `GET /api/autonomy/shadow/receipts` is reviewer-only.
- `POST /api/autonomy/candidates/:version/shadow/evaluate` freezes an
  operational shadow report against minimum traffic, distinct-query, elapsed
  time, observed error, p95 latency, reconciliation, and bundle-integrity
  gates. It can authorize approval, never activation.
- `POST /api/autonomy/promotions` is reviewer-only and accepts only an
  HMAC-SHA256 manifest whose candidate, parameters, shadow digest, approval
  record, and rollback target match registered evidence.
- `POST /api/autonomy/promotions/:id/activate` requires an explicit action,
  notes, expected active version, and expected generation. The pointer update,
  manifest-state transition, and audit transition are one compare-and-swap
  database statement.
- `POST /api/autonomy/policy/rollback` applies the same generation guard to the
  manifest's rollback target. `GET /api/autonomy/policy/status` returns the
  policy receipt without parameters; transition history is reviewer-only.
- Every ranked research response asynchronously stores a raw-query-free
  serving receipt containing the configured and served versions, generation,
  input revision, outcome, fallback reason, latency, and a query digest.
- `POST /api/autonomy/policy/monitor` freezes a content-addressed 24-hour
  serving evaluation. A monitor or reviewer credential can request evaluation
  only, or an atomic rollback when a cryptographic/integrity failure is seen,
  or when at least 100 receipts breach the 1% fallback or 75 ms p95 gates.
  It can never activate or promote a candidate.
- `POST /api/autonomy/maintenance/retention` applies the explicit operational
  retention schedule. The scheduled monitor also performs this maintenance.
  Candidate registry entries, signed manifests, and policy transitions are not
  removed by this operation.

`publish_eligible` is not publication. This service never writes to
`PIE_OUTPUTS`. A reviewed promotion path must remain a separate, auditable
action. The last reviewed `analytic_judgments` snapshot is the software-only
fallback if live research is unavailable.

Feedback is also non-authorizing. Public submissions have signal quality
`explicit-unreviewed`; only a human-accepted export can enter offline
evaluation. The feedback and shadow services cannot change visible ranking
weights or promote a policy. Shadow registration and selection are separate
from the approved serving registry, and every shadow response states
`visible_effect: false`, `serving_changes: false`, and
`promotion_eligible: false`. Only the signed-manifest activation and rollback
routes can change the active pointer. Serving verifies the signature and schema
on every ranked request and falls back to `lexical-subject-v2` if verification
or compatibility fails.

## Evidence boundaries

Two model roles are independent tasks, not independent evidence. Distinct
trusted source hashes are required. Weak or ambiguous evidence abstains;
counterevidence, regulatory/procurement claims, and analysis/hypothesis records
go to exception review. Hardware, field, safety, installed-device, and flight
claims can never become software-validated evidence.

Forecast research remains attached to the existing pre-registered prediction
ledger and is never reclassified as a current fact.

## Storage and secrets

Production bindings:

- D1: `AUTONOMY_DB`
- private R2: `RESEARCH_EVIDENCE` (optional; no public/custom domain)

Production secrets:

- `OPENAI_API_KEY`
- `OPENAI_WEBHOOK_SECRET`
- `PATTERNS_REVIEW_TOKEN`
- `PATTERNS_POLICY_SIGNING_SECRET` (at least 32 random bytes; must match the
  private signer environment and must never be a plaintext variable)
- `PATTERNS_MONITOR_TOKEN` (dedicated scheduler/rollback credential)
- `PATTERNS_RATE_LIMIT_SECRET` (at least 32 random bytes; HMACs hourly ingress
  buckets so client addresses are never persisted)

The schemas are in `migrations/0001_autonomous_evidence.sql`,
`migrations/0002_retrieval_shadow.sql`, and
`migrations/0003_retrieval_policy_promotion.sql` through
`migrations/0005_autonomy_ingress_controls.sql`.

Operational retention is 180 days for explicit retrieval feedback, 90 days
for shadow attempts and receipts, 30 days for active-serving receipts, and 365
days for serving-monitor evaluations. Hourly rate buckets expire at the end of
their window. Public feedback is limited to 60 submissions per address per
hour; shadow observations are limited to 300. Only an HMAC-derived bucket ID is
stored.
