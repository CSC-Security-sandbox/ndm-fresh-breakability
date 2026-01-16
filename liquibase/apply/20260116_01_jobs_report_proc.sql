CREATE OR REPLACE PROCEDURE jobs_report_data_v2(
    IN job_run_id_param UUID,
    IN schema_name TEXT
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    summary_data JSONB;
    job_type_const TEXT := 'JOBS_REPORT';
    var_source_path_id UUID;
    var_target_path_id UUID;
    volumeIds JSONB;
    configIds JSONB;
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
    WHERE jr.id = job_run_id_param and jc.job_type in ('MIGRATE', 'CUT_OVER');

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
    AND jc.job_type IN ('MIGRATE', 'CUT_OVER');

    -- Fetch jobconfig_id, source_path_id, and target_path_id for the given job_run_id
    SELECT jr.job_config_id, jc.source_path_id, jc.target_path_id
    INTO var_source_path_id, var_target_path_id
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    WHERE jr.id = job_run_id_param;

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
        CASE 
            WHEN cc_source.server_type != 'OtherNAS' AND fs_source.file_server_name IS NOT NULL 
            THEN cc_source.config_name || ':' || fs_source.file_server_name
            ELSE cc_source.config_name
        END AS file_server_source,
        CASE 
            WHEN cc_target.server_type != 'OtherNAS' AND fs_target.file_server_name IS NOT NULL 
            THEN cc_target.config_name || ':' || fs_target.file_server_name
            ELSE cc_target.config_name
        END AS file_server_target,
        fs_source.protocol,
        fs_source.protocol_version,
        jr.start_time,
        jr.end_time,
        jr.created_at,
        jr.status,
        jr.iteration_number
    FROM jobrun jr
    INNER JOIN jobconfig jc ON jc.id = jr.job_config_id 
        AND jc.job_type IN ('MIGRATE', 'CUT_OVER')
        AND jr.job_config_id IN (
            SELECT value::UUID FROM jsonb_array_elements_text(configIds)
        )
    LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
    LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
    LEFT JOIN file_server fs_source ON v_source.file_server_id = fs_source.id
    LEFT JOIN file_server fs_target ON v_target.file_server_id = fs_target.id
    LEFT JOIN config cc_source ON fs_source.config_id = cc_source.id
    LEFT JOIN config cc_target ON fs_target.config_id = cc_target.id
)
SELECT jsonb_agg(jsonb_build_object(
    'source', jsonb_build_object(
        'path_id', jb.volume_source_path_id,
        'path', jb.source_path,
        'file_server', jb.file_server_source,
        'protocol', jb.protocol,
        'protocol_version', jb.protocol_version,
        'job_type', jb.job_type
    ),
    'target', jsonb_build_object(
        'path_id', jb.volume_target_path_id,
        'path', jb.target_path,
        'file_server', jb.file_server_target,
        'capacity', NULL,
        'protocol', jb.protocol,
        'protocol_version', jb.protocol_version
    ),
    'details', jsonb_build_object(
        'files', COALESCE(
            (SELECT COUNT(*) FROM inventory i 
             WHERE i.job_run_id = jb.job_run_id AND i.is_directory = FALSE), 0
        ),
        'directories', COALESCE(
            (SELECT COUNT(*) FROM inventory i 
             WHERE i.job_run_id = jb.job_run_id AND i.is_directory = TRUE), 0
        ),
        'operations', COALESCE(
            (SELECT COUNT(*) FROM operations o WHERE o.job_run_id = jb.job_run_id), 0
        ),
        'errors', 0,
        'duration', COALESCE(EXTRACT(EPOCH FROM (jb.end_time - jb.start_time)), 0),
        'job_run_id', jb.job_run_id,
        'created_at', jb.created_at,
        'status', jb.status,
        'capacity', COALESCE(
            (SELECT SUM(i.file_size) FROM inventory i 
             WHERE i.job_run_id = jb.job_run_id AND i.is_directory = FALSE), 0
        )
    ),
    'coc_report', (
        SELECT r.report_data::jsonb 
        FROM reports r 
        WHERE r.job_run_id = jb.job_run_id AND r.report_type = 'MIGRATION_COC'
    )
) ORDER BY jb.created_at DESC        
    )
    INTO summary_data
    FROM aggregated_data jb;

    -- Capture scan iterations
    WITH aggregated_iterations AS (
    -- Pre-filter jobruns efficiently using ANY instead of JSONB expansion
    SELECT 
        ljr.id,
        ljr.start_time,
        ljr.end_time,
        COALESCE(EXTRACT(EPOCH FROM (ljr.end_time - ljr.start_time)), 0) AS duration
    FROM jobrun ljr
    WHERE ljr.job_config_id IN (
            SELECT value::UUID FROM jsonb_array_elements_text(configIds)
    )
)
SELECT jsonb_agg(jsonb_build_object(
    'job_run_id', fjr.id,
    'start_time', fjr.start_time,
    'duration', fjr.duration,
    'delta_files', COALESCE(
        (SELECT COUNT(*) FROM inventory i 
         WHERE i.job_run_id = fjr.id AND i.is_directory = FALSE), 0
        ),
    'delta_directories', COALESCE(
        (SELECT COUNT(*) FROM inventory i 
         WHERE i.job_run_id = fjr.id AND i.is_directory = TRUE), 0
        ),
    'delta_operations', COALESCE(
        (SELECT COUNT(*) FROM operations o 
         WHERE o.job_run_id = fjr.id), 0
        )
    ))
    INTO scan_iterations
    FROM aggregated_iterations fjr;

    -- Insert or update the report
   UPDATE reports 
    SET report_data = jsonb_build_object(
        'job_type_const', job_type_const,
        'job_run_id', job_run_id_param,
        'source_path_id', var_source_path_id,
        'target_path_id', var_target_path_id,
        'summary', summary_data,
        'scan_iterations', scan_iterations,
        'volume_ids', volumeIds,
        'config_ids', configIds 
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