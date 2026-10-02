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
