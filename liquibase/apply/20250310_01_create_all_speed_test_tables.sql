CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS  speed_test_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  file_server_name UUID NOT NULL,
  protocol VARCHAR(255) NOT NULL,
  read_test BOOLEAN DEFAULT false NOT NULL,
  write_test BOOLEAN DEFAULT false NOT NULL,
  packet_loss_test BOOLEAN DEFAULT false NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobconfig(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS speed_test_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  workers_id UUID NOT NULL,
  FOREIGN KEY (job_id) REFERENCES speed_test_config(id) ON DELETE CASCADE
);

	
CREATE TABLE IF NOT EXISTS network_performance_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_loss INTEGER NOT NULL,
  round_trip_delay_min FLOAT NOT NULL,
  round_trip_delay_avg FLOAT NOT NULL,
  round_trip_delay_max FLOAT NOT NULL,
  round_trip_delay_mdev FLOAT NOT NULL
);

CREATE TABLE IF NOT EXISTS speed_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_time_taken FLOAT NOT NULL,
  file_size BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS speed_log_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  speed_log_id UUID NOT NULL,
  time_stamp VARCHAR(255) NOT NULL,
  speed FLOAT NOT NULL,
  FOREIGN KEY (speed_log_id) REFERENCES speed_log(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS speed_test_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  file_server_id UUID NOT NULL,
  write_result_id UUID,
  read_result_id UUID,
  network_performance_result_id UUID,
  FOREIGN KEY (write_result_id) REFERENCES speed_log(id) ON DELETE CASCADE,
  FOREIGN KEY (read_result_id) REFERENCES speed_log(id) ON DELETE CASCADE,
  FOREIGN KEY (network_performance_result_id) REFERENCES network_performance_result(id) ON DELETE CASCADE
);