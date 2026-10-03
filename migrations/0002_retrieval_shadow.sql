CREATE TABLE IF NOT EXISTS retrieval_candidates (
  candidate_version TEXT PRIMARY KEY,
  bundle_sha256 TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  incumbent_version TEXT NOT NULL,
  runtime_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state = 'registered-shadow-only'),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created TEXT NOT NULL,
  UNIQUE(candidate_version, bundle_sha256, runtime_digest)
);

CREATE TABLE IF NOT EXISTS retrieval_shadow_state (
  policy_id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL REFERENCES retrieval_candidates(candidate_version),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_shadow_receipts (
  id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL REFERENCES retrieval_candidates(candidate_version),
  query_id TEXT NOT NULL,
  input_revision TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_shadow_receipts_candidate
  ON retrieval_shadow_receipts(candidate_version, created);
CREATE INDEX IF NOT EXISTS retrieval_shadow_receipts_query
  ON retrieval_shadow_receipts(query_id, created);
