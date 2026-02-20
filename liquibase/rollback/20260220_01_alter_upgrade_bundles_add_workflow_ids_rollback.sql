ALTER TABLE upgrade_bundles
  DROP COLUMN IF EXISTS worker_upgrade_status,
  DROP COLUMN IF EXISTS worker_upload_status,
  DROP COLUMN IF EXISTS upgrade_worker_triggered_at,
  DROP COLUMN IF EXISTS execution_workflow_id,
  DROP COLUMN IF EXISTS multicast_workflow_id,
  DROP COLUMN IF EXISTS upgrade_completed_at, 
  DROP COLUMN IF EXISTS upgrade_execution_status;

ALTER TABLE worker
  DROP COLUMN IF EXISTS staged_version,
  DROP COLUMN IF EXISTS worker_version,
  DROP COLUMN IF EXISTS upgrade_bundle_staged;
