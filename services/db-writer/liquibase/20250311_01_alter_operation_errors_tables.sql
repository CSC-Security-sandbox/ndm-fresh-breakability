ALTER TABLE operation_errors DROP CONSTRAINT operation_errors_operation_id_fkey;
ALTER TABLE operations ALTER COLUMN status DROP NOT NULL;
