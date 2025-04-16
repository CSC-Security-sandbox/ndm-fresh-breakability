CREATE TABLE IF NOT EXISTS sync_email (
    id SERIAL PRIMARY KEY,
    sender VARCHAR(255) NOT NULL,
    receiver VARCHAR[] NOT NULL,
    mail_content TEXT NOT NULL,
    sync BOOLEAN NOT NULL DEFAULT FALSE,
    created_at timestamp DEFAULT now() NOT NULL,
	created_by uuid NULL,
	updated_at timestamp DEFAULT now() NOT NULL,
	updated_by uuid NULL
    project_id UUID,
    FOREIGN KEY (project_id) REFERENCES project(id) 
);