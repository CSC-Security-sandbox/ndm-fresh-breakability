-- Add ManageUpgrade permission (App Admin only)
-- App Admin automatically gets all permissions via the seed logic.
-- This permission is NOT assigned to Project Admin or Viewer.
DO $$
DECLARE
    user_id UUID;
    perm_id UUID;
    admin_role_id UUID;
BEGIN
    SELECT id INTO user_id FROM "user" LIMIT 1;

    -- Insert ManageUpgrade permission
    perm_id := uuid_generate_v4();
    INSERT INTO "permission" (id, permission_name, permission_status, created_at, created_by, updated_at, updated_by)
    VALUES (perm_id, 'ManageUpgrade', 'active', now(), user_id, now(), user_id)
    ON CONFLICT DO NOTHING;

    -- Assign only to App Admin role (NOT Project Admin)
    SELECT id INTO admin_role_id FROM "role" WHERE role_name = 'App Admin';
    IF admin_role_id IS NOT NULL THEN
        SELECT id INTO perm_id FROM "permission" WHERE permission_name = 'ManageUpgrade';
        INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
        VALUES (uuid_generate_v4(), admin_role_id, perm_id, now(), user_id, now(), user_id)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
