--liquibase formatted sql

--changeset ndm:20251120_01_alter_inventory_table_add_checksum_time_column
--comment: Add checksum_time column to inventory table to store when checksum was generated

ALTER TABLE datamigrator.inventory 
ADD COLUMN IF NOT EXISTS checksum_time TIMESTAMP NULL;

COMMENT ON COLUMN datamigrator.inventory.checksum_time IS 'Timestamp when the file checksum was generated during migration';

--rollback ALTER TABLE datamigrator.inventory DROP COLUMN IF EXISTS checksum_time;
