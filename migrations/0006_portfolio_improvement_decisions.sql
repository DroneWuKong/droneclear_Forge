CREATE TABLE IF NOT EXISTS portfolio_improvement_decisions (
  decision_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL UNIQUE,
  decision_digest TEXT NOT NULL UNIQUE,
  chain_digest TEXT NOT NULL,
  lane TEXT NOT NULL,
  candidate_digest TEXT NOT NULL,
  permitted_surface TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  active_generation INTEGER NOT NULL CHECK(active_generation >= 0),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS portfolio_improvement_candidate_sequence
  ON portfolio_improvement_decisions(candidate_digest, decision_sequence);
CREATE INDEX IF NOT EXISTS portfolio_improvement_surface_sequence
  ON portfolio_improvement_decisions(permitted_surface, decision_sequence);

CREATE TABLE IF NOT EXISTS portfolio_improvement_chains (
  chain_digest TEXT PRIMARY KEY,
  candidate_digest TEXT NOT NULL UNIQUE,
  evidence_chain_digest TEXT NOT NULL,
  final_decision_id TEXT NOT NULL REFERENCES portfolio_improvement_decisions(decision_id),
  state TEXT NOT NULL CHECK(state IN ('approved','active','rolled-back','superseded','quarantined')),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);

ALTER TABLE retrieval_policy_state ADD COLUMN improvement_decision_json TEXT CHECK(
  improvement_decision_json IS NULL OR json_valid(improvement_decision_json)
);
ALTER TABLE retrieval_policy_state ADD COLUMN improvement_decision_digest TEXT;
ALTER TABLE retrieval_policy_state ADD COLUMN improvement_chain_digest TEXT;
ALTER TABLE retrieval_policy_transitions ADD COLUMN improvement_decision_json TEXT CHECK(
  improvement_decision_json IS NULL OR json_valid(improvement_decision_json)
);
ALTER TABLE retrieval_policy_transitions ADD COLUMN improvement_decision_digest TEXT;
ALTER TABLE retrieval_policy_transitions ADD COLUMN improvement_chain_digest TEXT;

DROP TRIGGER IF EXISTS retrieval_policy_state_insert_manifest;
CREATE TRIGGER retrieval_policy_state_insert_manifest
AFTER INSERT ON retrieval_policy_state
BEGIN
  UPDATE retrieval_policy_manifests
  SET state='active', updated=NEW.updated
  WHERE id=NEW.manifest_id AND NEW.manifest_id IS NOT NULL;
  INSERT INTO retrieval_policy_transitions(
    policy_id,from_version,to_version,action,generation,manifest_id,notes,created,
    improvement_decision_json,improvement_decision_digest,improvement_chain_digest
  ) VALUES(
    NEW.policy_id,'lexical-subject-v2',NEW.active_version,NEW.last_action,
    NEW.generation,NEW.manifest_id,NEW.last_notes,NEW.updated,
    NEW.improvement_decision_json,NEW.improvement_decision_digest,NEW.improvement_chain_digest
  );
  INSERT INTO portfolio_improvement_decisions(
    decision_id,decision_digest,chain_digest,lane,candidate_digest,permitted_surface,
    previous_state,new_state,active_generation,record_json,created
  )
  SELECT
    json_extract(NEW.improvement_decision_json,'$.decisionId'),
    NEW.improvement_decision_digest,NEW.improvement_chain_digest,
    json_extract(NEW.improvement_decision_json,'$.lane'),
    json_extract(NEW.improvement_decision_json,'$.candidateDigest'),
    json_extract(NEW.improvement_decision_json,'$.permittedSurface'),
    json_extract(NEW.improvement_decision_json,'$.previousState'),
    json_extract(NEW.improvement_decision_json,'$.newState'),
    json_extract(NEW.improvement_decision_json,'$.activeGeneration'),
    NEW.improvement_decision_json,NEW.updated
  WHERE NEW.improvement_decision_json IS NOT NULL;
  UPDATE portfolio_improvement_chains
  SET final_decision_id=json_extract(NEW.improvement_decision_json,'$.decisionId'),
      state='active',updated=NEW.updated
  WHERE chain_digest=NEW.improvement_chain_digest
    AND NEW.improvement_decision_json IS NOT NULL;
END;

DROP TRIGGER IF EXISTS retrieval_policy_state_update_manifests;
CREATE TRIGGER retrieval_policy_state_update_manifests
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
    policy_id,from_version,to_version,action,generation,manifest_id,notes,created,
    improvement_decision_json,improvement_decision_digest,improvement_chain_digest
  ) VALUES(
    NEW.policy_id,OLD.active_version,NEW.active_version,NEW.last_action,
    NEW.generation,NEW.manifest_id,NEW.last_notes,NEW.updated,
    NEW.improvement_decision_json,NEW.improvement_decision_digest,NEW.improvement_chain_digest
  );
  INSERT INTO portfolio_improvement_decisions(
    decision_id,decision_digest,chain_digest,lane,candidate_digest,permitted_surface,
    previous_state,new_state,active_generation,record_json,created
  )
  SELECT
    json_extract(NEW.improvement_decision_json,'$.decisionId'),
    NEW.improvement_decision_digest,NEW.improvement_chain_digest,
    json_extract(NEW.improvement_decision_json,'$.lane'),
    json_extract(NEW.improvement_decision_json,'$.candidateDigest'),
    json_extract(NEW.improvement_decision_json,'$.permittedSurface'),
    json_extract(NEW.improvement_decision_json,'$.previousState'),
    json_extract(NEW.improvement_decision_json,'$.newState'),
    json_extract(NEW.improvement_decision_json,'$.activeGeneration'),
    NEW.improvement_decision_json,NEW.updated
  WHERE NEW.improvement_decision_json IS NOT NULL;
  UPDATE portfolio_improvement_chains
  SET final_decision_id=json_extract(NEW.improvement_decision_json,'$.decisionId'),
      state=CASE WHEN NEW.last_action='rollback' THEN 'rolled-back' ELSE 'active' END,
      updated=NEW.updated
  WHERE chain_digest=NEW.improvement_chain_digest
    AND NEW.improvement_decision_json IS NOT NULL;
END;
