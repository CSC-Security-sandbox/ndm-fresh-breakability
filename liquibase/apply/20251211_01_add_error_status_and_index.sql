-- Add error_status column to operation_errors table
ALTER TABLE operation_errors 
ADD COLUMN IF NOT EXISTS error_status VARCHAR(20) DEFAULT 'UNRESOLVED' NOT NULL;

-- Create composite index on operations for optimized cursor-based pagination
-- Note: This must be run outside a transaction when using CONCURRENTLY
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operations_job_run_id_id ON operations (job_run_id, id);

-- Add expression index on operations table for parent directory
-- This optimizes retry queries that order by parent directory to reduce target directory reads
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operations_parent_dir 
ON operations (
  job_run_id,
  COALESCE(NULLIF(regexp_replace(f_path, '/[^/]*$', ''), ''), '/')
);
