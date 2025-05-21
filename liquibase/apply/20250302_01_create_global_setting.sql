CREATE TABLE IF NOT EXISTS global_settings (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    setting_key VARCHAR(255) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT DEFAULT NULL,
  	setting_type TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by uuid NULL,
    updated_by uuid NULL,
    CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2en" PRIMARY KEY (id)
);