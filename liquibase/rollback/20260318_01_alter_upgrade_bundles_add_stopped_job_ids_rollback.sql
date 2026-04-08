ALTER TABLE upgrade_bundles
  DROP COLUMN IF EXISTS deactivated_job_config_ids,
  DROP COLUMN IF EXISTS stopped_job_run_ids;
