DO $$
DECLARE
    admin_datamigrator_local_uuid UUID;
    app_admin_role_id UUID;
    upgrade_management_permission_id UUID;
BEGIN
    admin_datamigrator_local_uuid := (SELECT id FROM "user" WHERE email = 'admin@datamigrator.local');
    app_admin_role_id := (SELECT id FROM "role" WHERE role_name = 'App Admin');

    INSERT INTO "permission" (
        id, permission_name, permission_status, created_at, created_by, updated_at, updated_by
    )
    VALUES (
        uuid_generate_v4(),
        'UpgradeManagement',
        'active',
        now(),
        admin_datamigrator_local_uuid,
        now(),
        admin_datamigrator_local_uuid
    )
    ON CONFLICT (permission_name) DO NOTHING
    RETURNING id INTO upgrade_management_permission_id;

    -- ON CONFLICT returns no row, so fall back to SELECT if variable is still null
    IF upgrade_management_permission_id IS NULL THEN
        upgrade_management_permission_id := (SELECT id FROM "permission" WHERE permission_name = 'UpgradeManagement');
    END IF;

    INSERT INTO "role_permission" (
        id, role_id, permission_id, created_at, created_by, updated_at, updated_by
    )
    VALUES (
        uuid_generate_v4(),
        app_admin_role_id,
        upgrade_management_permission_id,
        now(),
        admin_datamigrator_local_uuid,
        now(),
        admin_datamigrator_local_uuid
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;
