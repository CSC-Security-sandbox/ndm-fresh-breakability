-- Add env_variables column to worker table
ALTER TABLE worker ADD COLUMN IF NOT EXISTS env_variables json NULL;
