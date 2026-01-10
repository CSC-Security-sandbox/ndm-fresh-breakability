-- Rollback: Drop job_config_inventory_stats table
DROP INDEX IF EXISTS idx_job_config_inventory_stats_unique_job_config;
DROP TABLE IF EXISTS job_config_inventory_stats;
