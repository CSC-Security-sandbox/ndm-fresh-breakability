ALTER TABLE worker
  DROP COLUMN IF EXISTS staged_version,
  DROP COLUMN IF EXISTS worker_version,
  DROP COLUMN IF EXISTS upgrade_bundle_staged;
