CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS job_config_inventory_stats (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    job_config_id uuid NOT NULL,
    file_count bigint NOT NULL DEFAULT 0,
    dir_count bigint NOT NULL DEFAULT 0,
    total_size bigint NOT NULL DEFAULT 0,
    last_updated_at timestamp DEFAULT now() NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    created_by uuid NULL,
    updated_at timestamp DEFAULT now() NULL,
    updated_by uuid NULL,
    CONSTRAINT fk_job_config_inventory_stats_job_config FOREIGN KEY (job_config_id) REFERENCES jobconfig(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_config_inventory_stats_unique_job_config ON job_config_inventory_stats(job_config_id);
