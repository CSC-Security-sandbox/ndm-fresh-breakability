CREATE TYPE incident_status AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE IF NOT EXISTS sync_email (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    mail_content JSONB NOT NULL,
    incident_status incident_status NOT NULL,
    description TEXT,
    summary TEXT,
    alertsource TEXT,
    alertname TEXT,
    created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL
);