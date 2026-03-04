-- =====================================================
-- ASUP Stats Table
-- =====================================================
-- This table stores stats for each COMPLETED job run.
-- Stats are aggregated per job_config_id when generating ASUP XML.
-- Only untransmitted records are sent to ASUP endpoint.
-- =====================================================

-- Create the asup_stats table
CREATE TABLE IF NOT EXISTS datamigrator.asup_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Job identification
    job_run_id UUID NOT NULL,
    job_config_id UUID NOT NULL,
    
    -- Project context
    project_id UUID NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    
    -- Job type and protocol
    job_type VARCHAR(50) NOT NULL,     -- 'discovery', 'migration', 'cutover'
    protocol VARCHAR(50),              -- 'SMB', 'NFS', etc.
    
    -- Source and Destination server types
    source_server_type VARCHAR(100),   -- 'Dell Isilon', 'OtherNAS', 'NetApp ONTAP', etc.
    destination_server_type VARCHAR(100), -- 'ANF', 'FSxN', 'OtherNAS', 'n/a' for discovery
    
    -- Stats for this job run
    file_count BIGINT DEFAULT 0,
    size_bytes BIGINT DEFAULT 0,
    
    -- Transmission tracking
    transmitted BOOLEAN DEFAULT FALSE,  -- Whether this record has been sent to ASUP

    -- Unique constraint: one entry per job run
    CONSTRAINT asup_stats_job_run_unique UNIQUE (job_run_id)
);

-- Index for finding untransmitted records (used by getUntransmittedStatsGroupedByProject, markAsTransmitted, getUntransmittedCount)
CREATE INDEX IF NOT EXISTS idx_asup_stats_transmitted
    ON datamigrator.asup_stats(transmitted) WHERE transmitted = FALSE;


