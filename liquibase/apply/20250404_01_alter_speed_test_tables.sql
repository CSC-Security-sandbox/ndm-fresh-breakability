ALTER TABLE speed_test_workers DROP COLUMN job_id;

ALTER TABLE speed_test_workers ADD COLUMN speed_test_config_id UUID;

ALTER TABLE network_performance_result ALTER COLUMN packet_loss TYPE float;

