# Forge display-policy release

This release adds a bounded display adapter, not new compatibility rules.
Source/software evidence is complete only when the named checks pass; live
operation additionally needs migration, bindings, real traffic and readback.

## Provision and inspect

The production Pages deployment now runs `tools/provision_forge_policy.py`
before upload. It inspects the exact existing D1 binding and prerequisite
schema, applies only additive migration 0008, rejects conflicting definitions,
and reads the schema back. It preserves an existing signing secret. If absent,
it generates a separate 384-bit secret in the trusted CI process and supplies
it to pinned Wrangler over stdin; no key is saved in the repository or artifact.
After upload, the workflow requires public status readback to confirm signing
and the actual serving version. Provisioning never starts shadow or activates.

The existing deployment token needs Pages Edit and D1 Edit on these resources.
A permission failure stops deployment with an explicit failing step; it cannot
be reported as operational readiness. An invalid existing key is never rotated
automatically and causes runtime verification to fail.

Apply `migrations/0008_forge_matching_policy.sql` to the existing `AUTONOMY_DB`
after migrations 0001–0007. Configure a distinct secret
`FORGE_POLICY_SIGNING_SECRET` containing at least 32 random bytes. Keep it out of
the learner and browser. The Patterns reviewer connection already configured
in dashboard Settings authorizes the trusted control requests.

Before migration, the new routes stay unavailable and the browser keeps the
incumbent. Existing operational-data maintenance skips the optional table.
Missing/invalid active manifests also return incumbent results with a fallback
reason. No default policy activation occurs on deploy.

## Dashboard sequence

Open Learning at `https://dash.uas-forge.com/`.

1. Review explicit matching feedback against real build/catalog evidence.
2. Inspect the next cycle's held-out gain and context coverage. A qualified
   runtime bundle appears only after the existing offline gates pass.
3. A Reviewer or Publisher can start shadow. The server loads the pinned private
   bundle; the browser cannot replace its parameters or evidence.
4. Check shadow results. Initial operational requirements are 100 comparisons,
   25 distinct context digests, seven days between first/last receipts, at most
   1% fallback, p95 at most 50 ms, and no fixed-constraint failures. Exports over
   10,000 receipts are explicitly truncated and cannot qualify.
5. A Publisher inspects the evidence and records a rationale to approve the
   exact bundle/report. The trusted Worker signs it; approval does not activate.
6. End shadow, then activate the signed manifest using the current generation.
   Concurrent or stale changes fail. Inspect the served version and run a real
   Builder request; approval and actual application are separate facts.
7. Use Roll back to original ranking and inspect the immutable transition
   history. Verify the original order and version on a fresh Builder request.

These initial operational limits are a strict release envelope for a maximum
100-item adapter, not statistical relevance proof. Fictional software tests
measure mechanism behavior. Real reviewed offline comparisons measure utility;
public client snapshots and traffic volume cannot manufacture accepted labels.
Confirm real latency/traffic coverage before changing the declared envelope.

The same feature function feeds ranking and explicit feedback. Learned results
carry their actual policy version plus the original incumbent position, so
later fitting cannot confuse the learned order with the baseline.

## Routes and records

All routes are under `/api/autonomy/forge-policy/`. `resolve` requires bounded
same-origin input and ingress limiting; `status` is public. Candidate, shadow,
evaluation, approval, activation, rollback, and audit operations require the
review credential. The dashboard additionally enforces Publisher/Admin for
approval, activation and rollback and writes an attributed audit before delivery.

Candidate, evaluation and signed manifest artifacts use the existing append-only
evidence ledger. Migration 0008 supplies atomic generation checks, automatic
immutable transition records, and digest-only operational receipts. Shadow
receipts preserve candidate result digests while returning incumbent order.
Operational receipts use the existing bounded serving-receipt retention;
candidate/evaluation/manifest artifacts and transition history remain separate.
Receipt failure prevents a successful resolve response; the client falls back.

`npm run test:runtime` exercises fictional registration, repeated requests,
signature rejection, pending versus approved release, fixed strata, fallback and
rollback. These tests are fully software-only and require no physical device.
