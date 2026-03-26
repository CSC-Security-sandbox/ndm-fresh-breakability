CREATE TABLE IF NOT EXISTS datamigrator.user_eula_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL,
    eula_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    version VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NULL,
    updated_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_user_eula_status_user
    ON datamigrator.user_eula_status(user_id);
