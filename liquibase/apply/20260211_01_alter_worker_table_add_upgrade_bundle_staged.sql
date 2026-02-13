-- Add upgrade_bundle_staged column to worker table
-- Tracks the upgrade bundle distribution status for this worker
-- Values: IDLE (default), IN_PROGRESS, COMPLETED
ALTER TABLE worker ADD COLUMN IF NOT EXISTS upgrade_bundle_staged VARCHAR(20) DEFAULT 'IDLE';
