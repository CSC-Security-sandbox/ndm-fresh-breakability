-- Create enum type for upgrade status
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upgrade_status_enum') THEN
        CREATE TYPE upgrade_status_enum AS ENUM ('pending', 'staged', 'in_progress', 'success', 'failed', 'rolled_back');
    END IF;
END$$;

-- Add upgrade orchestration columns to upgrade_bundles table
ALTER TABLE upgrade_bundles
    ADD COLUMN IF NOT EXISTS installed_cp_version varchar(50) NULL,
    ADD COLUMN IF NOT EXISTS upgrade_status upgrade_status_enum DEFAULT 'pending' NOT NULL;

COMMENT ON COLUMN upgrade_bundles.installed_cp_version IS 'CP version that was running before upgrade was triggered';
COMMENT ON COLUMN upgrade_bundles.upgrade_status IS 'Tracks upgrade lifecycle: pending → staged → success/failed/rolled_back';
