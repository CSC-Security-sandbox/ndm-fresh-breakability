ALTER TABLE "role_permission"
    DROP CONSTRAINT IF EXISTS uq_role_permission;

ALTER TABLE "permission"
    DROP CONSTRAINT IF EXISTS uq_permission_name;
