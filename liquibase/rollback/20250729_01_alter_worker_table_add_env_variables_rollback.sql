-- Rollback: Drop env_variables column from worker table
ALTER TABLE worker DROP COLUMN IF EXISTS env_variables;
