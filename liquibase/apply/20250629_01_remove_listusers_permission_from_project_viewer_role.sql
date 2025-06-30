-- Remove ListUsers permission from Project Viewer role
DELETE FROM "role_permission"
WHERE role_id = (
    SELECT id FROM "role" WHERE role_name = 'Project Viewer'
)
AND permission_id = (
    SELECT id FROM "permission" WHERE permission_name = 'ListUsers'
);
