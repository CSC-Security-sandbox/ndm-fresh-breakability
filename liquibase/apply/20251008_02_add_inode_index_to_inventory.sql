-- Add index for inode column with job_run_id
-- This migration adds the composite index that was missing from the original inode column migration

-- Add composite index for efficient querying by inode and job_run_id
CREATE INDEX IF NOT EXISTS idx_inventory_jobrun_id_inode ON inventory USING btree (job_run_id, inode);