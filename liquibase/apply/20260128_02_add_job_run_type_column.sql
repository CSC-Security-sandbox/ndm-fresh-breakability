-- Add job_run_type column to jobrun table
ALTER TABLE jobrun 
ADD COLUMN IF NOT EXISTS job_run_type VARCHAR DEFAULT 'REGULAR';
