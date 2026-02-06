-- Rollback: Remove job_run_type column from jobrun table
ALTER TABLE jobrun 
DROP COLUMN IF EXISTS job_run_type;
