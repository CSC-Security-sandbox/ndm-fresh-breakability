-- Extend job_stats_summary_mv: filter normal inventory by entry_type, add deleted/excluded/skipped counts
DROP MATERIALIZED VIEW IF EXISTS job_stats_summary_mv CASCADE;

CREATE MATERIALIZED VIEW job_stats_summary_mv AS
WITH job_runs AS (
  SELECT id, status FROM jobrun
),
inventory_stats AS (
  SELECT
    job_run_id,
    COUNT(*) FILTER (WHERE (entry_type IS NULL OR entry_type = 'inventory') AND NOT is_directory AND NOT COALESCE(is_deleted, false)) AS file_count,
    COUNT(*) FILTER (WHERE (entry_type IS NULL OR entry_type = 'inventory') AND is_directory AND NOT COALESCE(is_deleted, false)) AS directory_count,
    COALESCE(SUM(file_size) FILTER (WHERE (entry_type IS NULL OR entry_type = 'inventory') AND NOT is_directory AND NOT COALESCE(is_deleted, false)), 0) AS total_size,
    COUNT(*) FILTER (WHERE (entry_type IS NULL OR entry_type = 'inventory')) AS total_items,
    COUNT(*) FILTER (WHERE COALESCE(is_deleted, false) AND NOT COALESCE(is_directory, false)) AS deleted_count,
    COUNT(*) FILTER (WHERE entry_type = 'excluded') AS excluded_count,
    COUNT(*) FILTER (WHERE entry_type = 'skipped') AS skipped_count,
    COUNT(*) FILTER (WHERE entry_type = 'excluded' AND NOT is_directory) AS excluded_file_count,
    COUNT(*) FILTER (WHERE entry_type = 'skipped' AND NOT is_directory) AS skipped_file_count,
    COUNT(*) FILTER (WHERE (entry_type IS NULL OR entry_type = 'inventory') AND update_type = 'new' AND NOT is_directory AND NOT COALESCE(is_deleted, false)) AS newly_copied_count,
    COUNT(*) FILTER (
      WHERE (entry_type IS NULL OR entry_type = 'inventory')
        AND update_type IN ('content_updated', 'metadata_updated')
        AND NOT is_directory
        AND NOT COALESCE(is_deleted, false)
    ) AS recopied_count,
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
  COALESCE(j.id, i.job_run_id, t.job_run_id) AS job_run_id,
  COALESCE(j.status, 'UNKNOWN') AS job_run_status,
  COALESCE(i.file_count, 0) AS file_count,
  COALESCE(i.directory_count, 0) AS directory_count,
  COALESCE(i.total_size, 0) AS total_size,
  COALESCE(i.total_items, 0) AS total_items,
  COALESCE(i.deleted_count, 0) AS deleted_count,
  COALESCE(i.excluded_count, 0) AS excluded_count,
  COALESCE(i.skipped_count, 0) AS skipped_count,
  COALESCE(i.newly_copied_count, 0) AS newly_copied_count,
  COALESCE(i.recopied_count, 0) AS recopied_count,
  i.last_inventory_update,
  COALESCE(t.task_completed, 0) AS task_completed,
  COALESCE(t.task_pending, 0) AS task_pending,
  COALESCE(t.task_errored, 0) AS task_errored,
  COALESCE(t.task_running, 0) AS task_running,
  COALESCE(t.completed_with_error, 0) AS completed_with_error,
  COALESCE(t.total_tasks, 0) AS total_tasks,
  t.last_task_update,
  GREATEST(
    COALESCE(i.last_inventory_update, '1970-01-01'::timestamp),
    COALESCE(t.last_task_update, '1970-01-01'::timestamp)
  ) AS last_data_update,
  NOW() AS last_refreshed
FROM job_runs j
LEFT JOIN inventory_stats i ON j.id = i.job_run_id
LEFT JOIN task_stats t ON j.id = t.job_run_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_stats_summary_mv_job_run_id ON job_stats_summary_mv (job_run_id);
