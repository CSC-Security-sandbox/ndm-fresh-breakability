CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum type for upload status
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upload_status_enum') THEN
        CREATE TYPE upload_status_enum AS ENUM ('pending', 'uploading', 'success', 'failed', 'cancelled');
    END IF;
END$$;

-- Create upgrade_bundles table
CREATE TABLE IF NOT EXISTS upgrade_bundles (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    file_name varchar(255) NOT NULL,
    file_path varchar(500) NULL,
    file_size bigint NOT NULL,
    version varchar(50) NULL,
    upload_status upload_status_enum DEFAULT 'pending' NOT NULL,
    upload_started_at timestamp NULL,
    upload_completed_at timestamp NULL,
    upgrade_success boolean DEFAULT false NOT NULL,
    upgrade_completed_at timestamp NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    created_by uuid NULL,
    updated_at timestamp DEFAULT now() NULL,
    updated_by uuid NULL
);

-- Create index for faster lookup of latest record
CREATE INDEX IF NOT EXISTS idx_upgrade_bundles_created_at ON upgrade_bundles(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE upgrade_bundles IS 'Stores upgrade bundle upload history and status';
COMMENT ON COLUMN upgrade_bundles.file_name IS 'Original filename of the uploaded bundle';
COMMENT ON COLUMN upgrade_bundles.file_path IS 'Path where the bundle is stored on VM';
COMMENT ON COLUMN upgrade_bundles.version IS 'Version extracted from filename';
COMMENT ON COLUMN upgrade_bundles.upload_status IS 'Current status of the upload process';
COMMENT ON COLUMN upgrade_bundles.upgrade_success IS 'Whether the upgrade was successfully applied';