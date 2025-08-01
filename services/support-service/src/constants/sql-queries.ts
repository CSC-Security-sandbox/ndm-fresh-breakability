export const SQL_QUERIES = {
  /**
   * Query to fetch worker IDs for all projects
   */
  GET_WORKER_IDS: `
    SELECT w.id as worker_id
    FROM datamigrator.project p
    INNER JOIN datamigrator.worker w ON p.id = w.project_id
    ORDER BY w.id`,

  /**
   * Query to fetch all project IDs
   */
  GET_PROJECT_IDS: `
    SELECT id as project_id
    FROM datamigrator.project`,

  /**
   * Query to fetch job configuration details with date filtering
   * Used in getJobConfigDetails method
   * $1 = start date, $2 = end date (both in 'YYYY-MM-DD' format)
   */
  GET_JOB_CONFIG_DETAILS_WITH_DATE_FILTER: `
    SELECT 
      p.id as "Project Id",
      p.project_name as "Project Name",
      p.project_description as "Project Description",
      c.id as "Config Id",
      c.config_name as "Config Name",
      fs.id as "File Server Id",
      fs.hostname as "File Server Hostname",
      fs.username as "File Server Username",
      fs.protocol as "File Server Protocol",
      fs.server_type as "File Server Type",
      fs.protocol_version as "File Server Protocol Version",
      fs.export_path_source as "Export Path Source",
      v.volume_path as "Volume Path",
      jc.id as "JobConfig Id",
      jc.job_type as "Job Type",
      jc.status as "Job Status",
      jc.exclude_file_patterns as "Exclude File Patterns",
      jc.created_at as "JobConfig Created At",
      jc.updated_at as "JobConfig Updated At"
    FROM datamigrator.project p
      LEFT JOIN datamigrator.config c ON p.id = c.project_id
      LEFT JOIN datamigrator.file_server fs ON c.id = fs.config_id
      LEFT JOIN datamigrator.volume v ON fs.id = v.file_server_id
      LEFT JOIN datamigrator.jobconfig jc ON v.id = jc.source_path_id
    WHERE v.volume_path IS NOT NULL 
      AND TRIM(v.volume_path) != ''
      AND (
        (DATE(jc.created_at) >= $1 AND DATE(jc.created_at) <= $2) OR
        (DATE(jc.updated_at) >= $1 AND DATE(jc.updated_at) <= $2)
      )
    ORDER BY jc.id`,
} as const;
