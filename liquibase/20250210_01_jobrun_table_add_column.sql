
ALTER TABLE jobrun ADD COLUMN IF NOT EXISTS meta_config json;
ALTER TABLE jobrun ADD COLUMN IF NOT EXISTS workflow_id text;
