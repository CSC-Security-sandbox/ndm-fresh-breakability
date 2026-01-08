CREATE MATERIALIZED VIEW IF NOT EXISTS destination_files_n_dir_count_mv AS
WITH destination_inventory AS (
    -- Get all destination files and directories for all job runs per job config
    SELECT DISTINCT
        jc.id AS job_config_id,
        i.path,
        i.is_directory,
        i.job_run_id,
        i.file_size
    FROM jobconfig jc
    INNER JOIN jobrun jr ON jc.id = jr.job_config_id
    INNER JOIN inventory i ON jr.id = i.job_run_id
    WHERE i.target_checksum IS NOT NULL
      AND (i.is_deleted = false OR i.is_deleted IS NULL)
),
destination_files_count AS (
    -- Count distinct files and directories per job config
    SELECT 
        job_config_id,
        COUNT(DISTINCT CASE WHEN NOT is_directory THEN path END) AS total_destination_files,
        COUNT(DISTINCT CASE WHEN is_directory THEN path END) AS total_destination_directories,
        COUNT(DISTINCT path) AS total_destination_items,
        COUNT(DISTINCT job_run_id) AS job_run_count,
        COALESCE(SUM(file_size) FILTER (WHERE NOT is_directory), 0) AS total_destination_size
    FROM destination_inventory
    GROUP BY job_config_id
)
SELECT 
    job_config_id,
    COALESCE(total_destination_files, 0) AS total_destination_files,
    COALESCE(total_destination_directories, 0) AS total_destination_directories,
    COALESCE(total_destination_items, 0) AS total_destination_items,
    COALESCE(job_run_count, 0) AS job_run_count,
    COALESCE(total_destination_size, 0) AS total_destination_size,
    NOW() AS last_refreshed
FROM destination_files_count;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_destination_files_n_dir_count_mv_job_config_id 
ON destination_files_n_dir_count_mv (job_config_id);
