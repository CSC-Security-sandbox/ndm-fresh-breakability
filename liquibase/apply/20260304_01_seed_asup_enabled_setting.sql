INSERT INTO global_settings (setting_key, setting_value, description, setting_type)
VALUES ('asup_enabled', 'true', 'ASUP metrics sharing enabled/disabled', 'boolean')
ON CONFLICT (setting_key) DO NOTHING;
