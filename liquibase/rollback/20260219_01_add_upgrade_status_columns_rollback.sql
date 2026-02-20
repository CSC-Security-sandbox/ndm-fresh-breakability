ALTER TABLE upgrade_bundles
    DROP COLUMN IF EXISTS installed_cp_version,
    DROP COLUMN IF EXISTS upgrade_status;

DROP TYPE IF EXISTS upgrade_status_enum;
