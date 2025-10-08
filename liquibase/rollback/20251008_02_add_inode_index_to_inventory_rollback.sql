-- Rollback: Remove inode index from inventory table
-- This rollback script removes the index added by 20251008_02_add_inode_index_to_inventory.sql

DROP INDEX IF EXISTS idx_inventory_inode_jobrun_id;