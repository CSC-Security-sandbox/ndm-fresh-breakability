-- Flip the DEFAULT for smb_permission_inheritance_mode from INHERIT_PERMS_AS_EXPLICIT
-- to INHERIT_PERMS_AS_IS on both tables. Only changes the column DEFAULT clause;
-- existing rows that already hold 'INHERIT_PERMS_AS_EXPLICIT' are intentionally
-- left untouched so legacy jobs keep their original behavior.

ALTER TABLE jobconfig
  ALTER COLUMN smb_permission_inheritance_mode SET DEFAULT 'INHERIT_PERMS_AS_IS';

ALTER TABLE job_options
  ALTER COLUMN smb_permission_inheritance_mode SET DEFAULT 'INHERIT_PERMS_AS_IS';
