ALTER TABLE ecosystem_partner_accounts ADD COLUMN email_verified_at_ms INTEGER;
ALTER TABLE ecosystem_partner_accounts ADD COLUMN account_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ecosystem_partner_sessions ADD COLUMN account_generation INTEGER NOT NULL DEFAULT 0;

CREATE TABLE ecosystem_partner_action_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ecosystem_partner_accounts(account_id),
  purpose TEXT NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
  account_generation INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER
);
CREATE INDEX ecosystem_partner_action_tokens_expiry ON ecosystem_partner_action_tokens(expires_at_ms);

CREATE TABLE ecosystem_partner_email_requests (
  request_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ecosystem_partner_accounts(account_id),
  purpose TEXT NOT NULL CHECK (purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')),
  account_generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX ecosystem_partner_email_requests_pending ON ecosystem_partner_email_requests(status, updated_at_ms);

-- Historical revisions keep their original contracts and evidence. They remain
-- private until a complete revision passes the current publication checks.
ALTER TABLE ecosystem_product_revisions ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1));
ALTER TABLE ecosystem_bom_revisions ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1));
