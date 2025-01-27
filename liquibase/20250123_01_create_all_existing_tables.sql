CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE "protocol" AS ENUM ('NFS', 'SMB');
CREATE TYPE "server_type" AS ENUM ('OtherNAS', 'dell', 'emc');
CREATE TYPE "job_status" AS ENUM ('ACTIVE', 'IN_ACTIVE');
CREATE TYPE "job_type" AS ENUM ('SCAN', 'MIGRATE', 'CUT_OVER', 'SPEED_TEST');
CREATE TYPE "job_id_mapping_type" AS ENUM ('GID', 'UID', 'SID');
CREATE TYPE "job_run_status" AS ENUM ('READY', 'PENDING', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED', 'ERRORED');
CREATE TYPE "operations_status" AS ENUM ('READY', 'IN_PROCESS', 'ERROR', 'COMPLETED');
CREATE TYPE "operation_type" AS ENUM ('READY', 'IN_PROCESS', 'ERROR', 'COMPLETED');
CREATE TYPE "request_task_type" AS ENUM ('VALIDATE_CONNECTION', 'LIST_PATHS');
CREATE TYPE "response_status" AS ENUM ('PENDING', 'COMPLETED', 'ERROR');
CREATE TYPE "operations" AS ENUM ('VALIDATE_NFS_CONNECTION', 'VALIDATE_SMB_CONNECTION', 'LIST_NFS_PATHS', 'LIST_SMB_PATHS');
CREATE TYPE "task_status" AS ENUM ('PENDING', 'RUNNING', 'ERRORED', 'COMPLETED');
CREATE TYPE "task_type" AS ENUM ('SCAN', 'MIGRATE', 'COPY');
CREATE TYPE "worker_status" AS ENUM ('Online', 'Offline');


CREATE TABLE migrateadmin.config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_name TEXT NULL,
    config_type TEXT NULL,
    project_id UUID NOT NULL,
    scanned_date TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL
);

