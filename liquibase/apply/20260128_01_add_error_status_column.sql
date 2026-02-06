-- Add error_status column to operation_errors table
ALTER TABLE operation_errors 
ADD COLUMN IF NOT EXISTS error_status VARCHAR(20) DEFAULT 'UNRESOLVED' NOT NULL;
