-- Rollback: Remove indexes from operations table
DROP INDEX IF EXISTS idx_operations_job_run_id_id;
DROP INDEX IF EXISTS idx_operations_parent_dir;
