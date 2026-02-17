ALTER TABLE worker DROP COLUMN IF EXISTS staged_version;
ALTER TABLE worker DROP COLUMN IF EXISTS worker_version;
ALTER TABLE worker DROP COLUMN IF EXISTS upgrade_bundle_staged;
