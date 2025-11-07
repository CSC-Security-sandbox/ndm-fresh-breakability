-- Change inode column type from  numeric to bigint in inventory table
ALTER TABLE inventory ALTER COLUMN inode TYPE BIGINT;
