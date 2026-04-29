ALTER TABLE worker
  ADD COLUMN IF NOT EXISTS current_multicast_workflow_id VARCHAR DEFAULT NULL;
