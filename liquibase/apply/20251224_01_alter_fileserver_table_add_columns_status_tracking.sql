ALTER TABLE file_server ADD COLUMN IF NOT EXISTS consolidated_report_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS consolidated_report_path VARCHAR(500),
ADD COLUMN IF NOT EXISTS consolidated_report_workflow_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS consolidated_report_updated_at TIMESTAMP WITH TIME ZONE;

