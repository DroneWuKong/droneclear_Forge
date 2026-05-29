# PIE Email Digest — setup

The PIE email digest is the daily "what changed since yesterday" brief delivered
to opt-in subscribers. It's built on the flag-state ledger (`pie_delta`) and is
**inert until provisioned** — no email is ever sent without a provider key.

## Architecture

- **`workers/digest.js`** — `/api/digest/*` endpoints (subscribe, confirm,
  unsubscribe, preview, admin send). Mounted via `workers/index.js`.
- **Subscribers** live in KV namespace `DIGEST_SUBS` (`sub/<email>` records,
  double-opt-in).
- **Content** is built at send time from KV (`pie_delta`, `pie_brief`, `flags`)
  — the same data the live board shows.
- **Trigger**: the daily `pie-daily` workflow in `DroneWuKong/Ai-Project` POSTs
  `/api/digest/send` after it syncs fresh data to KV (reuses the existing daily
  cadence — no separate cron). Sundays also fire the `weekly` cadence.

## One-time provisioning

1. **Create the subscriber KV namespace** and paste the id into `wrangler.jsonc`
   (the `DIGEST_SUBS` binding, currently `REPLACE_WITH_digest-subs_KV_ID`):
   ```
   wrangler kv namespace create digest-subs
   ```
2. **Pick an email provider** (Resend by default — https://resend.com) and
   **verify the sending domain** (SPF + DKIM DNS records for `uas-patterns.com`).
3. **Set secrets** (CF dashboard or `wrangler secret put`):
   - `RESEND_API_KEY` — provider API key
   - `DIGEST_FROM` — verified sender, e.g. `PIE <brief@uas-patterns.com>`
   - `DIGEST_ADMIN_KEY` — shared secret gating `POST /api/digest/send`
   - `DIGEST_BASE_URL` *(optional)* — defaults to `https://uas-patterns.com`
4. **In `DroneWuKong/Ai-Project`**, set repo secrets so `pie-daily.yml` can
   trigger sends:
   - `DIGEST_SEND_URL` = `https://uas-patterns.com/api/digest/send`
   - `DIGEST_ADMIN_KEY` = same value as above

## Verify before going live

- **Preview the email** without sending anyone:
  `GET https://uas-patterns.com/api/digest/preview` → renders the current digest HTML.
- **Subscribe yourself**, confirm via the email, then run a manual send:
  ```
  curl -X POST https://uas-patterns.com/api/digest/send \
    -H "X-Digest-Key: $DIGEST_ADMIN_KEY" -H "Content-Type: application/json" \
    -d '{"cadence":"daily"}'
  ```
  Response reports `{sent, skipped, failed, provider_configured}`.

## Safety / behavior

- **No provider configured** → subscribe stores the address as `pending`; send is
  a logged no-op (`provider_configured:false`). Nothing leaves the system.
- **Double opt-in**: a new address is `pending` until the confirm link is clicked.
- **One-click unsubscribe**: every email carries `List-Unsubscribe` headers + a
  footer link; unsubscribe is tokened and doesn't reveal subscription state.
- **Cap**: at most `MAX_BROADCAST` (5000) recipients per send as a guardrail.
