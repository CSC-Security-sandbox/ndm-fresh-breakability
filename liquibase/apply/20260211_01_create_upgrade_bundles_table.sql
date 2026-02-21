CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create upgrade_bundles table
-- Valid upload_status values: 'uploading', 'processing', 'success', 'failed', 'cancelled'
-- Valid upgrade_status values: 'pending', 'in_progress', 'success', 'failed', 'skipped'
CREATE TABLE IF NOT EXISTS upgrade_bundles (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    file_name varchar(255) NOT NULL,
    file_size bigint NOT NULL,
    version varchar(50) NULL,
    upload_status varchar(20) NOT NULL,
    upload_started_at timestamp NULL,
    upload_completed_at timestamp NULL,
    processing_started_at timestamp NULL,
    upgrade_status varchar(20) DEFAULT 'pending' NOT NULL,
    upgrade_completed_at timestamp NULL,
    uploaded_by uuid NULL,
    upgraded_by uuid NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    created_by uuid NULL,
    updated_at timestamp DEFAULT now() NULL,
    updated_by uuid NULL
);
