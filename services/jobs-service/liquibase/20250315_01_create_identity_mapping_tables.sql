CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS identity_mapping (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY, 
    identity_type VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT now() NOT NULL,
    updated_at TIMESTAMP DEFAULT now() NULL,
    created_by VARCHAR(255) NULL,
    updated_by VARCHAR(255) NULL,
    identity_map VARCHAR(255) NULL,
    source_mapping TEXT NOT NULL,
    target_mapping TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_config_cross_mapping (
    created_at TIMESTAMP DEFAULT now() NOT NULL,
    updated_at TIMESTAMP DEFAULT now() NULL,
    created_by VARCHAR(255) NULL,
    updated_by VARCHAR(255) NULL,
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    identity_mapping_id UUID NOT NULL,  
    job_config_id UUID NOT NULL,      
    FOREIGN KEY (job_config_id) REFERENCES jobconfig(id) ON DELETE CASCADE
);