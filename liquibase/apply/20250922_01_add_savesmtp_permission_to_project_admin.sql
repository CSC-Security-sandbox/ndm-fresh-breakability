-- Add SaveSMTP permission to Project Admin role if not already present
INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
SELECT 
    uuid_generate_v4(), 
    r.id, 
    p.id, 
    now(), 
    uuid_generate_v4(), 
    now(), 
    uuid_generate_v4()
FROM "role" r, "permission" p
WHERE r.role_name = 'Project Admin'
  AND p.permission_name = 'SaveSMTP'
  AND NOT EXISTS (
      SELECT 1 FROM "role_permission" rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );