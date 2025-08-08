export const SQL_QUERIES = {
  /**
   * Query to fetch worker IDs for all projects
   */
  GET_WORKER_IDS: `
    SELECT w.id as worker_id, w.env_variables
    FROM datamigrator.project p
    INNER JOIN datamigrator.worker w ON p.id = w.project_id
    WHERE w.env_variables IS NOT NULL 
      AND json_typeof(w.env_variables) = 'object'
      AND w.env_variables::text != '{}'
    ORDER BY w.id`,

  /**
   * Query to fetch all project IDs
   */
  GET_PROJECT_IDS: `
    SELECT id as project_id
    FROM datamigrator.project`,

  /**
   * Query to fetch job configuration details with multiple project IDs filtering
   */
  GET_JOB_CONFIG_DETAILS_WITH_PROJECT_ID_FILTER: `
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
      AND p.id = ANY($1)
    ORDER BY p.id, jc.id`,
} as const;

export const GET_OPERATION_ERRORS_BY_DATE_RANGE = `
  SELECT 
    oe.id,
    oe.operation_id as "operationId",
    oe.error_code as "errorCode",
    oe.error_message as "errorMessage",
    oe.created_at as "createdAt",
    oe.file_name as "fileName",
    oe.file_path as "filePath",
    oe.error_type as "errorType",
    oe.operation_type as "operationType",
    oe.origin,
    p.id as "projectId",
    p.project_name as "projectName"
  FROM datamigrator.operation_errors oe
  INNER JOIN datamigrator.operations o ON oe.operation_id = o.id
  INNER JOIN datamigrator.jobrun jr ON o.job_run_id = jr.id
  INNER JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id
  INNER JOIN datamigrator.config c ON c.id IN (
    SELECT config_id FROM datamigrator.file_server fs 
    WHERE fs.id IN (
      SELECT file_server_id FROM datamigrator.volume v
      WHERE v.id = jc.source_path_id OR v.id = jc.target_path_id
    )
  )
  INNER JOIN datamigrator.project p ON c.project_id = p.id
  WHERE DATE(oe.created_at) >= $1
    AND DATE(oe.created_at) <= $2
  ORDER BY DATE(oe.created_at), oe.created_at, p.id
`;
