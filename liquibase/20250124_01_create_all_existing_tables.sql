CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS config (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	config_name text NULL,
	config_type text NULL,
	project_id uuid NOT NULL,
	scanned_date timestamp NULL,
	working_directory text NULL,
	status varchar NULL,
	CONSTRAINT "PK_d0ee79a681413d50b0a4f98cf7b" PRIMARY KEY (id)
);

ALTER TABLE config ADD CONSTRAINT "FK_8c83350735693ce1b8eabf935a3" FOREIGN KEY (project_id) REFERENCES project(id);

CREATE TABLE IF NOT EXISTS fileserver_workingdirectory_mapping (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	path_name text NULL,
	working_directory text NULL,
	path_id uuid NULL,
	config_id uuid NULL,
	created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	created_by uuid NULL,
	updated_by uuid NULL,
	CONSTRAINT fileserver_workingdirectory_mapping_pkey PRIMARY KEY (id)
);

ALTER TABLE fileserver_workingdirectory_mapping ADD CONSTRAINT fk_config FOREIGN KEY (config_id) REFERENCES config(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS file_server (
	created_at timestamp DEFAULT now() NOT NULL,
	updated_at timestamp DEFAULT now() NULL,
	created_by varchar NULL,
	updated_by varchar NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	hostname text NULL,
	username text NULL,
	protocol varchar NULL,
	server_type varchar NOT NULL,
	"password" text NULL,
	config_id uuid NULL,
	is_refreshed bool NULL,
	protocol_version varchar NOT NULL,
	CONSTRAINT "PK_533d54ec32cba35b21c5a2092fc" PRIMARY KEY (id)
);

ALTER TABLE file_server ADD CONSTRAINT "FK_e041c087a720332bc6ef0b83eb3" FOREIGN KEY (config_id) REFERENCES config(id) ON DELETE CASCADE;
