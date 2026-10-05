CREATE TABLE IF NOT EXISTS forge_matching_policy_state (
  policy_id TEXT PRIMARY KEY CHECK(policy_id='forge-product-matching'),
  active_version TEXT NOT NULL DEFAULT 'compatibility-weight-v1',
  active_manifest_id TEXT,
  shadow_version TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  action TEXT NOT NULL DEFAULT 'initialize',
  notes TEXT NOT NULL DEFAULT '',
  updated TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS forge_matching_transitions (
  generation INTEGER PRIMARY KEY,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  shadow_version TEXT,
  action TEXT NOT NULL,
  notes TEXT NOT NULL,
  created TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS forge_matching_state_generation
BEFORE UPDATE ON forge_matching_policy_state WHEN NEW.generation!=OLD.generation+1
BEGIN SELECT RAISE(ABORT,'Forge generation must advance exactly once'); END;
CREATE TRIGGER IF NOT EXISTS forge_matching_state_audit
AFTER UPDATE ON forge_matching_policy_state BEGIN
  INSERT INTO forge_matching_transitions VALUES(NEW.generation,OLD.active_version,
    NEW.active_version,NEW.shadow_version,NEW.action,NEW.notes,NEW.updated);
END;
CREATE TRIGGER IF NOT EXISTS forge_matching_transitions_no_update
BEFORE UPDATE ON forge_matching_transitions BEGIN SELECT RAISE(ABORT,'Forge transitions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS forge_matching_transitions_no_delete
BEFORE DELETE ON forge_matching_transitions BEGIN SELECT RAISE(ABORT,'Forge transitions are immutable'); END;
CREATE TABLE IF NOT EXISTS forge_matching_receipts (
  id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  context_sha256 TEXT NOT NULL,
  catalog_revision TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('shadow','active')),
  outcome TEXT NOT NULL CHECK(outcome IN ('compared','fallback')),
  reason TEXT,
  latency_ms REAL NOT NULL CHECK(latency_ms>=0),
  input_sha256 TEXT NOT NULL,
  result_sha256 TEXT NOT NULL,
  created TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS forge_matching_receipts_candidate ON forge_matching_receipts(candidate_version,mode,created);
CREATE TRIGGER IF NOT EXISTS forge_matching_receipts_no_update
BEFORE UPDATE ON forge_matching_receipts BEGIN SELECT RAISE(ABORT,'Forge receipts are immutable'); END;
