CREATE TABLE IF NOT EXISTS retrieval_shadow_attempts (
  id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL REFERENCES retrieval_candidates(candidate_version),
  state TEXT NOT NULL CHECK(state IN ('succeeded','failed')),
  latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
  error_code TEXT,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_shadow_attempts_candidate
  ON retrieval_shadow_attempts(candidate_version, created);

CREATE TABLE IF NOT EXISTS retrieval_shadow_evaluations (
  id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL REFERENCES retrieval_candidates(candidate_version),
  bundle_sha256 TEXT NOT NULL,
  evidence_digest TEXT NOT NULL UNIQUE,
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_shadow_evaluations_candidate
  ON retrieval_shadow_evaluations(candidate_version, created);

CREATE TABLE IF NOT EXISTS retrieval_policy_manifests (
  id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL UNIQUE REFERENCES retrieval_candidates(candidate_version),
  manifest_sha256 TEXT NOT NULL UNIQUE,
  signature TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('approved','active','superseded','rolled-back')),
  data TEXT NOT NULL CHECK(json_valid(data)),
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_policy_state (
  policy_id TEXT PRIMARY KEY,
  active_version TEXT NOT NULL,
  rollback_version TEXT NOT NULL,
  manifest_id TEXT REFERENCES retrieval_policy_manifests(id),
  generation INTEGER NOT NULL CHECK(generation >= 1),
  last_action TEXT NOT NULL CHECK(last_action IN ('activate','rollback')),
  last_notes TEXT NOT NULL,
  updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_policy_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('activate','rollback')),
  generation INTEGER NOT NULL,
  manifest_id TEXT,
  notes TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS retrieval_policy_state_insert_manifest
AFTER INSERT ON retrieval_policy_state
WHEN NEW.manifest_id IS NOT NULL
BEGIN
  UPDATE retrieval_policy_manifests
  SET state='active', updated=NEW.updated
  WHERE id=NEW.manifest_id;
  INSERT INTO retrieval_policy_transitions(
    policy_id,from_version,to_version,action,generation,manifest_id,notes,created
  ) VALUES(
    NEW.policy_id,'lexical-subject-v2',NEW.active_version,NEW.last_action,
    NEW.generation,NEW.manifest_id,NEW.last_notes,NEW.updated
  );
END;

CREATE TRIGGER IF NOT EXISTS retrieval_policy_state_update_manifests
AFTER UPDATE ON retrieval_policy_state
BEGIN
  UPDATE retrieval_policy_manifests
  SET state=CASE WHEN NEW.last_action='rollback' THEN 'rolled-back' ELSE 'superseded' END,
      updated=NEW.updated
  WHERE id=OLD.manifest_id AND OLD.manifest_id IS NOT NULL
    AND (NEW.manifest_id IS NULL OR id<>NEW.manifest_id);
  UPDATE retrieval_policy_manifests
  SET state='active', updated=NEW.updated
  WHERE id=NEW.manifest_id AND NEW.manifest_id IS NOT NULL;
  INSERT INTO retrieval_policy_transitions(
    policy_id,from_version,to_version,action,generation,manifest_id,notes,created
  ) VALUES(
    NEW.policy_id,OLD.active_version,NEW.active_version,NEW.last_action,
    NEW.generation,NEW.manifest_id,NEW.last_notes,NEW.updated
  );
END;
