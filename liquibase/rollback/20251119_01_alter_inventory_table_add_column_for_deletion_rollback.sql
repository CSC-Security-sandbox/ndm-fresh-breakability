-- Change inode column type from bigint to numeric in inventory table
ALTER TABLE inventory DROP COLUMN deleted;
