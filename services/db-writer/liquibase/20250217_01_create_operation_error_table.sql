CREATE TABLE IF NOT EXISTS operation_errors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
    operation_id UUID NOT NULL,
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_operation_errors_operation_id ON operation_errors USING btree (operation_id);