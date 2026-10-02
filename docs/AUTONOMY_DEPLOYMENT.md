# UAS Patterns Autonomous Evidence Deployment

Production service: Cloudflare Pages project `droneclear-forge` at
`https://uas-patterns.com`.

## Production resources

Configure these exact Pages Functions bindings:

- D1 `AUTONOMY_DB` -> `uas-patterns-autonomy-production`
- private R2 `RESEARCH_EVIDENCE` -> `uas-patterns-evidence-production`

The R2 bucket is optional at runtime. If it is bound, keep both its public
development URL and custom domains disabled.

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
