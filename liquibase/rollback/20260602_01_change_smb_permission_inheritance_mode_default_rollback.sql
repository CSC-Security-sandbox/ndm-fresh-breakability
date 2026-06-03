-- Rollback: restore the previous DEFAULT (INHERIT_PERMS_AS_EXPLICIT) on both tables.
-- Same caveat as the forward migration: only the column DEFAULT changes; existing
-- rows are not touched.

ALTER TABLE jobconfig
  ALTER COLUMN smb_permission_inheritance_mode SET DEFAULT 'INHERIT_PERMS_AS_EXPLICIT';

ALTER TABLE job_options
  ALTER COLUMN smb_permission_inheritance_mode SET DEFAULT 'INHERIT_PERMS_AS_EXPLICIT';
