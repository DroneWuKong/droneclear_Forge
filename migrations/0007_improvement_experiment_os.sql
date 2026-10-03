CREATE TABLE IF NOT EXISTS improvement_experiments (
  experiment_id TEXT PRIMARY KEY,
  experiment_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS improvement_candidates (
  candidate_id TEXT PRIMARY KEY,
  candidate_record_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS improvement_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  evaluation_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS improvement_incidents (
  incident_id TEXT PRIMARY KEY,
  incident_digest TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS improvement_serving_receipts (
  receipt_id TEXT PRIMARY KEY,
  receipt_digest TEXT NOT NULL UNIQUE,
  policy_id TEXT NOT NULL,
  configured_version TEXT,
  actual_version TEXT NOT NULL,
  active_generation INTEGER NOT NULL CHECK(active_generation >= 0),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS improvement_experiments_no_update
BEFORE UPDATE ON improvement_experiments BEGIN SELECT RAISE(ABORT, 'improvement experiments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_experiments_no_delete
BEFORE DELETE ON improvement_experiments BEGIN SELECT RAISE(ABORT, 'improvement experiments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_candidates_no_update
BEFORE UPDATE ON improvement_candidates BEGIN SELECT RAISE(ABORT, 'improvement candidates are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_candidates_no_delete
BEFORE DELETE ON improvement_candidates BEGIN SELECT RAISE(ABORT, 'improvement candidates are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_evaluations_no_update
BEFORE UPDATE ON improvement_evaluations BEGIN SELECT RAISE(ABORT, 'improvement evaluations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_evaluations_no_delete
BEFORE DELETE ON improvement_evaluations BEGIN SELECT RAISE(ABORT, 'improvement evaluations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_incidents_no_update
BEFORE UPDATE ON improvement_incidents BEGIN SELECT RAISE(ABORT, 'improvement incidents are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_incidents_no_delete
BEFORE DELETE ON improvement_incidents BEGIN SELECT RAISE(ABORT, 'improvement incidents are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_serving_receipts_no_update
BEFORE UPDATE ON improvement_serving_receipts BEGIN SELECT RAISE(ABORT, 'improvement serving receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS improvement_serving_receipts_no_delete
BEFORE DELETE ON improvement_serving_receipts BEGIN SELECT RAISE(ABORT, 'improvement serving receipts are immutable'); END;
