DROP INDEX IF EXISTS datamigrator.idx_inventory_job_run_id_update_type;
ALTER TABLE datamigrator.inventory DROP COLUMN IF EXISTS update_type;

DROP INDEX IF EXISTS datamigrator.idx_inventory_job_run_id_entry_type;
ALTER TABLE datamigrator.inventory DROP COLUMN IF EXISTS entry_type;
