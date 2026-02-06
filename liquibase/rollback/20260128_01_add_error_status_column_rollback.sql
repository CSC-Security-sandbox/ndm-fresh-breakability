-- Rollback: Remove error_status column from operation_errors table
ALTER TABLE operation_errors 
DROP COLUMN IF EXISTS error_status;
