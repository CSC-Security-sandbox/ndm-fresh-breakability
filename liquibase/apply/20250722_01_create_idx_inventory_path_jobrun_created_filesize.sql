CREATE INDEX IF NOT EXISTS idx_inventory_path_jobrun_created_filesize
    ON datamigrator.inventory (path, job_run_id, created_at DESC)
    INCLUDE (file_size);