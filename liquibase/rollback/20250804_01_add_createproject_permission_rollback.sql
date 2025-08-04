DELETE FROM "role_permission"
WHERE role_id = (
    SELECT id FROM "role" WHERE role_name = 'App Admin'
)
AND permission_id = (
    SELECT id FROM "permission" WHERE permission_name = 'CreateProject'
);
DELETE FROM "permission"
WHERE id = (
    SELECT id FROM "permission" WHERE permission_name = 'CreateProject'
);