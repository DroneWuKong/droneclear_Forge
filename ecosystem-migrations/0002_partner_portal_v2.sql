PRAGMA foreign_keys = ON;

ALTER TABLE ecosystem_product_revisions ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1));
ALTER TABLE ecosystem_product_revisions ADD COLUMN supersedes_revision TEXT;
ALTER TABLE ecosystem_product_revisions ADD COLUMN withdrawn_at_ms INTEGER;
ALTER TABLE ecosystem_product_revisions ADD COLUMN withdrawal_reason TEXT;

ALTER TABLE ecosystem_bom_revisions ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1));
ALTER TABLE ecosystem_bom_revisions ADD COLUMN supersedes_revision TEXT;
ALTER TABLE ecosystem_bom_revisions ADD COLUMN withdrawn_at_ms INTEGER;
ALTER TABLE ecosystem_bom_revisions ADD COLUMN withdrawal_reason TEXT;

ALTER TABLE ecosystem_supplier_offers ADD COLUMN product_manufacturer_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ecosystem_supplier_offers ADD COLUMN valid_at_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ecosystem_supplier_offers ADD COLUMN withdrawn_at_ms INTEGER;
ALTER TABLE ecosystem_supplier_offers ADD COLUMN withdrawal_reason TEXT;

ALTER TABLE ecosystem_catalog_imports ADD COLUMN last_error TEXT;
ALTER TABLE ecosystem_catalog_imports ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

UPDATE ecosystem_product_revisions
SET is_current = 1
WHERE rowid = (
    SELECT latest.rowid
    FROM ecosystem_product_revisions latest
    WHERE latest.organization_id = ecosystem_product_revisions.organization_id
      AND latest.product_id = ecosystem_product_revisions.product_id
      AND latest.publication_state = 'PUBLISHED'
    ORDER BY latest.published_at_ms DESC, latest.revision DESC
    LIMIT 1
  );

UPDATE ecosystem_bom_revisions
SET is_current = 1
WHERE rowid = (
    SELECT latest.rowid
    FROM ecosystem_bom_revisions latest
    WHERE latest.organization_id = ecosystem_bom_revisions.organization_id
      AND latest.bom_id = ecosystem_bom_revisions.bom_id
      AND latest.publication_state = 'PUBLISHED'
    ORDER BY latest.published_at_ms DESC, latest.revision DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX ecosystem_products_one_current
ON ecosystem_product_revisions(organization_id, product_id)
WHERE is_current = 1;
CREATE INDEX ecosystem_products_current_public
ON ecosystem_product_revisions(publication_state, is_current, category, manufacturer_id, product_id);

CREATE UNIQUE INDEX ecosystem_boms_one_current
ON ecosystem_bom_revisions(organization_id, bom_id)
WHERE is_current = 1;
CREATE INDEX ecosystem_boms_public_qualified
ON ecosystem_bom_revisions(publication_state, is_current, organization_id, product_id, product_revision);

CREATE INDEX ecosystem_offers_public_qualified
ON ecosystem_supplier_offers(publication_state, product_manufacturer_id, product_id, product_revision, valid_at_ms, valid_until_ms);

CREATE TABLE ecosystem_invitations (
  invitation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','EDITOR','VIEWER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REVOKED')),
  invited_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  accepted_at_ms INTEGER
);
CREATE UNIQUE INDEX ecosystem_pending_invitation_email
ON ecosystem_invitations(organization_id, email)
WHERE status = 'PENDING';

CREATE TABLE ecosystem_api_credentials (
  credential_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('EDITOR','VIEWER')),
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  revoked_at_ms INTEGER
);
CREATE INDEX ecosystem_api_credentials_org
ON ecosystem_api_credentials(organization_id, status, created_at_ms);

CREATE TABLE ecosystem_service_rate_windows (
  credential_id TEXT NOT NULL REFERENCES ecosystem_api_credentials(credential_id),
  window_start_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (credential_id, window_start_ms)
);

CREATE TABLE ecosystem_audit_events (
  event_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  actor_subject TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('ACCESS','SERVICE')),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX ecosystem_audit_events_org
ON ecosystem_audit_events(organization_id, created_at_ms DESC);
