ALTER TABLE ecosystem_partner_email_requests ADD COLUMN return_origin TEXT;

CREATE TABLE ecosystem_developer_hub_access (
  request_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES ecosystem_partner_accounts(account_id),
  site TEXT NOT NULL CHECK (site IN ('orqa-reference','prismo-full')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
  reason TEXT NOT NULL,
  requested_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  reviewed_by TEXT,
  PRIMARY KEY (account_id, site)
);
CREATE TABLE ecosystem_developer_hub_notifications (
  request_id TEXT PRIMARY KEY REFERENCES ecosystem_developer_hub_access(request_id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX ecosystem_developer_hub_review_queue ON ecosystem_developer_hub_access(status, requested_at_ms);
