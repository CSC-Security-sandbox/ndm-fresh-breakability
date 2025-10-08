-- Rollback: Remove inode column from inventory table
-- This rollback script removes the inode column added by 20251008_01_add_inode_column_to_inventory.sql

ALTER TABLE inventory DROP COLUMN IF EXISTS inode;