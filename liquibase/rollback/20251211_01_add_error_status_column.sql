-- Rollback: Remove error_status column from operation_errors table
ALTER TABLE operation_errors 
DROP COLUMN IF EXISTS error_status;

-- Rollback: Remove job_run_type column from jobrun table
ALTER TABLE jobrun 
DROP COLUMN IF EXISTS job_run_type;
