# Private gate: /private/*

Configure a Cloudflare Access application for this prefix on each hostname, with an explicit user allowlist. Set PRIVATE_ACCESS_TEAM_DOMAIN to the team's team.cloudflareaccess.com hostname and PRIVATE_ACCESS_AUD to the application audience. The Pages Function verifies the RS256 JWT signature against the team's JWKS, issuer, audience and expiration. An identity header alone never grants access.

The optional PRIVATE_GATE_SECRET permits password sign-in. Successful sign-in issues a signed, expiring HttpOnly cookie; the cookie never contains the password. Legacy password cookies must sign in again. Prefer the password form over query parameters because URLs can appear in history and logs. Remove the fallback secret when no longer needed.

Private responses are no-store and noindex. Keep /private/* in _routes.json and out of public sitemaps. Private exports require GITHUB_PAT read access to DroneWuKong/Ai-Project, --data-ref with an exact commit, and --include-private. A failed requested export stops the build. Offline builds omit it; neighboring checkouts are not used.

See [repair and rollout notes](AUDIT_REPAIRS_2026-09-09.md).
