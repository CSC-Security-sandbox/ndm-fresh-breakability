-- Create composite index on operations for optimized cursor-based pagination
CREATE INDEX IF NOT EXISTS idx_operations_job_run_id_id ON operations (job_run_id, id);

-- Add expression index on operations table for parent directory
-- This optimizes retry queries that order by parent directory to reduce target directory reads
CREATE INDEX IF NOT EXISTS idx_operations_parent_dir 
ON operations (
  job_run_id,
  COALESCE(NULLIF(regexp_replace(f_path, '/[^/]*$', ''), ''), '/')
);
