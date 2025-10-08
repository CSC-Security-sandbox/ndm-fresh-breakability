-- Add inode column to inventory table
-- This column will store the file system inode number for files and directories

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS inode bigint DEFAULT NULL;

-- Add comment to document the column purpose
COMMENT ON COLUMN inventory.inode IS 'File system inode number for tracking file identity across moves and links';