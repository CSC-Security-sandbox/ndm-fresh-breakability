-- Rollback: remove unique constraints
ALTER TABLE project DROP CONSTRAINT IF EXISTS uq_project_account_name;
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS uq_user_email;
