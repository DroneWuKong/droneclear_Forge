CREATE TABLE ecosystem_partner_reviewers (
  account_id TEXT PRIMARY KEY REFERENCES ecosystem_partner_accounts(account_id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  assigned_by TEXT NOT NULL,
  assigned_at_ms INTEGER NOT NULL
);
