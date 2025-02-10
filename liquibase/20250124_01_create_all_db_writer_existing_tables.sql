
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS inventory (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	"path" text NOT NULL,
	volume_id uuid NULL,
	is_directory bool NOT NULL,
	source_checksum text NULL,
	target_checksum text NULL,
	parent_path varchar NOT NULL,
	"depth" int4 NOT NULL,
	file_name text NOT NULL,
	uid text NOT NULL,
	gid text NOT NULL,
	file_size int8 NOT NULL,
	file_type text NOT NULL,
	modified_time timestamp NOT NULL,
	access_time timestamp NOT NULL,
	file_permission varchar NOT NULL,
	job_run_id uuid NOT NULL,
	birth_time timestamp NULL,
	CONSTRAINT "PK_82aa5da437c5bbfb80703b08309" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_file_server_path_id ON inventory USING btree (volume_id);
CREATE INDEX IF NOT EXISTS idx_id ON inventory USING btree (id);
CREATE INDEX IF NOT EXISTS idx_inventory_job_run_id ON inventory USING btree (job_run_id);
CREATE INDEX IF NOT EXISTS idx_path ON inventory USING btree (path);
