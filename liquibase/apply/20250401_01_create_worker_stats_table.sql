CREATE TABLE IF NOT EXISTS worker_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_status varchar(50) NOT NULL,
  worker_id uuid NOT NULL,
  system_stats jsonb  NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NULL,
  created_by varchar NULL,
  updated_by varchar NULL,
  FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE CASCADE
);