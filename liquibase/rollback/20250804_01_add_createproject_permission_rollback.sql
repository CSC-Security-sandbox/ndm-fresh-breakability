WITH permission_cte AS (
    SELECT id AS permission_id FROM "permission" WHERE permission_name = 'CreateProject'
),
delete_role_permission AS (
    DELETE FROM "role_permission"
    WHERE role_id = (
        SELECT id FROM "role" WHERE role_name = 'App Admin'
    )
    AND permission_id = (SELECT permission_id FROM permission_cte)
)
DELETE FROM "permission"
WHERE id = (SELECT permission_id FROM permission_cte);
