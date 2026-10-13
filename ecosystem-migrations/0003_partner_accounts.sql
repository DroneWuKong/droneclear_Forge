PRAGMA foreign_keys = ON;

CREATE TABLE ecosystem_partner_accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE ecosystem_partner_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ecosystem_partner_accounts(account_id),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX ecosystem_partner_sessions_expiry ON ecosystem_partner_sessions(expires_at_ms);

CREATE TABLE ecosystem_partner_auth_windows (
  bucket TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start_ms)
);
CREATE INDEX ecosystem_partner_auth_windows_expiry ON ecosystem_partner_auth_windows(window_start_ms);

-- Preserve all historical actor identities while distinguishing partner accounts
-- from identities verified by Cloudflare Access.
CREATE TABLE ecosystem_audit_events_with_partners (
  event_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  actor_subject TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('ACCESS','SERVICE','PARTNER')),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
INSERT INTO ecosystem_audit_events_with_partners SELECT * FROM ecosystem_audit_events;
DROP TABLE ecosystem_audit_events;
ALTER TABLE ecosystem_audit_events_with_partners RENAME TO ecosystem_audit_events;
CREATE INDEX ecosystem_audit_events_org ON ecosystem_audit_events(organization_id, created_at_ms DESC);
