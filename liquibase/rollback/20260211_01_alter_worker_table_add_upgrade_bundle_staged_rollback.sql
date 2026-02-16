-- Rollback: remove upgrade_bundle_staged column from worker table
ALTER TABLE worker DROP COLUMN IF EXISTS upgrade_bundle_staged;
