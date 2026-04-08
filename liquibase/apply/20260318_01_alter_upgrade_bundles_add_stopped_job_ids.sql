ALTER TABLE upgrade_bundles
  ADD COLUMN IF NOT EXISTS deactivated_job_config_ids JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stopped_job_run_ids JSONB DEFAULT NULL;
