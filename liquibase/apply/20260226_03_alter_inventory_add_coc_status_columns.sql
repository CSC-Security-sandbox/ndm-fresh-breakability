ALTER TABLE datamigrator.inventory
ADD COLUMN IF NOT EXISTS copy_content_status TEXT NULL,
ADD COLUMN IF NOT EXISTS stamp_meta_data_status TEXT NULL;
