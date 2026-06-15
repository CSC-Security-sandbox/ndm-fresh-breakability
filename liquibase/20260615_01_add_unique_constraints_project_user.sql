-- Add unique constraint on project(account_id, project_name) to prevent duplicate project names per account
ALTER TABLE project ADD CONSTRAINT uq_project_account_name UNIQUE (account_id, project_name);

-- Add unique constraint on "user"(email) to prevent duplicate email addresses
ALTER TABLE "user" ADD CONSTRAINT uq_user_email UNIQUE (email);
