PRAGMA foreign_keys = ON;

CREATE TABLE ecosystem_organizations (
  organization_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OEM','MANUFACTURER','SUPPLIER','OPERATOR','HYBRID')),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE ecosystem_memberships (
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  access_subject TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','EDITOR','VIEWER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (organization_id, access_subject)
);

CREATE TABLE ecosystem_product_revisions (
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  product_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL,
  part_number TEXT NOT NULL,
  category TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  publication_state TEXT NOT NULL CHECK (publication_state IN ('DRAFT','REVIEWED','PUBLISHED','WITHDRAWN')),
  contract_json TEXT NOT NULL,
  product_digest TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  published_at_ms INTEGER,
  PRIMARY KEY (organization_id, product_id, revision)
);
CREATE INDEX ecosystem_products_public ON ecosystem_product_revisions(publication_state, category, manufacturer_id, published_at_ms);

CREATE TABLE ecosystem_bom_revisions (
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  bom_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_revision TEXT NOT NULL,
  publication_state TEXT NOT NULL CHECK (publication_state IN ('DRAFT','REVIEWED','PUBLISHED','WITHDRAWN')),
  contract_json TEXT NOT NULL,
  bom_digest TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  published_at_ms INTEGER,
  PRIMARY KEY (organization_id, bom_id, revision)
);

CREATE TABLE ecosystem_supplier_offers (
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  offer_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_revision TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  available_quantity INTEGER NOT NULL,
  lead_time_days INTEGER NOT NULL,
  valid_until_ms INTEGER NOT NULL,
  sponsored INTEGER NOT NULL CHECK (sponsored IN (0,1)),
  publication_state TEXT NOT NULL CHECK (publication_state IN ('DRAFT','REVIEWED','PUBLISHED','WITHDRAWN')),
  contract_json TEXT NOT NULL,
  offer_digest TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (organization_id, offer_id)
);
CREATE INDEX ecosystem_offers_public ON ecosystem_supplier_offers(publication_state, product_id, valid_until_ms, sponsored, unit_price_minor);

CREATE TABLE ecosystem_catalog_imports (
  organization_id TEXT NOT NULL REFERENCES ecosystem_organizations(organization_id),
  import_id TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('PRODUCTS','BOMS','OFFERS')),
  object_key TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','PARTIAL','REJECTED')),
  error_json TEXT,
  submitted_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (organization_id, import_id)
);
