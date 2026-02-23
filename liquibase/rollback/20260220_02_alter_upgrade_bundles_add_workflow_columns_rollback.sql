ALTER TABLE upgrade_bundles
  DROP COLUMN IF EXISTS worker_upgrade_status,
  DROP COLUMN IF EXISTS worker_upload_status,
  DROP COLUMN IF EXISTS upgrade_worker_triggered_at,
  DROP COLUMN IF EXISTS worker_upload_triggered_at,
  DROP COLUMN IF EXISTS execution_workflow_id,
  DROP COLUMN IF EXISTS multicast_workflow_id;
