CREATE TABLE IF NOT EXISTS retrieval_serving_receipts (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  served_version TEXT NOT NULL,
  configured_version TEXT,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  query_id TEXT NOT NULL,
  input_revision TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('served','fallback')),
  fallback_reason TEXT,
  latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_serving_receipts_policy_window
  ON retrieval_serving_receipts(policy_id, configured_version, generation, created);

CREATE TABLE IF NOT EXISTS retrieval_policy_monitor_evaluations (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  evaluated_version TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  evidence_digest TEXT NOT NULL,
  rollback_recommended INTEGER NOT NULL CHECK(rollback_recommended IN (0,1)),
  requested_action TEXT NOT NULL CHECK(requested_action IN ('evaluate','evaluate-and-rollback')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_policy_monitor_evaluations_policy
  ON retrieval_policy_monitor_evaluations(policy_id, created);
