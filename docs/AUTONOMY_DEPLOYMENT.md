# UAS Patterns Autonomous Evidence Deployment

Production service: Cloudflare Pages project `droneclear-forge` at
`https://uas-patterns.com`.

## Production resources

Configure these exact Pages Functions bindings:

- D1 `AUTONOMY_DB` -> `uas-patterns-autonomy-production`
- private R2 `RESEARCH_EVIDENCE` -> `uas-patterns-evidence-production`

The R2 bucket is optional at runtime. If it is bound, keep both its public
development URL and custom domains disabled.

Inspect D1 state before applying migrations. Apply every file under
`migrations/` in order. Verify the original six autonomy tables plus
`retrieval_candidates`, `retrieval_shadow_state`, and
`retrieval_shadow_receipts`, followed by the shadow-attempt/evaluation,
policy-manifest/state/transition tables and triggers from migration 0003 before
the serving-receipt/monitor tables from migration 0004 and opaque ingress-rate
buckets from migration 0005. Migration 0006 adds the canonical portfolio
decision chain to approval, activation, transition, and rollback records.
Migration 0007 adds immutable experiment, candidate, evaluation, incident, and
privacy-minimized improvement serving-receipt tables. Apply all seven before
deploying code that calls the shadow, promotion, feedback, monitoring,
retention, or improvement-ledger routes.

Apply `migrations/0001_autonomous_evidence.sql` to the production D1 database
before deploying the service.

Configure these production secrets:

- `OPENAI_API_KEY` — Prismo project service-account key
- `OPENAI_WEBHOOK_SECRET` — signing secret for the production webhook
- `PATTERNS_REVIEW_TOKEN` — cryptographically generated reviewer credential

Configure the Ai-Project GitHub Actions repository with:

- secret `PATTERNS_AUTONOMY_REVIEW_TOKEN` — identical to the Cloudflare
  `PATTERNS_REVIEW_TOKEN`
- secret `PATTERNS_AUTONOMY_DISPATCH_URL=https://uas-patterns.com`
- variable `OPENAI_RESEARCH_MODEL=gpt-5-mini`
- variable `PATTERNS_AUTONOMY_BATCH_SIZE=1`

OpenAI webhook:

- URL: `https://uas-patterns.com/api/autonomy/webhooks/openai`
- events: `response.completed`, `response.failed`,
  `response.incomplete`, and `response.cancelled`

## Release verification

After the production deployment:

1. Confirm the deployed Git commit is the merged release commit.
2. Confirm D1 reports migration `0001_autonomous_evidence.sql` applied.
3. Confirm `GET /api/autonomy/status` reports `enabled: true`,
   `live_research: true`, `source_snapshots: true` when R2 is bound, and
   `automatic_publication: false`.
4. Confirm unauthenticated `POST /api/autonomy/runs`,
   `GET /api/autonomy/exceptions`, and `GET /api/autonomy/eligible` return
   401.
5. Confirm an invalid or stale webhook signature is rejected.
6. Confirm the R2 bucket has no public development URL or custom domain.
7. Run one noncritical claim through the production GitHub workflow. Verify two
   independent provider acknowledgements, trusted source hashes, webhook and
   packet records in D1, optional private R2 objects, and a deterministic
   decision.
8. Verify the cursor advances only after both jobs are acknowledged. A weak,
   ambiguous, safety-critical, hardware, or field claim must abstain or enter
   the exception queue.

Do not publish the smoke-test decision as handbook guidance. Promotion remains
a separate human-reviewed editorial action.

Shadow source code and tests are not production evidence. Do not report shadow
as live until the migration, authenticated registration, explicit activation,
real traffic receipts, retention operation, and monitoring checks are verified.

For the portfolio experiment ledger, register a prospective experiment first,
then its exact candidate, then independent evaluation records. Confirm an
unknown experiment or candidate returns 404, a reused identifier with different
content returns 409, and a forbidden capability returns 400. Record one signed-
digest incident fixture and one raw-input-free serving receipt, then read the
reviewer-only `/api/autonomy/improvement/audit` view and confirm all responses
state `changes_serving: false` and `authorizes_action: false`. This verifies the
ledger, not candidate execution, promotion, production serving, or a physical
system.

## Approval, activation, and rollback

After a candidate has at least 100 reconciled receipts across 25 query digests
and seven days, with at most 1% observed Worker failures and p95 evaluation
latency at or below 50 ms:

1. Materialize the reviewer-only shadow evaluation and save its exact JSON.
2. Create the private approval record after that evaluation and sign the
   manifest in the private pipeline.
3. Register the manifest. Confirm the response says `approved` and
   `serving_changes: false`.
4. Disable shadow for that candidate.
5. Read `/api/autonomy/policy/status`; use its exact active version and
   generation in the activation request. A stale value must return HTTP 409.
6. After activation, confirm the research response carries the candidate
   version, manifest digest, generation, `fallback: false`, and
   `policy_receipt.applied: true`. Membership must remain the incumbent page;
   only its order and score may change.
7. Corrupt-signature, missing-storage, and incompatible-schema tests must serve
   `lexical-subject-v2` with a nonempty fallback reason.
8. Run a rollback drill using the exact active version and generation. Confirm
   the pointer, manifest states, and transition history all agree.
9. Confirm a successful ranked query creates a raw-query-free serving receipt.
   A signature-corruption fixture must create a fallback receipt, and monitor
   evaluation must recommend rollback immediately without waiting for traffic
   volume. Ordinary fallback or latency regressions require at least 100
   receipts in the 24-hour window.
10. Run the monitor workflow manually once. Confirm its evaluation row, the
    retention result, and—only for a deliberately broken candidate—the atomic
    rollback transition. Confirm no monitor response or transition can promote
    a candidate.

Source tests prove the mechanism, not production operation. Activation is a
real public-serving change and must not be called merely because the endpoint
exists.

Do not report autonomous research as live until the real production smoke run
has completed through the signed webhook path.
