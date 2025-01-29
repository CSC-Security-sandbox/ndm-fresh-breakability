CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS account (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	account_name varchar(255) NOT NULL,
	CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "permission" (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	permission_name varchar(255) NOT NULL,
	permission_status varchar(255) NOT NULL,
	CONSTRAINT "PK_3b8b97af9d9d8807e41e6f48362" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS project (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	project_name varchar(255) NOT NULL,
	project_description text NULL,
	start_date date NULL,
	account_id uuid NULL,
	CONSTRAINT "PK_4d68b1358bb5b766d3e78f32f57" PRIMARY KEY (id)
);

ALTER TABLE project ADD CONSTRAINT "FK_76eea9da615605bb68d1ffc995c" FOREIGN KEY (account_id) REFERENCES account(id);

CREATE TABLE IF NOT EXISTS role_permission (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	role_id uuid NOT NULL,
	permission_id uuid NOT NULL,
	CONSTRAINT "PK_96c8f1fd25538d3692024115b47" PRIMARY KEY (id)
);

ALTER TABLE role_permission ADD CONSTRAINT "FK_3d0a7155eafd75ddba5a7013368" FOREIGN KEY (role_id) REFERENCES "role"(id);
ALTER TABLE role_permission ADD CONSTRAINT "FK_e3a3ba47b7ca00fd23be4ebd6cf" FOREIGN KEY (permission_id) REFERENCES "permission"(id);

CREATE TABLE IF NOT EXISTS "role" (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	role_name varchar(255) NOT NULL,
	role_status varchar(255) NOT NULL,
	CONSTRAINT "PK_b36bcfe02fc8de3c57a8b2391c2" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS user_role (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	user_id uuid NOT NULL,
	role_id uuid NOT NULL,
	project_id uuid NULL,
	account_id uuid NOT NULL,
	CONSTRAINT "PK_fb2e442d14add3cefbdf33c4561" PRIMARY KEY (id)
);

ALTER TABLE user_role ADD CONSTRAINT "FK_32a6fc2fcb019d8e3a8ace0f55f" FOREIGN KEY (role_id) REFERENCES "role"(id);
ALTER TABLE user_role ADD CONSTRAINT "FK_7b6db8740e8e0e2916ac5c7d089" FOREIGN KEY (account_id) REFERENCES account(id);
ALTER TABLE user_role ADD CONSTRAINT "FK_8541d9c873a5883eca10c3822e4" FOREIGN KEY (project_id) REFERENCES project(id);
ALTER TABLE user_role ADD CONSTRAINT "FK_d0e5815877f7395a198a4cb0a46" FOREIGN KEY (user_id) REFERENCES "user"(id);

CREATE TABLE IF NOT EXISTS "user" (
	created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL,
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	email varchar(255) NOT NULL,
	user_status varchar(255) NOT NULL,
	first_name varchar(255) NULL,
	last_name varchar(255) NULL,
	CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id)
);
