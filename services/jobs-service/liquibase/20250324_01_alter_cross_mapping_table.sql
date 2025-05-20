ALTER TABLE identity_config_cross_mapping
ADD COLUMN is_orphan BOOLEAN DEFAULT FALSE NOT NULL;