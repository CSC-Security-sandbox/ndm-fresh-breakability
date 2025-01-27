CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS migrateadmin;

CREATE TABLE IF NOT EXISTS migrateadmin.jobconfig (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	job_type varchar NOT NULL,
	status varchar NOT NULL,
	exclude_older_than timestamp NULL,
	exclude_file_patterns text NULL,
	preserve_access_time bool DEFAULT false NOT NULL,
	first_run_at timestamptz NULL,
	future_schedule_at text NULL,
	source_path_id uuid NOT NULL,
	target_path_id uuid NULL,
	scheduler varchar NULL,
	CONSTRAINT "PK_ac392abad1e1801da9a4cf027d6" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS migrateadmin.jobidmapping (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	file_server_id uuid NOT NULL,
	"type" varchar NOT NULL,
	source_id varchar NOT NULL,
	destination_id varchar NOT NULL,
	CONSTRAINT "PK_49659c592bf37c883fca075529c" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS migrateadmin.job_options (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	exclude_older_than timestamp NULL,
	exclude_file_patterns text NULL,
	preserve_access_time bool DEFAULT false NOT NULL,
	job_run_id uuid NULL,
	source_working_dir text NULL,
	target_working_dir text NULL,
	CONSTRAINT "PK_7562d7f315d7854dc97552a0da0" PRIMARY KEY (id),
	CONSTRAINT "REL_5b29fd4de00a0a910f667243c7" UNIQUE (job_run_id)
);

CREATE TABLE IF NOT EXISTS migrateadmin.jobrun (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	status varchar NOT NULL,
	start_time timestamp NOT NULL,
	end_time timestamp NULL,
	iteration_number int4 NOT NULL,
	job_config_id uuid NOT NULL,
	job_options_id uuid NULL,
	CONSTRAINT "PK_39c91b190948f08d1d392f404e6" PRIMARY KEY (id)
);

ALTER TABLE migrateadmin.jobrun ADD CONSTRAINT "FK_90c86a3ffe6d7381cdc8dcab5b1" FOREIGN KEY (job_config_id) REFERENCES migrateadmin.jobconfig(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS migrateadmin.operations (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	task_id uuid NULL,
	job_run_id uuid NULL,
	status varchar NOT NULL,
	operation_type varchar NOT NULL,
	request jsonb NOT NULL,
	error_details text NULL,
	f_path text NOT NULL,
	retry_count int4 NULL,
	source_path_id uuid NULL,
	target_path_id uuid NULL,
	CONSTRAINT "PK_7b62d84d6f9912b975987165856" PRIMARY KEY (id)
);
CREATE INDEX idx_file_path_task ON migrateadmin.operations USING btree (f_path, task_id);
CREATE INDEX idx_operation_run_status ON migrateadmin.operations USING btree (job_run_id, status);
CREATE INDEX idx_operation_type ON migrateadmin.operations USING btree (operation_type);

ALTER TABLE migrateadmin.operations ADD CONSTRAINT "FK_7d416e8bb958cabd9256e9a8e5e" FOREIGN KEY (task_id) REFERENCES migrateadmin.tasks(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS migrateadmin.request_track (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	task_type text NOT NULL,
	response text NULL,
	status text NOT NULL,
	operation varchar NOT NULL,
	worker_id uuid NOT NULL,
	transaction_id uuid NOT NULL,
	config_id uuid NULL,
	CONSTRAINT "PK_4c631e80b0eba97b1af5cba5655" PRIMARY KEY (id)
);

ALTER TABLE migrateadmin.request_track ADD CONSTRAINT "FK_8363d1ef7f84cc88ec34d6dfec7" FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker(id);

CREATE TABLE IF NOT EXISTS migrateadmin.tasks (
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	job_run_id uuid NOT NULL,
	status varchar NOT NULL,
	task_type varchar NULL,
	worker_id uuid NULL,
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY (id)
);
CREATE INDEX idx_job_run_id ON migrateadmin.tasks USING btree (job_run_id);
CREATE INDEX idx_job_run_status ON migrateadmin.tasks USING btree (job_run_id, status);
CREATE INDEX idx_task_type ON migrateadmin.tasks USING btree (task_type);

ALTER TABLE migrateadmin.tasks ADD CONSTRAINT "FK_e1d40541e2ee780839fb3f95c4a" FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS migrateadmin.volume (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	volume_path text NULL,
	reachable_count int4 NULL,
	file_server_id uuid NULL,
	is_discovery_done bool DEFAULT false NULL,
	is_baseline_migration_done bool DEFAULT false NULL,
	CONSTRAINT "PK_666025cd0c36727216bb7f2a680" PRIMARY KEY (id)
);

ALTER TABLE migrateadmin.volume ADD CONSTRAINT "FK_556b3e916c55734c6f7424c9280" FOREIGN KEY (file_server_id) REFERENCES migrateadmin.file_server(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS migrateadmin.worker (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid NOT NULL,
	project_id uuid NOT NULL,
	client_id varchar(255) NOT NULL,
	worker_name varchar(255) NOT NULL,
	ip_address varchar(255) NOT NULL,
	status varchar NOT NULL,
	CONSTRAINT "PK_dc8175fa0e34ce7a39e4ec73b94" PRIMARY KEY (id)
);

ALTER TABLE migrateadmin.worker ADD CONSTRAINT "FK_787ef3391e00fbbd3c127e0f3a2" FOREIGN KEY (project_id) REFERENCES migrateadmin.project(id);

CREATE TABLE IF NOT EXISTS migrateadmin.worker_jobrun_mapping (
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	status bool DEFAULT false NOT NULL,
	worker_id uuid NOT NULL,
	job_run_id uuid NOT NULL,
	is_path_mounted bool NULL,
	CONSTRAINT "PK_98b8d5dc06ff2e1e408f3020be2" PRIMARY KEY (id)
);

ALTER TABLE migrateadmin.worker_jobrun_mapping ADD CONSTRAINT "FK_06c32b99d7b638ac00e416bd3fa" FOREIGN KEY (worker_id) REFERENCES migrateadmin.worker(id) ON DELETE CASCADE;
ALTER TABLE migrateadmin.worker_jobrun_mapping ADD CONSTRAINT "FK_0e30585297eabf24ea031fb784f" FOREIGN KEY (job_run_id) REFERENCES migrateadmin.jobrun(id) ON DELETE CASCADE;

