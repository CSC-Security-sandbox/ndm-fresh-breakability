-- entry_type: NULL or 'inventory' = normal row, 'excluded' = excluded path, 'skipped' = skipped path.
ALTER TABLE datamigrator.inventory ADD COLUMN IF NOT EXISTS entry_type TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_job_run_id_entry_type ON datamigrator.inventory(job_run_id, entry_type);

-- update_type: 'new' = newly copied, 'content_updated' = recopied, 'metadata_updated' = metadata only.
ALTER TABLE datamigrator.inventory ADD COLUMN IF NOT EXISTS update_type TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_job_run_id_update_type ON datamigrator.inventory(job_run_id, update_type);
