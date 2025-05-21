CREATE TABLE  IF NOT EXISTS task_errors (
    id UUID PRIMARY KEY DEFAULT  uuid_generate_v4() NOT NULL,
    task_id UUID NOT NULL,
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_errors_task_id ON task_errors USING btree (task_id);