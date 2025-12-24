-- Drop the parent directory expression index on operations table
DROP INDEX IF EXISTS datamigrator.idx_operations_parent_dir;

-- Drop the composite index on operations table
DROP INDEX IF EXISTS datamigrator.idx_operations_job_run_id_id;

-- Remove the error_status column from operation_errors table
ALTER TABLE datamigrator.operation_errors DROP COLUMN IF EXISTS error_status;
