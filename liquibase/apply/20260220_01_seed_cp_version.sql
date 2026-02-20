INSERT INTO global_settings (id, setting_key, setting_value, description, setting_type, created_at, updated_at)
VALUES (
    uuid_generate_v4(),
    'CP_VERSION',
    'N/A',
    'Deployed control plane version',
    'SYSTEM',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (setting_key) DO NOTHING;
