# UAS www redirects

`www.uas-forge.com` and `www.uas-patterns.com` returned HTTP 522 during the
October 1, 2026 traffic review. The desired public behavior is a 301 to the
matching HTTPS apex, preserving the path and query string.

`tools/repair_www_redirects.py` preflights the two fixed zones in the known
account. It preserves existing proxied www DNS records and adds or updates
only its exact-host Single Redirect rule. It uses individual rule operations;
it does not replace a ruleset, delete DNS, change an apex, or alter security
rules. A missing www record can be created as a proxied CNAME to the apex;
an existing unproxied A/AAAA/CNAME can be proxied. Unexpected record types or
account identities stop the preflight before any writes.

The `Check or repair UAS www redirects` workflow tests fixtures without
credentials on PRs. Merging changes to this script/workflow on master applies
the fixed configuration using the already configured deployment token. It can
also be run manually in read-only `check` mode or `apply` mode. If existing
credentials cannot read/write the necessary zone configuration, the workflow
fails explicitly. It does not create credentials or broaden token access.

A successful API operation does not prove the live hostname is repaired.
Verify these exact redirects with GET, without following redirects:

- `https://www.uas-forge.com/browse/?from=uas-health` →
  `https://uas-forge.com/browse/?from=uas-health`
- `https://www.uas-patterns.com/patterns-home/?from=uas-health` →
  `https://uas-patterns.com/patterns-home/?from=uas-health`

The Portfolio Traffic panel verifies both live destinations. If a prior rule
takes precedence, review the existing redirect ordering in Cloudflare rather
than overwriting unrelated rules. The rule format follows
[Cloudflare's Single Redirects API](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-api/).
