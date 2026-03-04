ALTER TABLE datamigrator.inventory
DROP COLUMN IF EXISTS copy_content_status,
DROP COLUMN IF EXISTS stamp_meta_data_status;
