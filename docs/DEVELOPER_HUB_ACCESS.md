# Approved Prismo developer access

The Orqa reference hub is `dev.prismoprime.com`; the full Prismo developer lab
is `labs.prismoprime.com`. Content is hosted in their private Sites source
repositories and served by a Worker that checks the current Forge grant on
every page, script, document and download. There is no public static directory.

Accounts use the existing Forge password/session system, including PBKDF2,
email verification, reset links, rate limits and session-generation revocation.
Hub bridges forward only allowlisted account actions to the fixed Forge API.
Cookies are host-only, Secure, HttpOnly and SameSite=Strict. Passwords and
session tokens are never stored in browser local/session storage or source.

After verification the developer requests access to a specific hub. The durable
outbox emails the configured owner, `jeremiah@midwestniceuas.com`, a link to
`/access-admin`. Only a verified Forge account for that configured email can
approve, reject or revoke. Existing partner catalog membership and publication
reviewer roles do not grant developer-site approval rights. Opening an email
link does not approve anything: changes require an authenticated same-origin
POST. Approval for one hub grants nothing on the other.

Verification and reset mail can return to the requesting hub's `/login` route;
origins are selected from a fixed site-key allowlist. Ordinary Forge partner
mail still returns to `/partners/`. Origin parameters and email recipients
cannot be supplied as arbitrary URLs or addresses by the applicant.

The new schema is additive migration `0006_developer_hub_access.sql`. The
existing production deploy applies and inspects it before deploying the email
sender and Pages API. `/api/ecosystem/v1/developer-access/readiness` checks the
schema, owner configuration and approval-email service without returning
account data. Delivery failures are persisted and retried by the existing
minute sender; the owner screen displays notification status.

The separate DNS workflow adds only the six provider-returned CNAME/TXT records
in `data/developer-hub-domains.json`. It requires DNS Edit on prismoprime.com,
never changes the apex/MX records, and refuses to overwrite conflicting
records. Domain attachment is not DNS/certificate readiness; refresh the two
custom-domain records after the DNS workflow succeeds.

Public access for the Sites shell is enabled only after its server-side gate
is deployed and tested. Public visitors see signup/login; the hub itself stays
locked until approved. Forge API or email outages fail closed. Private GitHub
source permissions remain separate and are not changed by site approval.

Tests cover signup and verification return links, pending/default denial,
separate grants, owner-only decisions, CSRF rejection, revocation, session
logout, retryable mail delivery, DNS scope and existing-account compatibility.
Each hub additionally tests direct HTML/JS/JSON/download denial and checks that
the artifact has no public static fallback. No synthetic account is registered
or email sent to a real recipient by those tests.
