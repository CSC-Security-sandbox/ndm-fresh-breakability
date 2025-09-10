CREATE INDEX CONCURRENTLY idx_inventory_job_run_id_directory_size
ON inventory (job_run_id, is_directory, file_size)
WHERE job_run_id IS NOT NULL;