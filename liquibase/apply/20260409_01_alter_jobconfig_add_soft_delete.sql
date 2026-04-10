-- Add is_deleted column for soft-delete support
ALTER TABLE jobconfig ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE NOT NULL;