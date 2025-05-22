ALTER TABLE operation_errors ADD COLUMN error_type TEXT, ADD COLUMN operation_type TEXT, ADD COLUMN origin TEXT;
ALTER TABLE task_errors ADD COLUMN error_type TEXT;