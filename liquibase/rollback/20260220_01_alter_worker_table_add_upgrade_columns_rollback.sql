ALTER TABLE worker
  DROP COLUMN IF EXISTS upgrade_completed_at,
  DROP COLUMN IF EXISTS upgrade_execution_status,
  DROP COLUMN IF EXISTS staged_version,
  DROP COLUMN IF EXISTS worker_version,
  DROP COLUMN IF EXISTS upgrade_bundle_staged;
