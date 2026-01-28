-- Add error_status column to operation_errors table
ALTER TABLE operation_errors 
ADD COLUMN IF NOT EXISTS error_status VARCHAR(20) DEFAULT 'UNRESOLVED' NOT NULL;

-- Add job_run_type column to jobrun table
ALTER TABLE jobrun 
ADD COLUMN IF NOT EXISTS job_run_type VARCHAR DEFAULT 'REGULAR';
