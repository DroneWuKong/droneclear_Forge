# DroneWuKong Private Data API

The private v1 API provides authenticated, exact-key access to six explicitly
allowlisted Cloudflare KV namespaces. It is separate from the public API and
never falls back to bundled public JSON.

## Boundary

**Base URL:** `https://uas-patterns.com/api/private/v1`

**Authentication:**

```http
Authorization: Bearer <PRIVATE_API_KEY>
```

All routes fail closed when `PRIVATE_API_KEY` is absent. The token is compared
in constant time after hashing and must be configured as a Cloudflare secret,
never committed to the repository.

The private API exposes only these existing bindings:

| API namespace | Cloudflare binding | Purpose |
|---|---|---|
| `pie` | `PIE_DB` | PIE working and curated data |
| `outputs` | `PIE_OUTPUTS` | Validated pipeline outputs |
| `parts` | `PARTS_DB` | Parts and pricing working data |
| `procurement` | `PROCUREMENT_DB` | Procurement working data |
| `grayzone` | `GRAYZONE_DB` | Gray-zone working data |
| `history` | `PIE_HISTORY` | Historical PIE snapshots |

Subscriber records, analytics, doctrine uploads, model-provider credentials,
and other bindings are not addressable through this API.

## Discovery and schema

```bash
curl -H "Authorization: Bearer $PRIVATE_API_KEY" \
  https://uas-patterns.com/api/private/v1

curl -H "Authorization: Bearer $PRIVATE_API_KEY" \
  https://uas-patterns.com/api/private/v1/openapi.json
```

The OpenAPI document is itself authenticated.

## List keys

```http
GET /api/private/v1/datasets/{namespace}?prefix=<prefix>&limit=100&cursor=<cursor>
```

`limit` is clamped to 1–1000. Use the returned cursor until
`meta.list_complete` is true.

## Read one key

```http
GET /api/private/v1/datasets/{namespace}/{key}
```

The response labels the stored representation as `json` or `text`. Keys are
exact; the API does not perform fuzzy search or silently cross namespaces.

## Validate or write JSON

```bash
curl -X PUT \
  -H "Authorization: Bearer $PRIVATE_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @dataset.json \
  "https://uas-patterns.com/api/private/v1/datasets/outputs/example?dry_run=1"
```

`dry_run=1` parses, bounds, and normalizes the document but does not write it.
Remove `dry_run=1` only after validation succeeds. Bodies are limited to 10 MiB
and keys to 512 UTF-8 bytes. `DELETE` is intentionally not supported.

## Browser origins

Private responses never emit `Access-Control-Allow-Origin: *`. Server-to-server
clients need no CORS configuration. If a browser client is required, configure
`PRIVATE_API_ALLOWED_ORIGINS` as a comma-separated list of exact origins. An
unlisted preflight fails with HTTP 403.

## Provisioning

Create a high-entropy token and store it as the Cloudflare secret
`PRIVATE_API_KEY`. Do not reuse `PRIVATE_GATE_SECRET`, model-provider keys, or
the legacy pipeline key. Provisioning is the only deployment step that cannot
be safely committed to Git.
