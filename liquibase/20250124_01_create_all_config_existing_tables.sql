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
	CONSTRAINT "PK_d0ee79a681413d50b0a4f98cf7b" PRIMARY KEY (id),
	CONSTRAINT "FK_8c83350735693ce1b8eabf935a3" FOREIGN KEY (project_id) REFERENCES project(id)
);

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
	protocol_version varchar NULL,
	CONSTRAINT "PK_533d54ec32cba35b21c5a2092fc" PRIMARY KEY (id),
	CONSTRAINT "FK_e041c087a720332bc6ef0b83eb3" FOREIGN KEY (config_id) REFERENCES config(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worker (
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
	CONSTRAINT "PK_dc8175fa0e34ce7a39e4ec73b94" PRIMARY KEY (id),
	CONSTRAINT "FK_787ef3391e00fbbd3c127e0f3a2" FOREIGN KEY (project_id) REFERENCES project(id)
);

CREATE TABLE IF NOT EXISTS file_server_worker (
	file_server_id uuid NOT NULL,
	worker_id uuid NOT NULL,
	CONSTRAINT "PK_718ecaa44104452bec9b0f4604d" PRIMARY KEY (file_server_id, worker_id),
	CONSTRAINT "FK_000b409f7a5fe4210cf89b958d5" FOREIGN KEY (file_server_id) REFERENCES file_server(id) ON DELETE CASCADE ON UPDATE CASCADE,
	CONSTRAINT "FK_25cbd3119a71ce7db80d60e9039" FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "IDX_000b409f7a5fe4210cf89b958d" ON file_server_worker USING btree (file_server_id);
CREATE INDEX "IDX_25cbd3119a71ce7db80d60e903" ON file_server_worker USING btree (worker_id);

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
	CONSTRAINT fileserver_workingdirectory_mapping_pkey PRIMARY KEY (id),
	CONSTRAINT fk_config FOREIGN KEY (config_id) REFERENCES config(id) ON DELETE CASCADE
);