# Autonomous-evidence production deployment

This runbook applies to the Cloudflare Pages project configured by
`wrangler.jsonc` (`droneclear-forge`) and the production hostname
`https://uas-patterns.com`.

## Production resources

Create or select, without replacing existing data:

- D1 database `uas-patterns-autonomy-production`, bound as `AUTONOMY_DB`.
- Private R2 bucket `uas-patterns-evidence-production`, bound as
  `RESEARCH_EVIDENCE`. Public development URL and custom domains stay disabled.

Inspect D1 state before applying migrations. Apply every file under
`migrations/` in order. Verify the original six autonomy tables plus
`retrieval_candidates`, `retrieval_shadow_state`, and
`retrieval_shadow_receipts`, followed by the shadow-attempt/evaluation,
policy-manifest/state/transition tables and triggers from migration 0003 before
the serving-receipt/monitor tables from migration 0004 and opaque ingress-rate
buckets from migration 0005. Apply all five before deploying code that calls
the shadow, promotion, feedback, monitoring, or retention routes.

Set these as production Pages secrets, never plaintext variables:

- `OPENAI_API_KEY` — a production-scoped OpenAI project key.
- `OPENAI_WEBHOOK_SECRET` — from the OpenAI webhook registered for
  `https://uas-patterns.com/api/autonomy/webhooks/openai`.
- `PATTERNS_REVIEW_TOKEN` — a cryptographically generated reviewer token.
- `PATTERNS_POLICY_SIGNING_SECRET` — at least 32 random bytes, supplied to the
  private manifest signer and production Pages secret through separate secret
  channels. Rotation requires a versioned key-id and re-signing plan; never
  overwrite it casually while a candidate is active.
- `PATTERNS_MONITOR_TOKEN` — a separate cryptographically generated credential
  used only by the scheduled monitor and emergency rollback path.
- `PATTERNS_RATE_LIMIT_SECRET` — at least 32 random bytes used only to HMAC
  hourly public-ingress buckets. Do not reuse the policy signing secret.

The same reviewer token is stored directly as the GitHub Actions secret
`PATTERNS_AUTONOMY_REVIEW_TOKEN`. Set
`PATTERNS_AUTONOMY_DISPATCH_URL=https://uas-patterns.com` and the repository
variable `OPENAI_RESEARCH_MODEL=gpt-5-mini`.

Store the monitor credential separately as the GitHub Actions secret
`PATTERNS_AUTONOMY_MONITOR_TOKEN`, and set
`PATTERNS_AUTONOMY_MONITOR_URL=https://uas-patterns.com` as a repository
variable. The `retrieval-policy-monitor.yml` workflow evaluates the active
policy every 15 minutes, applies only rollback actions, and runs bounded
retention maintenance. A missing secret or failed request must fail the job;
it must never silently claim that monitoring ran.

The OpenAI webhook subscribes to `response.completed`, `response.failed`,
`response.incomplete`, and `response.cancelled`. Terminal failures are recorded
so paired runs cannot remain silently stuck.

## Verification

After a production deployment:

1. Confirm `/api/autonomy/status` reports storage, live research, and private
   source snapshots while `automatic_publication` remains `false`.
2. Confirm `runs`, `exceptions`, and `eligible` reject unauthenticated requests.
3. Send an invalid webhook signature and confirm it is rejected.
4. Confirm the R2 bucket has no public URL or custom domain.
5. Dispatch one noncritical observation. Both roles must be acknowledged before
   the workflow cursor advances.
6. Confirm source bytes and trusted hashes, both packets, the webhook records,
   and a deterministic decision in D1. A weak or physical-evidence fixture must
   abstain or escalate.

For shadow evaluation, keep it disabled until the offline candidate, frozen
replay, and prospective holdout reproduce in the private pipeline. Register the
private bundle with reviewer authorization, verify it remains
`registered-shadow-only`, then explicitly enable shadow for that version.
Confirm that:

1. Ask PIE visible order is identical with shadow disabled and enabled.
2. Receipts name the incumbent, candidate, input revision, and bundle digest.
3. Stored receipt JSON has `raw_query_stored: false` and contains no submitted
   query text, account, session, or IP field.
4. Errors or a disabled selector leave Ask PIE behavior unchanged.
5. No shadow route or shadow D1 row claims promotion eligibility or a serving
   change.

Shadow source code and tests are not production evidence. Do not report shadow
as live until the migration, authenticated registration, explicit activation,
real traffic receipts, retention operation, and monitoring checks are verified.

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
