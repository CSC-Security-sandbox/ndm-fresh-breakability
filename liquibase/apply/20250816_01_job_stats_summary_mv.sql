CREATE MATERIALIZED VIEW IF NOT EXISTS job_stats_summary_mv AS
WITH job_runs as (
	select id from jobrun
),
inventory_stats AS (
    SELECT 
        job_run_id,
        COUNT(*) FILTER (WHERE NOT is_directory) AS file_count,
        COUNT(*) FILTER (WHERE is_directory) AS directory_count,
        COALESCE(SUM(file_size) FILTER (WHERE NOT is_directory), 0) AS total_size,
        COUNT(*) AS total_items,
        MAX(created_at) AS last_inventory_update
    FROM inventory 
    GROUP BY job_run_id
),
task_stats AS (
    SELECT 
        job_run_id,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS task_completed,
        COUNT(*) FILTER (WHERE status = 'PENDING') AS task_pending,
        COUNT(*) FILTER (WHERE status = 'ERRORED') AS task_errored,
        COUNT(*) FILTER (WHERE status = 'RUNNING') AS task_running,
        COUNT(*) FILTER (WHERE status = 'COMPLETED_WITH_ERROR') AS completed_with_error,
        COUNT(*) AS total_tasks,
        MAX(updated_at) AS last_task_update
    FROM tasks 
    GROUP BY job_run_id
)
SELECT 
   COALESCE(j.id,i.job_run_id, t.job_run_id) AS job_run_id,
    
    -- Inventory statistics
    COALESCE(i.file_count, 0) AS file_count,
    COALESCE(i.directory_count, 0) AS directory_count,
    COALESCE(i.total_size, 0) AS total_size,
    COALESCE(i.total_items, 0) AS total_items,
    i.last_inventory_update,
    
    -- Task status counts (all possible statuses from your enum)
    COALESCE(t.task_completed, 0) AS task_completed,
    COALESCE(t.task_pending, 0) AS task_pending,
    COALESCE(t.task_errored, 0) AS task_errored,
    COALESCE(t.task_running, 0) AS task_running,
    COALESCE(t.completed_with_error, 0) AS completed_with_error,
    COALESCE(t.total_tasks, 0) AS total_tasks,
    t.last_task_update,
    
    -- Metadata
    GREATEST(
        COALESCE(i.last_inventory_update, '1970-01-01'::timestamp),
        COALESCE(t.last_task_update, '1970-01-01'::timestamp)
    ) AS last_data_update,
    NOW() AS last_refreshed
FROM job_runs j  LEFT JOIN inventory_stats i
on j.id = i.job_run_id
LEFT JOIN  task_stats t ON j.id = t.job_run_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_stats_summary_mv_job_run_id 
ON job_stats_summary_mv (job_run_id);