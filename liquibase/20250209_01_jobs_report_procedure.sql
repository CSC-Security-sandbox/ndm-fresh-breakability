CREATE OR REPLACE PROCEDURE jobs_report_data(IN job_run_id_param UUID)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    summary_data JSONB;
    job_type_const TEXT := 'JOBS_REPORT';
    jobconfig_id UUID;
    paths JSONB;
    last_job_run JSONB;
    current_iteration JSONB;
    last_iteration JSONB;
    last_errors JSONB;
    cutover_jobs_data JSONB;
    coc JSONB;
    scan_iterations JSONB;
    aggregated_operations JSONB;  -- New variable for aggregated operations data
    todo_operations_data JSONB;
BEGIN
    -- Ensure jobs_report table exists using dynamic SQL
    EXECUTE 'CREATE TABLE IF NOT EXISTS jobs_report (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        job_run_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        job_type TEXT DEFAULT ''jobs_report'',
        report_data JSONB,
        jobconfig_id UUID,  -- FIXED: Ensure correct type
        paths JSONB
    )';

    -- Fetch jobconfig_id as UUID
    SELECT jc.id 
    INTO jobconfig_id
    FROM jobrun jr
    JOIN jobconfig jc ON jc.id = jr.job_config_id
    WHERE jr.id = job_run_id_param;

    -- Fetch last job run details
    SELECT jsonb_build_object(
        'id', last_jr.id,
        'start_time', last_jr.created_at,
        'duration', 
            CASE 
                WHEN last_jr.end_time IS NOT NULL 
                THEN (last_jr.end_time - last_jr.start_time)::TEXT 
                ELSE NULL 
            END,
        'failures', '-',
        'state', last_jr.status
    )
    INTO last_job_run
    FROM jobrun last_jr
    WHERE last_jr.job_config_id = jobconfig_id
    ORDER BY last_jr.created_at DESC
    LIMIT 1;

    -- Fetch summary data
    SELECT jsonb_build_object(
        'source', jsonb_build_object(
            'path_id', v_source.id,
            'path', v_source.volume_path,
            'file_server', cc.config_name,
            'items', (SELECT COUNT(*) FROM inventory i WHERE i.job_run_id = jr.id AND i.volume_id = v_source.id),
            'capacity', '-',
            'protocol', fs.protocol,
            'protocol_version', fs.protocol_version,
            'job_type', jc.job_type
        ),
        'target', jsonb_build_object(
            'path_id', v_target.id,
            'path', v_target.volume_path,
            'file_server', cc.config_name,
            'capacity', '-',
            'protocol', fs.protocol,
            'protocol_version', fs.protocol_version
        ),
        'last_run', COALESCE(last_job_run, jsonb_build_object(
            'last_run_id', NULL,
            'start_time', NULL,
            'failures', NULL,
            'state', NULL
        ))  -- Ensure last_run is always present
    ) 
    INTO summary_data
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
    LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
    LEFT JOIN file_server fs ON v_source.file_server_id = fs.id
    LEFT JOIN config cc ON fs.config_id = cc.id
    WHERE jr.id = job_run_id_param;

    -- Fetch paths data
    SELECT jsonb_build_object(
        'source', v_source.id,
        'target', v_target.id
    ) 
    INTO paths
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
    LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
    WHERE jr.id = job_run_id_param;

    -- Fetch current job run details
    WITH current_iteration_data AS (
        SELECT 
            curr_jobconfig.id AS job_config_id,
            curr_job_run.id AS job_run_id,
            curr_job_run.start_time,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = FALSE 
                AND scan_iteration_inventory.volume_id = curr_jobconfig.source_path_id
                THEN scan_iteration_inventory.id 
            END) AS s_files,
            COALESCE(EXTRACT(EPOCH FROM (curr_job_run.end_time - curr_job_run.start_time)), 0) AS s_duration,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = TRUE 
                THEN scan_iteration_inventory.id 
            END) AS s_directories,
            COUNT(DISTINCT scan_iteration_operations.id) AS s_operations,
            COUNT(scan_iteration_operations.error_details) AS s_errors
        FROM jobconfig curr_jobconfig
        LEFT JOIN jobrun curr_job_run ON curr_job_run.job_config_id = curr_jobconfig.id
        LEFT JOIN inventory scan_iteration_inventory ON scan_iteration_inventory.job_run_id = curr_job_run.id
        LEFT JOIN operations scan_iteration_operations ON scan_iteration_operations.job_run_id = curr_job_run.id
        WHERE curr_jobconfig.id = jobconfig_id and curr_job_run.status = 'RUNNING'
        GROUP BY 
            curr_jobconfig.id, 
            curr_job_run.id, 
            curr_job_run.start_time
    )
    SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'job_config_id', job_config_id,
                'job_run_id', job_run_id,
                'start_time', start_time,
                's_files', s_files,
                's_duration', s_duration,
                's_directories', s_directories,
                's_operations', s_operations,
                's_errors', s_errors
            )
        ), '[]'::JSONB)  -- Ensure empty array instead of NULL
    INTO current_iteration
    FROM current_iteration_data;

    -- Fetch last job run details where last_job_run.status = 'COMPLETED'
    WITH last_completed_job AS (
        -- Get the latest completed job run for the given jobconfig_id
        SELECT id, job_config_id, start_time, end_time
        FROM jobrun
        WHERE job_config_id = jobconfig_id
        AND status = 'COMPLETED'
        ORDER BY created_at DESC  -- Get the most recent one
        LIMIT 1
    ),
    last_iteration_data AS (
        SELECT 
            last_jobconfig.id AS job_config_id,
            last_job_run.id AS job_run_id,
            last_job_run.start_time, -- This column must be included in GROUP BY
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = FALSE 
                AND scan_iteration_inventory.volume_id = last_jobconfig.source_path_id
                THEN scan_iteration_inventory.id 
            END) AS s_files,
            COALESCE(EXTRACT(EPOCH FROM (last_job_run.end_time - last_job_run.start_time)), 0) AS s_duration,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = TRUE 
                THEN scan_iteration_inventory.id 
            END) AS s_directories,
            COUNT(DISTINCT scan_iteration_operations.id) AS s_operations,
            COUNT(scan_iteration_operations.error_details) AS s_errors
        FROM jobconfig last_jobconfig
        LEFT JOIN last_completed_job last_job_run ON last_job_run.job_config_id = last_jobconfig.id
        LEFT JOIN inventory scan_iteration_inventory ON scan_iteration_inventory.job_run_id = last_job_run.id
        LEFT JOIN operations scan_iteration_operations ON scan_iteration_operations.job_run_id = last_job_run.id
        WHERE last_jobconfig.id = jobconfig_id  -- Ensuring we filter for the specific jobconfig
        GROUP BY 
            last_jobconfig.id, 
            last_job_run.id, 
            last_job_run.start_time,  -- **Added to GROUP BY**
            last_job_run.end_time     -- **Added to GROUP BY**
    )
    SELECT jsonb_build_object(
        'job_config_id', job_config_id,
        'job_run_id', job_run_id,
        'start_time', start_time,
        's_files', s_files,
        's_duration', s_duration,
        's_directories', s_directories,
        's_operations', s_operations,
        's_errors', s_errors
    )
    INTO last_iteration
    FROM last_iteration_data
    LIMIT 1;  -- Ensure only one record is selected


    -- Capture errors for last job run
    SELECT jsonb_build_object(
        'others', COUNT(last_errors_operations.error_details)
    )
    INTO last_errors
    FROM (
        SELECT last_job_run.id AS job_run_id
        FROM jobconfig last_jobconfig
        LEFT JOIN jobrun last_job_run ON last_job_run.job_config_id = last_jobconfig.id
        WHERE last_jobconfig.id = jobconfig_id
        ORDER BY last_job_run.created_at DESC, last_job_run.iteration_number DESC
        LIMIT 1
    ) latest_job_run
    LEFT JOIN operations last_errors_operations ON latest_job_run.job_run_id = last_errors_operations.job_run_id;

     -- Capture cutover jobs
    WITH cutover_job AS (
        SELECT id, job_config_id, start_time, end_time
        FROM jobrun
        WHERE job_config_id = jobconfig_id
        AND status = 'COMPLETED'
        ORDER BY created_at DESC  -- Get the most recent one
        LIMIT 1
    ),
    cutover_jobs_details AS (
        SELECT 
            cutover_jobconfig.id AS job_config_id,
            cutover_job_run.id AS job_run_id,
            cutover_job_run.start_time, -- This column must be included in GROUP BY
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = FALSE 
                AND scan_iteration_inventory.volume_id = cutover_jobconfig.source_path_id
                THEN scan_iteration_inventory.id 
            END) AS s_files,
            COALESCE(EXTRACT(EPOCH FROM (cutover_job_run.end_time - cutover_job_run.start_time)), 0) AS s_duration,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = TRUE 
                THEN scan_iteration_inventory.id 
            END) AS s_directories,
            COUNT(DISTINCT scan_iteration_operations.id) AS s_operations,
            COUNT(scan_iteration_operations.error_details) AS s_errors
        FROM jobconfig cutover_jobconfig
        LEFT JOIN cutover_job cutover_job_run ON cutover_job_run.job_config_id = cutover_jobconfig.id
        LEFT JOIN inventory scan_iteration_inventory ON scan_iteration_inventory.job_run_id = cutover_job_run.id
        LEFT JOIN operations scan_iteration_operations ON scan_iteration_operations.job_run_id = cutover_job_run.id
        WHERE cutover_jobconfig.id = jobconfig_id and cutover_jobconfig.job_type = 'CUTOVER'
        GROUP BY 
            cutover_jobconfig.id, 
            cutover_job_run.id, 
            cutover_job_run.start_time,  -- **Added to GROUP BY**
            cutover_job_run.end_time     -- **Added to GROUP BY**
    )
    SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'job_config_id', job_config_id,
                'job_run_id', job_run_id,
                'start_time', start_time,
                's_files', s_files,
                's_duration', s_duration,
                's_directories', s_directories,
                's_operations', s_operations,
                's_errors', s_errors
            )
        ), '[]'::JSONB)
    INTO cutover_jobs_data
    FROM cutover_jobs_details;

    SELECT jsonb_agg(
        jsonb_build_object(
            'job_config_id', coc_job_config.id,
            'rows', jsonb_build_object(
                'path', (
                    SELECT report_data
                    FROM reports
                    LEFT JOIN jobrun sop_jr ON sop_jr.job_config_id = coc_job_config.id
                    WHERE reports.job_run_id = sop_jr.id
                    AND reports.report_type = 'MIGRATION_COC'
                    ORDER BY reports.created_at, reports.job_run_id
                    LIMIT 1
                )
            )
        )
    ) INTO coc
    FROM jobconfig coc_job_config
    LEFT JOIN jobrun coc_job_run ON coc_job_run.job_config_id = coc_job_config.id
    WHERE coc_job_config.id = jobconfig_id;


    -- Capture aggregated scan iteration data
    WITH aggregated_data AS (
        SELECT 
            scan_iteration_job_config.job_type, 
            scan_iteration_job_run.id AS job_run_id, 
            scan_iteration_job_config.id AS job_config_id,
            scan_iteration_job_run.start_time,
            scan_iteration_job_run.status,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = FALSE 
                AND scan_iteration_inventory.volume_id = scan_iteration_job_config.source_path_id
                THEN scan_iteration_inventory.id 
            END) AS s_files,
            COALESCE(EXTRACT(EPOCH FROM (scan_iteration_job_run.end_time - scan_iteration_job_run.start_time)), 0) AS s_duration,
            COUNT(DISTINCT CASE 
                WHEN scan_iteration_inventory.is_directory = TRUE 
                THEN scan_iteration_inventory.id 
            END) AS s_directories,
            COUNT(DISTINCT scan_iteration_operations.id) AS s_operations,
            COUNT(scan_iteration_operations.error_details) AS s_errors
        FROM jobconfig scan_iteration_job_config
        LEFT JOIN jobrun scan_iteration_job_run 
            ON scan_iteration_job_run.job_config_id = scan_iteration_job_config.id
        LEFT JOIN inventory scan_iteration_inventory 
            ON scan_iteration_inventory.job_run_id = scan_iteration_job_run.id
        LEFT JOIN operations scan_iteration_operations 
            ON scan_iteration_operations.job_run_id = scan_iteration_job_run.id
        WHERE scan_iteration_job_config.id = jobconfig_id
        GROUP BY 
            scan_iteration_job_run.id, 
            scan_iteration_job_config.id, 
            scan_iteration_job_config.job_type,
            scan_iteration_job_run.start_time
    )
    SELECT jsonb_agg(
            jsonb_build_object(
                'job_type', job_type, 
                'job_run_id', job_run_id, 
                'job_config_id', job_config_id,
                'start_time', start_time,
                's_files', s_files,
                's_duration', s_duration,
                's_directories', s_directories,
                's_operations', s_operations,
                's_errors', s_errors,
                'status', status
            )
        )
    INTO scan_iterations
    FROM aggregated_data;

    -- Capture aggregated operations data
    WITH aggregated_operations_data AS (
        SELECT 
            op_job_config.job_type, 
            op_job_run.id AS job_run_id, 
            op_job_config.id AS job_config_id,
            op_job_run.start_time,
            op_job_run.status,
            COUNT(DISTINCT CASE 
                WHEN operation.status = 'COMPLETED' 
                THEN operation.id 
            END) AS completed_operations,
            COALESCE(EXTRACT(EPOCH FROM (op_job_run.end_time - op_job_run.start_time)), 0) AS completed_duration
        FROM jobconfig op_job_config
        LEFT JOIN jobrun op_job_run 
            ON op_job_run.job_config_id = op_job_config.id
        LEFT JOIN operations operation 
            ON operation.job_run_id = op_job_run.id
        WHERE op_job_config.id = jobconfig_id
        GROUP BY 
            op_job_config.job_type, 
            op_job_run.id, 
            op_job_config.id, 
            op_job_run.start_time
    )
    SELECT jsonb_agg(
            jsonb_build_object(
                'job_type', job_type, 
                'job_run_id', job_run_id, 
                'job_config_id', job_config_id,
                'start_time', start_time,
                'completed_operations', completed_operations,
                'completed_duration', completed_duration,
                'status', status
            )
        )
    INTO aggregated_operations
    FROM aggregated_operations_data;


    -- Insert report data
    INSERT INTO jobs_report (job_run_id, job_type, report_data, jobconfig_id, paths)
    VALUES (job_run_id_param, job_type_const, jsonb_build_object(
        'summary', summary_data,
        'current_iteration', current_iteration,
        'last_iteration', last_iteration,
        'last_errors', last_errors,
        'cutovers', cutover_jobs_data,
        'coc', coc,
        'scan_iterations', scan_iterations,
        'aggregated_operations', aggregated_operations,
        'todo_operations', todo_operations_data 
    ), jobconfig_id, paths);

END;
$procedure$;
