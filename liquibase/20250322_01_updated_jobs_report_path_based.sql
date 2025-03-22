CREATE OR REPLACE PROCEDURE jobs_report_data_v2(
    IN job_run_id_param UUID,
    IN schema_name TEXT
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    summary_data JSONB;
    job_type_const TEXT := 'JOBS_REPORT';
    cut_over_config_id UUID;
    var_source_path_id UUID;
    var_target_path_id UUID;
    volumeIds JSONB;
    configIds JSONB;
    last_job_run JSONB;
    last_iteration JSONB;
    last_errors JSONB;
    cutover_jobs_data JSONB;
    scan_iterations JSONB;
BEGIN
    EXECUTE format('SET search_path TO %I', schema_name);

    -- Collect volume IDs related to the given job_run_id
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'source_path_id', jc.source_path_id,
        'target_path_id', jc.target_path_id
    )), '[]'::JSONB)
    INTO volumeIds
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    WHERE jc.job_type in ('MIGRATE', 'CUT_OVER') AND jr.id = job_run_id_param;

    -- Collect related config IDs, ensuring correct UUID casting
    SELECT COALESCE(jsonb_agg(jc.id), '[]'::JSONB)
    INTO configIds
    FROM jobconfig jc
    WHERE jc.source_path_id IN (
        SELECT (value->>'source_path_id')::UUID FROM jsonb_array_elements(volumeIds) AS value
    ) 
    OR jc.source_path_id IN (
        SELECT (value->>'target_path_id')::UUID FROM jsonb_array_elements(volumeIds) AS value
    ) 
    OR jc.target_path_id IN (
        SELECT (value->>'source_path_id')::UUID FROM jsonb_array_elements(volumeIds) AS value
    ) 
    OR jc.target_path_id IN (
        SELECT (value->>'target_path_id')::UUID FROM jsonb_array_elements(volumeIds) AS value
    )
    AND jc.job_type in ('MIGRATE', 'CUT_OVER');

    -- Fetch jobconfig_id, source_path_id, and target_path_id for the given job_run_id
    SELECT jr.job_config_id, jc.source_path_id, jc.target_path_id
    INTO cut_over_config_id, var_source_path_id, var_target_path_id
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    WHERE jr.id = job_run_id_param;

    -- Fetch last job run details
    SELECT jsonb_build_object('id', last_jr.id)
    INTO last_job_run
    FROM jobrun last_jr
    WHERE last_jr.job_config_id IN (
        SELECT value::UUID FROM jsonb_array_elements_text(configIds)
    )
    ORDER BY last_jr.created_at DESC
    LIMIT 1;

    -- Fetch summary data
    WITH aggregated_data AS (
        SELECT 
            jr.id AS job_run_id,
            jc.id AS job_config_id,
            jc.job_type,
            jc.source_path_id AS job_source_path_id,  
            jc.target_path_id AS job_target_path_id,  
            v_source.volume_path AS source_path,
            v_target.volume_path AS target_path,
            v_source.id AS volume_source_path_id,  
            v_target.id AS volume_target_path_id,  
            cc.config_name AS file_server,
            fs.protocol,
            fs.protocol_version,
            jr.start_time,
            jr.end_time,
            jr.created_at,
            jr.status,
            jr.iteration_number,
            COUNT(DISTINCT CASE WHEN i.is_directory = FALSE THEN i.id END) AS files,
            COUNT(DISTINCT CASE WHEN i.is_directory = TRUE THEN i.id END) AS directories,
            COUNT(DISTINCT o.id) AS operations,
            '-' AS errors,
            SUM(CASE WHEN i.is_directory = FALSE THEN i.file_size ELSE 0 END) AS capacity,
            r.report_data::jsonb AS coc_report
        FROM jobrun jr
        LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
        LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
        LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
        LEFT JOIN file_server fs ON v_source.file_server_id = fs.id
        LEFT JOIN inventory i ON i.job_run_id = jr.id
        LEFT JOIN operations o ON o.job_run_id = jr.id
        LEFT JOIN config cc ON fs.config_id = cc.id
        LEFT JOIN reports r ON jr.id = r.job_run_id AND r.report_type = 'COC'
        WHERE jr.job_config_id IN (
            SELECT value::UUID FROM jsonb_array_elements_text(configIds)
        )
        GROUP BY jr.id, jc.id, v_source.id, v_target.id, cc.config_name, fs.protocol, fs.protocol_version, 
                 jr.start_time, jr.end_time, jr.created_at, jr.status, jr.iteration_number, r.report_data
    )
    SELECT jsonb_agg(jsonb_build_object(
        'source', jsonb_build_object(
            'path_id', a.volume_source_path_id,  
            'path', a.source_path,
            'file_server', a.file_server,
            'protocol', a.protocol,
            'protocol_version', a.protocol_version,
            'job_type', a.job_type
        ),
        'target', jsonb_build_object(
            'path_id', a.volume_target_path_id,  
            'path', a.target_path,
            'file_server', a.file_server,
            'capacity', '-',
            'protocol', a.protocol,
            'protocol_version', a.protocol_version
        ),
        'details', jsonb_build_object(
            'files', a.files,
            'directories', a.directories,
            'operations', a.operations,
            'errors', a.errors,
            'duration', COALESCE(EXTRACT(EPOCH FROM (a.end_time - a.start_time)), 0),
            'job_run_id', a.job_run_id,
            'created_at', a.created_at,
            'status', a.status,
            'capacity', a.capacity
        ),
        'coc_report', a.coc_report
    ) ORDER BY a.created_at DESC)
    INTO summary_data
    FROM aggregated_data a;

    -- Capture scan iterations
    WITH aggregated_iterations AS (
        SELECT
            ljr.id AS job_run_id,
            ljr.start_time,
            COALESCE(EXTRACT(EPOCH FROM (ljr.end_time - ljr.start_time)), 0) AS duration,
            COUNT(DISTINCT CASE WHEN i.is_directory = FALSE THEN i.id END) AS files,
            COUNT(DISTINCT CASE WHEN i.is_directory = TRUE THEN i.id END) AS directories,
            COUNT(DISTINCT o.id) AS operations
        FROM jobrun ljr
        LEFT JOIN inventory i ON i.job_run_id = ljr.id
        LEFT JOIN operations o ON o.job_run_id = ljr.id
        WHERE ljr.job_config_id IN (
            SELECT value::UUID FROM jsonb_array_elements_text(configIds)
        )
        GROUP BY ljr.id, ljr.start_time, ljr.end_time
    )
    SELECT jsonb_agg(jsonb_build_object(
        'job_run_id', job_run_id,
        'start_time', start_time,
        'duration', duration,
        'delta_files', files,
        'delta_directories', directories,
        'delta_operations', operations
    ))
    INTO scan_iterations
    FROM aggregated_iterations;

    -- Insert or update the report
    UPDATE reports 
    SET report_data = jsonb_build_object(
        'job_type_const', job_type_const,
        'job_run_id', job_run_id_param,
        'source_path_id', var_source_path_id,
        'target_path_id', var_target_path_id,
        'summary', summary_data,
        'scan_iterations', scan_iterations
    )
    WHERE job_run_id = job_run_id_param AND report_type = job_type_const;

    IF NOT FOUND THEN
        INSERT INTO reports (job_run_id, report_type, report_data)
        VALUES (job_run_id_param, job_type_const, jsonb_build_object(
            'job_type_const', job_type_const,
            'job_run_id', job_run_id_param,
            'source_path_id', var_source_path_id,
            'target_path_id', var_target_path_id,
            'summary', summary_data,
            'scan_iterations', scan_iterations,
            'volume_ids', volumeIds,
            'config_ids', configIds
        ));
    END IF;

END;
$procedure$;