# Audit repairs: 2026-09-09

These are local source repairs. Production deployment and live verification are separate steps.

## Model access and rollout

Claude, Groq, Gemini and the legacy Wingman alias require X-Proxy-Secret matching WINGMAN_PROXY_SECRET. Never embed this secret in public JavaScript. Authorized callers must supply it themselves or use a trusted backend. Anonymous paid-model access is disabled. Missing budget configuration returns 503 before contacting a provider.

Deploy the budget service from wrangler.budget.jsonc first, then the Pages project with the external MODEL_BUDGET binding in wrangler.jsonc. Preserve existing provider keys. Configure the private Access audience and team as described in PRIVATE_GATE.md. No production services or secrets were changed during this repair.

The shared SQLite budget limits all providers together to 20 requests/minute, 200/day and 250,000 conservative input-byte plus output-token units/day. This is a usage budget, not a dollar guarantee. Upstream failures consume reservations. Inputs accept text only, at most 32 KiB; output is capped at 4,096 tokens with one candidate. CLAUDE_ALLOWED_MODELS, GROQ_ALLOWED_MODELS and GEMINI_ALLOWED_MODELS may supply comma-separated allowlists. Credentialed provider availability still needs a production check.

## Data and evidence

Current datasets reject missing, invalid, stale or implausibly future timestamps. A stale or malformed KV candidate no longer hides an independently fresh static candidate. The health page applies the same validation to fallback responses and recalculates catalog row freshness.

The companion Pipeline repair removes phrase-based forecast grading. Legacy outcomes remain auditable but do not count toward calibration. Active forecasts remain open; matching articles are review candidates. Grading requires a dated review bound to the exact prediction and criteria. Quality scores use current input timestamps, hashes, eligible article-source denominators and explicit missing-health behavior.

## Build and verification

Use python build_static.py --offline for committed inputs, optionally with an explicit --data-dir. Online builds require --data-ref with an exact 40-character commit. Private export is opt-in. Source is staged in a temporary directory; generation and count mismatches fail the build. build/build-manifest.json records input/artifact hashes.

CI runs source and built audits with --all --strict, worker/browser helper regressions and the SQLite concurrency/restart test (npm ci; npm run test:runtime). The repairs include verification-page JavaScript and rendering, duplicate flag IDs and navigation styles, API interception, link isolation, accessible labels and landmarks, and unavailable awards response handling.

Local credential bookmarks do not publish credentials for another device. Shared IDs cannot select another browser's local credentials. Software checks do not establish live deployment or data freshness in production.
