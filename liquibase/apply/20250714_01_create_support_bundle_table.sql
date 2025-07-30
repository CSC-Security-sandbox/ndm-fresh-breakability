CREATE TYPE support_bundle_status AS ENUM (
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED'
);

CREATE TABLE IF NOT EXISTS support_bundle_logs (
    request_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    status support_bundle_status NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    workflow_id TEXT,
    error_message TEXT,
    filters JSONB NOT NULL
);