CREATE TABLE migrateadmin.file_server (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname TEXT NULL,
    username TEXT NULL,
    protocol "protocol" NOT NULL,
    server_type "server_type" NOT NULL,
    password TEXT NULL,
    config_id UUID NULL,
    is_refreshed BOOLEAN NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL,
    CONSTRAINT fk_config FOREIGN KEY (config_id) REFERENCES migrateadmin.config(id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    path TEXT NOT NULL,
    is_directory BOOLEAN,
    source_checksum TEXT NULL,
    target_checksum TEXT NULL,
    parent_path TEXT,
    depth INT,
    file_name TEXT,
    uid TEXT,
    gid TEXT,
    file_size BIGINT,
    file_type TEXT,
    modified_time TIMESTAMP,
    access_time TIMESTAMP,
    file_permission TEXT,
    volume_id UUID,
    job_run_id UUID,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL,
    CONSTRAINT fk_job_run FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun(id) ON DELETE CASCADE,
    CONSTRAINT fk_volume FOREIGN KEY (volume_id) REFERENCES migrateadmin.volume(id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.jobconfig (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type "job_type" NOT NULL,
    status "job_status" NOT NULL,
    exclude_older_than TIMESTAMP NULL,
    exclude_file_patterns TEXT NULL,
    preserve_access_time BOOLEAN DEFAULT FALSE,
    first_run_at TIMESTAMP WITH TIME ZONE NULL,
    future_schedule_at TEXT NULL,
    source_path_id UUID NOT NULL,
    target_path_id UUID NULL,
    scheduler VARCHAR NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL,
    CONSTRAINT fk_source_path FOREIGN KEY (source_path_id) REFERENCES migrateadmin.volume(id) ON DELETE CASCADE,
    CONSTRAINT fk_target_path FOREIGN KEY (target_path_id) REFERENCES migrateadmin.volume(id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.jobidmapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_server_id UUID NOT NULL,
    type "job_id_mapping_type" NOT NULL,
    source_id TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL
);

CREATE TABLE migrateadmin.job_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exclude_older_than TIMESTAMP NULL,
    exclude_file_patterns TEXT NULL,
    preserve_access_time BOOLEAN DEFAULT FALSE,
    source_working_dir TEXT NULL,
    target_working_dir TEXT NULL,
    job_run_id UUID NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL,
    CONSTRAINT fk_job_run FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun(id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.jobrun (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status "job_run_status" NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NULL,
    iteration_number INT NOT NULL,
    job_config_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP NULL,
    created_by TEXT NULL,
    updated_by TEXT NULL,
    CONSTRAINT fk_job_config FOREIGN KEY (job_config_id) REFERENCES migrateadmin.jobconfig(id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.file_server_worker (
    file_server_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    CONSTRAINT fk_file_server FOREIGN KEY (file_server_id) REFERENCES migrateadmin.file_server(id),
    CONSTRAINT fk_worker FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker(id),
    PRIMARY KEY (file_server_id, worker_id)
);

CREATE TABLE migrateadmin.worker_job_run_map (
    job_run_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    CONSTRAINT fk_job_run FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun(id),
    CONSTRAINT fk_worker FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker(id),
    PRIMARY KEY (job_run_id, worker_id)
);

CREATE TABLE migrateadmin.operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID,
    job_run_id UUID,
    source_path_id UUID,
    target_path_id UUID,
    status "operations_status" NOT NULL,
    operation_type "operation_type" NOT NULL,
    request JSONB NOT NULL,
    error_details TEXT,
    f_path TEXT NOT NULL,
    retry_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task FOREIGN KEY (task_id) REFERENCES migrateadmin.tasks (id) ON DELETE CASCADE
);

CREATE INDEX idx_operation_run_status ON migrateadmin.operations (job_run_id, status);
CREATE INDEX idx_file_path_task ON migrateadmin.operations (f_path, task_id);
CREATE INDEX idx_operation_type ON migrateadmin.operations (operation_type);

CREATE TABLE migrateadmin.project (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name TEXT,
    start_date DATE,
    project_description TEXT,
    account_id UUID
);

CREATE TABLE migrateadmin.request_track (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_type "request_task_type" NOT NULL,
    response TEXT,
    status "response_status" NOT NULL,
    operation "operations" NOT NULL,
    worker_id TEXT NOT NULL,
    transaction_id UUID NOT NULL,
    config_id UUID,
    CONSTRAINT fk_worker FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker (id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_run_id UUID NOT NULL,
    status "task_status",
    task_type "task_type",
    worker_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_job_run FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun (id) ON DELETE CASCADE,
    CONSTRAINT fk_worker FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker (id) ON DELETE CASCADE
);

CREATE INDEX idx_job_run_id ON migrateadmin.tasks (job_run_id);
CREATE INDEX idx_job_run_status ON migrateadmin.tasks (job_run_id, status);
CREATE INDEX idx_task_type ON migrateadmin.tasks (task_type);

CREATE TABLE migrateadmin.volume (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    volume_path TEXT,
    reachable_count INT,
    file_server_id UUID,
    is_discovery_done BOOLEAN DEFAULT FALSE,
    is_baseline_migration_done BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_file_server FOREIGN KEY (file_server_id) REFERENCES migrateadmin.fileserver (id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.worker (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    worker_name VARCHAR(255) NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    status "worker_status",
    CONSTRAINT fk_project FOREIGN KEY (project_id) REFERENCES migrateadmin.project (id) ON DELETE CASCADE
);

CREATE TABLE migrateadmin.worker_jobrun_mapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status BOOLEAN DEFAULT FALSE,
    worker_id UUID NOT NULL,
    job_run_id UUID NOT NULL,
    is_path_mounted BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_worker FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker (id) ON DELETE CASCADE,
    CONSTRAINT fk_job_run FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun (id) ON DELETE CASCADE
);
