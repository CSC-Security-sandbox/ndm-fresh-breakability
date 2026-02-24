INSERT INTO "permission" (
    id, permission_name, permission_status, created_at, created_by, updated_at, updated_by
)
SELECT
    uuid_generate_v4(),
    'UpgradeManagement',
    'active',
    now(),
    (SELECT id FROM "user" WHERE email = 'admin@datamigrator.local'),
    now(),
    (SELECT id FROM "user" WHERE email = 'admin@datamigrator.local')
WHERE NOT EXISTS (
    SELECT 1 FROM "permission" WHERE permission_name = 'UpgradeManagement'
);

INSERT INTO "role_permission" (
    id, role_id, permission_id, created_at, created_by, updated_at, updated_by
)
SELECT
    uuid_generate_v4(),
    r.id,
    p.id,
    now(),
    (SELECT id FROM "user" WHERE email = 'admin@datamigrator.local'),
    now(),
    (SELECT id FROM "user" WHERE email = 'admin@datamigrator.local')
FROM "role" r, "permission" p
WHERE r.role_name = 'App Admin'
  AND p.permission_name = 'UpgradeManagement'
  AND NOT EXISTS (
      SELECT 1 FROM "role_permission" rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
