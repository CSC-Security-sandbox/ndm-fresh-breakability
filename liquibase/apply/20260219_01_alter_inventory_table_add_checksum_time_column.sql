ALTER TABLE datamigrator.inventory 
ADD COLUMN IF NOT EXISTS checksum_time TIMESTAMPTZ NULL;


