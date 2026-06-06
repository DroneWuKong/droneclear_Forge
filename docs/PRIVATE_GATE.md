# Private gate — `/private/*`

How the gated intel area works, and how to lock it down. Everything under
`/private/*` (the **DDG tracker** and the **Intel Dossiers**) is meant to be
**non-public**.

## What's under the gate
| URL | Source | Notes |
|---|---|---|
| `/private/` | `forge-source/private/index.html` | landing (links the two) |
| `/private/ddg/` | `forge-source/ddg.html` | the DDG/Gauntlet tracker (the public `/ddg/` route stays **disabled** in `build_static.py`) |
| `/private/dossiers/` | `forge-source/private/dossiers.html` | dossier viewer (renders markdown client-side) |
| `/private/dossiers/*.md` + `index.json` | **pulled at build time from the private `DroneWuKong/Ai-Project` repo** (`research/profiles/*.md`, `research/ddg_*.md`) by `sync_private_dossiers()` | **never committed to this repo** — only ever in the gated build output |

So the sensitive intel text lives only in the private Ai-Project repo and in the
Access-gated build output; this (forge) repo holds just the viewer + gate code.

## The gate (two layers, fail-closed)

### 1. Cloudflare Access — the real gate (configure once, no code)
This is the answer to "can we just gate the private stuff?": **yes, one Access
policy on one path prefix.**

1. Cloudflare dashboard → **Zero Trust → Access → Applications → Add application → Self-hosted**.
2. **Application domain:** `uas-forge.com` (or whichever domain serves this Pages
   project) with **path = `/private`** (covers `/private/*`).
3. **Policies:** Action **Allow**, rule e.g. *Emails* = your allowlist (or
   *Emails ending in* your domain), Session duration to taste. Add an
   *Identity provider* (Google/GitHub/One-time PIN).
4. Save. Now every `/private/*` request must pass Access; CF injects
   `Cf-Access-Authenticated-User-Email` + `Cf-Access-Jwt-Assertion` and strips
   any client-supplied copies — so the headers are trustworthy.

Nothing else to deploy. To gate *more* private stuff later, just put it under
`/private/...` — it inherits the same policy.

### 2. Pages Function — defense-in-depth + pre-Access escape hatch
`functions/private/[[path]].js` runs for every `/private/*` request (registered
in `_routes.json` `include`). It is **fail-closed**:
- valid Access identity header present → `next()` (serve the asset);
- else if `PRIVATE_GATE_SECRET` env is set and the request supplies it
  (`?key=<secret>` once → sets a `pg` cookie, or the cookie on later requests)
  → allow. Use this to browse **before** Access is configured;
- otherwise → **403** (so content is never served unauthenticated, even if
  Access isn't set up yet).

Set/remove the escape hatch: Pages project → **Settings → Environment variables →**
`PRIVATE_GATE_SECRET`. Delete it once Access is live.

## Build requirements
- `GITHUB_PAT` (already used for data sync) must have **read** access to
  `DroneWuKong/Ai-Project` so `sync_private_dossiers()` can pull the markdown.
  Locally, a sibling `../Ai-Project/research` checkout is used instead.
- If neither is present the dossier viewer still deploys but shows its
  "index unavailable" message (no content leaked).

## Hardening notes
- `_headers` sets `/private/* → Cache-Control: no-store` + `X-Robots-Tag: noindex,nofollow`; pages also carry `<meta name="robots" content="noindex,nofollow">`.
- The Pages Function presence-checks the Access header; for stricter
  verification you can extend it to validate the Access JWT signature against
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (JWKS). Presence is
  sufficient **only while Access is actually in front** (layer 1) — keep layer 1 on.
- Do not add `/private/*` to `_redirects` or sitemap; do not link it from public nav.
