# Autonomous Evidence for UAS Patterns

UAS Patterns treats fresh model output as an untrusted research lead, not as a
published analytic judgment. The autonomous service creates two independent
background research jobs, retrieves and hashes cited source bytes in trusted
Cloudflare code, and stores a deterministic decision for reviewer inspection.

## Evidence flow

1. `pie_llm_synthesizer.py` writes fresh leads to
   `data/analytic_judgment_candidates.json`.
2. The bounded GitHub workflow selects at most the configured batch size
   (one in production) and creates a research specification.
3. The dispatcher sends the specification and independent researcher and
   verifier requests to the production service.
4. The service acknowledges both provider jobs before the workflow advances
   its cursor.
5. Signed OpenAI webhooks cause the service to retrieve each completed
   response. The model-supplied source hashes are ignored.
6. Trusted code retrieves allowlisted HTTPS source URLs, hashes the exact bytes,
   and optionally saves a private R2 snapshot.
7. Deterministic adjudication records one of `publish_eligible`, `abstained`,
   or `exception`.

A `publish_eligible` decision is still only a research-review candidate. This
service never writes to `PIE_OUTPUTS`, never edits
`data/analytic_judgments.json`, and never publishes a model conclusion.

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
- `POST /api/autonomy/improvement/experiments`, `/candidates`, and
  `/evaluations` are reviewer-only, append-only registries for the prospective
  experiment contract, content-addressed candidate, and independent evaluation.
  Candidate registration requires its experiment; evaluation registration
  requires the exact candidate and experiment lineage already stored in D1.
- `POST /api/autonomy/improvement/incidents` and `/serving-receipts` accept a
  reviewer or monitor credential. Incidents require a matching registered
  candidate lineage; serving receipts contain digests and fallback state, never
  raw private input.
- `GET /api/autonomy/improvement/audit` is reviewer-only and returns the stored
  immutable records as a read-only audit view. None of these improvement routes
  executes a candidate, changes serving, promotes a policy, deploys code,
  changes authority or hardware, or authorizes an action.

## Routes

- `GET /api/autonomy/status` — public aggregate service status. It exposes no
  claim text, reviewer token, evidence packet, or secret.
- `POST /api/autonomy/runs` — reviewer-authenticated bounded dispatch.
- `POST /api/autonomy/webhooks/openai` — signed OpenAI webhook receiver.
- `GET /api/autonomy/exceptions` — reviewer-authenticated exception queue.
- `POST /api/autonomy/exceptions/:id` — reviewer-authenticated resolution.
- `GET /api/autonomy/eligible` — reviewer-authenticated review candidates.

Reviewer authentication uses `Authorization: Bearer <PATTERNS_REVIEW_TOKEN>`.
The webhook requires a current OpenAI signature. Both paths fail closed.

## Deterministic boundaries

Only low-risk observations can reach `publish_eligible`, and only when both
roles support the same scoped claim, trusted retrieval produced the required
number of distinct source hashes, no material contradiction remains, and all
schema checks pass.

The service abstains on weak or ambiguous evidence. Regulatory, procurement,
analysis, hypothesis, and counterevidence cases require review. Hardware,
installed-device, field, flight, and safety claims always become exceptions;
web or software research cannot validate those evidence levels. Forecasts stay
forecasts and cannot be converted into facts by model agreement.

## Software-only fallback

The public site continues to use the last reviewed
`data/analytic_judgments.json` snapshot. Missing bindings, provider failures,
webhook failures, malformed packets, source retrieval failures, and incomplete
paired jobs do not change that fallback and do not publish new guidance.

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

The schemas are in the ordered migration set under `migrations/`. Migration
`0006_portfolio_improvement_decisions.sql` binds activation and rollback to the
portfolio decision chain. Migration `0007_improvement_experiment_os.sql` adds
the append-only experiment, candidate, evaluation, incident, and privacy-
minimized serving-receipt ledgers.

Operational retention is 180 days for explicit retrieval feedback, 90 days
for shadow attempts and receipts, 30 days for active-serving receipts, and 365
days for serving-monitor evaluations. Hourly rate buckets expire at the end of
their window. Public feedback is limited to 60 submissions per address per
hour; shadow observations are limited to 300. Only an HMAC-derived bucket ID is
stored.
