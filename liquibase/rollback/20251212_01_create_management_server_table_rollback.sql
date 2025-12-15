-- Drop index on file_server table
DROP INDEX IF EXISTS datamigrator.idx_file_server_management_server_id;

-- Drop foreign key constraint from file_server table
ALTER TABLE datamigrator.file_server
DROP CONSTRAINT IF EXISTS fk_file_server_management_server;

-- Drop column from file_server table
ALTER TABLE datamigrator.file_server
DROP COLUMN IF EXISTS management_server_id;

-- Drop indexes on management_server table
DROP INDEX IF EXISTS idx_management_server_updated_by;
DROP INDEX IF EXISTS idx_management_server_created_by;
DROP INDEX IF EXISTS idx_management_server_project_id;

-- Drop management_server table
DROP TABLE IF EXISTS management_server;

-- Note: uuid-ossp extension is not dropped as it may be used by other tables
