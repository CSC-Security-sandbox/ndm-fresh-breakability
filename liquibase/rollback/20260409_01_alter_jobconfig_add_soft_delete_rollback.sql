-- Rollback: Remove is_deleted column for soft-delete support
ALTER TABLE jobconfig DROP COLUMN IF EXISTS is_deleted;
