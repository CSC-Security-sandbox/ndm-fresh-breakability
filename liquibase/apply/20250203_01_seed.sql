DO $$
DECLARE
    user_id UUID;
    account_id UUID;
BEGIN
    -- Clean up existing records in the migrateadmin schema
    DELETE FROM "account" CASCADE;
    DELETE FROM "role_permission" CASCADE;
    DELETE FROM "role" CASCADE;
    DELETE FROM "permission" CASCADE;
    DELETE FROM "user" CASCADE;

    -- Ensure the UUID extension is available
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    
    -- Generate a system user for tracking
    user_id = uuid_generate_v4();
    account_id = '753975cb-2f97-4230-b632-6815515a7d0d';
    INSERT INTO "user" (id, email, user_status, created_at, created_by, updated_at, updated_by) 
    VALUES (
        user_id,
        'admin@datamigrator.local',
        'active',
        now(),
        user_id,
        now(),
        user_id
    );

    -- Insert permissions
    INSERT INTO "permission" (id, permission_name, permission_status, created_at, created_by, updated_at, updated_by) 
    VALUES
        (uuid_generate_v4(), 'UpdateProject', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'CreateUser', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'WorkerDeployment', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'ManageConfig', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'ManageJob', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'Reports', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'ListUsers', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'ListProjects', 'active', now(), user_id, now(), user_id);

    -- Create roles
    INSERT INTO "role" (id, role_name, role_status, created_at, created_by, updated_at, updated_by)
    VALUES 
        (uuid_generate_v4(), 'App Admin', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'Project Admin', 'active', now(), user_id, now(), user_id),
        (uuid_generate_v4(), 'Project Viewer', 'active', now(), user_id, now(), user_id);
    
    -- Assign permissions to roles
    -- App Admin gets all permissions
    INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
    SELECT uuid_generate_v4(), r.id, p.id, now(), user_id, now(), user_id
    FROM "role" r, "permission" p
    WHERE r.role_name = 'App Admin';

    -- ProjectAdmin gets specific permissions
    INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
    SELECT uuid_generate_v4(), r.id, p.id, now(), user_id, now(), user_id
    FROM "role" r, "permission" p
    WHERE r.role_name = 'Project Admin'
      AND p.permission_name IN (
          'UpdateProject', 'WorkerDeployment', 'ManageConfig', 
          'ManageJob', 'Reports', 
          'ListUsers', 'ListProjects'
      );

    -- Viewer gets only view-related permissions
    INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
    SELECT uuid_generate_v4(), r.id, p.id, now(), user_id, now(), user_id
    FROM "role" r, "permission" p
    WHERE r.role_name = 'Project Viewer'
      AND p.permission_name IN (
          'Reports', 'ListUsers', 
          'ListProjects'
      );

    -- Insert accounts
    INSERT INTO "account" (id, account_name, created_at, created_by, updated_at, updated_by)
    VALUES 
        (account_id, 'NetApp Data Migrate', now(), user_id, now(), user_id);

    -- creating role for a particular user
    INSERT INTO user_role
    (created_at, created_by, updated_at, updated_by, id, user_id, role_id, project_id, account_id)
    VALUES(now(), user_id, now(), user_id, uuid_generate_v4(), user_id, (SELECT id FROM "role" WHERE role_name = 'App Admin'), null, account_id);
    
END $$;