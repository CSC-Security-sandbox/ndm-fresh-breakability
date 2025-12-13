CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS management_server (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    hostname varchar(255) NOT NULL,
    port integer NULL,
    server_type varchar NOT NULL,
    username varchar(255),
    password varchar(255),
    project_id uuid NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    created_by uuid NULL,
    updated_at timestamp DEFAULT now() NOT NULL,
    updated_by uuid NULL,
    tls_accepted boolean DEFAULT false,
    tls_ca_certificate text,
    CONSTRAINT unique_name_per_project UNIQUE (name, project_id)
);

CREATE INDEX idx_management_server_project_id ON management_server(project_id);
CREATE INDEX idx_management_server_created_by ON management_server(created_by);
CREATE INDEX idx_management_server_updated_by ON management_server(updated_by);

