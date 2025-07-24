CREATE TYPE support_bundle_status AS ENUM (
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED'
);

CREATE TABLE IF NOT EXISTS support_bundle_logs (
    request_id UUID PRIMARY KEY,
    user_id UUID,
    status support_bundle_status NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    workflow_id UUID,
    filters JSONB NOT NULL
);
