# Legacy domain redirects (Cloudflare dashboard)

These redirects come **from retired vanity domains** to the canonical
properties. They can't live in this repo's `_redirects` or in a Pages Function,
because:

- Cloudflare Pages `_redirects` matches on **path only** — the old
  `https://host/* … 301` lines (Netlify syntax) are inert and never fire. They
  remain in `_redirects` only as historical breadcrumbs (see the comment there).
- A Pages Function (`functions/index.js`) can only act on requests that already
  reach the `forge` Pages project. These legacy hosts are **separate domains**,
  so a Function on `forge` never sees them.

So they must be configured in the **Cloudflare dashboard**. This file is the
source of truth for what those rules should be.

> Handled elsewhere — do **not** add here:
> - `uas-patterns.com` apex → `/patterns-home/` and `uasdash.com` apex →
>   `/hub/` are custom domains **on the `forge` project**; their apex is handled
>   by `functions/index.js`. Sub-paths serve Forge content natively.

## Prerequisite

Each source domain must be an **active zone in the Cloudflare account** (DNS
managed by CF) with a **proxied** (orange-cloud) record on `@` and `www` — a
dummy `A 192.0.2.1` / `AAAA ::` is enough, since the request is intercepted and
301'd before origin. If a domain is **not** in Cloudflare, do the redirect at
the registrar instead.

## Canonical destinations

| Source domain (+ `www.`)     | Redirects to            |
|------------------------------|-------------------------|
| `uas-intel.com`              | `https://uas-patterns.com` |
| `uas-patterns.pro`           | `https://uas-patterns.com` |
| `nvmillfindoutmyself.com`    | `https://uas-patterns.com` |
| `nvmillbuilditmyself.com`    | `https://uas-forge.com` |

All are **301 (permanent)**, **path-preserving**, **query-preserving** — i.e. the
old `/* → /:splat 301` behavior.

## Option A — Redirect Rules (per zone) — recommended

For each zone: **Rules → Redirect Rules → Create rule**.

- **When incoming requests match** (custom filter expression):
  `(http.host eq "<domain>") or (http.host eq "www.<domain>")`
- **Then** → **Type:** Dynamic ·
  **Expression:** `concat("https://<canonical>", http.request.uri.path)` ·
  **Status code:** 301 · **Preserve query string:** ✅

| Zone                       | Match expression                                                              | Redirect URL (Dynamic)                                       |
|----------------------------|-------------------------------------------------------------------------------|--------------------------------------------------------------|
| `uas-intel.com`            | `(http.host eq "uas-intel.com") or (http.host eq "www.uas-intel.com")`                       | `concat("https://uas-patterns.com", http.request.uri.path)` |
| `uas-patterns.pro`         | `(http.host eq "uas-patterns.pro") or (http.host eq "www.uas-patterns.pro")`                 | `concat("https://uas-patterns.com", http.request.uri.path)` |
| `nvmillfindoutmyself.com`  | `(http.host eq "nvmillfindoutmyself.com") or (http.host eq "www.nvmillfindoutmyself.com")`   | `concat("https://uas-patterns.com", http.request.uri.path)` |
| `nvmillbuilditmyself.com`  | `(http.host eq "nvmillbuilditmyself.com") or (http.host eq "www.nvmillbuilditmyself.com")`   | `concat("https://uas-forge.com", http.request.uri.path)` |

## Option B — Bulk Redirects (one account-level list)

**Account Home → Bulk Redirects → Create a list → Add/Edit URLs.** One row per
host (8 rows for apex + `www`). Per-row options: **Subpath matching ✅,
Preserve path suffix ✅, Preserve query string ✅, Status 301.**

| Source URL                                                | Target URL                |
|-----------------------------------------------------------|---------------------------|
| `uas-intel.com` / `www.uas-intel.com`                     | `https://uas-patterns.com` |
| `uas-patterns.pro` / `www.uas-patterns.pro`               | `https://uas-patterns.com` |
| `nvmillfindoutmyself.com` / `www.nvmillfindoutmyself.com` | `https://uas-patterns.com` |
| `nvmillbuilditmyself.com` / `www.nvmillbuilditmyself.com` | `https://uas-forge.com` |

## Verify

```sh
curl -sI https://uas-intel.com/some/path?q=1 | grep -i '^location:'
# → location: https://uas-patterns.com/some/path?q=1
```
