ALTER TABLE "permission"
    ADD CONSTRAINT uq_permission_name UNIQUE (permission_name);

ALTER TABLE "role_permission"
    ADD CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id);
