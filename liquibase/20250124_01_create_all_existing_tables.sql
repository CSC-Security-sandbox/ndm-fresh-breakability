CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS reports (
	id uuid DEFAULT uuid_generate_v4() NOT NULL,
	report_data text NULL,
	created_at time DEFAULT now() NULL,
	report_type text NULL,
	job_run_id uuid NULL,
	CONSTRAINT reports_pkey PRIMARY KEY (id)
);