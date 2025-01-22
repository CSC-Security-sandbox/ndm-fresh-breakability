CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE migrateadmin.inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    path TEXT NOT NULL,
    is_directory BOOLEAN NOT NULL,
    source_checksum TEXT,
    target_checksum TEXT,
    parent_path TEXT NOT NULL,
    depth INT NOT NULL,
    file_name TEXT NOT NULL,
    uid TEXT NOT NULL,
    gid TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    extension TEXT NOT NULL,
    file_type TEXT NOT NULL,
    modified_time TIMESTAMP NOT NULL,
    access_time TIMESTAMP NOT NULL,
    file_permission TEXT NOT NULL,
    volume_id UUID NOT NULL,
    birth_time TIMESTAMP NOT NULL,
    job_run_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NULL,
    CONSTRAINT idx_id UNIQUE (id),
    CONSTRAINT idx_path UNIQUE (path),
    CONSTRAINT idx_file_server_path_id UNIQUE (volume_id),
    CONSTRAINT idx_inventory_job_run_id UNIQUE (job_run_id)
);
