--liquibase formatted sql

--changeset ndm:20251120_01_alter_inventory_table_add_checksum_time_column_rollback
--comment: Rollback - Remove checksum_time column from inventory table

ALTER TABLE datamigrator.inventory DROP COLUMN IF EXISTS checksum_time;
