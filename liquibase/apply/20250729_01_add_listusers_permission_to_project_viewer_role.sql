INSERT INTO "role_permission" (role_id, permission_id)
SELECT 
    (SELECT id FROM "role" WHERE role_name = 'Project Viewer'),
    (SELECT id FROM "permission" WHERE permission_name = 'ListUsers')
WHERE NOT EXISTS (
    SELECT 1 FROM "role_permission" 
    WHERE role_id = (SELECT id FROM "role" WHERE role_name = 'Project Viewer')
    AND permission_id = (SELECT id FROM "permission" WHERE permission_name = 'ListUsers')
);
