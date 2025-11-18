-- Change inode column type from bigint to numeric in inventory table
ALTER TABLE inventory ADD COLUMN deleted  TYPE BOOLEAN;
