CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS ingest_jobrun_config (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    job_run_id uuid NOT NULL,
    task_queue varchar(255) NOT NULL,
    CONSTRAINT fk_ingest_jobrun_config_jobrun FOREIGN KEY (job_run_id) REFERENCES jobrun(id) ON DELETE CASCADE,
    CONSTRAINT uq_ingest_jobrun_config_job_run_id UNIQUE (job_run_id)
);
