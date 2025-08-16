DO $$
DECLARE
    user_id UUID;
BEGIN
-- Insert SMTP permission
user_id = uuid_generate_v4();
INSERT INTO "permission" (id, permission_name, permission_status, created_at, created_by, updated_at, updated_by) 
    VALUES
        (uuid_generate_v4(), 'SaveSMTP', 'active', now(), user_id, now(), user_id);

-- Add SMTP permission to App Admin role
INSERT INTO "role_permission" (id, role_id, permission_id, created_at, created_by, updated_at, updated_by)
SELECT 
    uuid_generate_v4(), 
    r.id, 
    p.id, 
    now(), 
    user_id, 
    now(), 
    user_id
FROM "role" r, "permission" p
WHERE r.role_name = 'App Admin'
  AND p.permission_name = 'SaveSMTP'
  AND NOT EXISTS (
      SELECT 1 FROM "role_permission" rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

END $$;