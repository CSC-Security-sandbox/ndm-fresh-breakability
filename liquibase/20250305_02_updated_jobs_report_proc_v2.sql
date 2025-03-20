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
    jobconfig_id UUID;
    paths JSONB;
    last_job_run JSONB;
    last_iteration JSONB;
    last_errors JSONB;
    cutover_jobs_data JSONB;
    scan_iterations JSONB;
BEGIN
    EXECUTE format('SET search_path TO %I', schema_name);

    -- Input to this procedure is job_run_id of a jobrun which is a CUT_OVER job type
    -- This procedure will generate a report for the given job_run_id
    -- 1. Fetch jobconfig_id for the given job_run_id
    -- 2. List source_path_id and target_path_id for the given jobconfig_id
    -- 3. Fetch the jobconfig where source_path_id and target_path_id are in the list and job_type is MIGRATION
    -- 4. Fetch the last job run details for the jobconfig_id
    -- 5. Fetch summary data for the jobconfig_id
    -- 6. Fetch last iteration data for the job_run_id
    -- 7. Fetch errors for the job_run_id
    -- 8. Fetch cutover jobs for the jobconfig_id
    -- 9. Fetch aggregated scan iteration data for the jobconfig_id


     -- Fetch jobconfig_id, source_path_id, and target_path_id for the given job_run_id
    SELECT jr.job_config_id, jc.source_path_id, jc.target_path_id
    INTO cut_over_config_id, var_source_path_id, var_target_path_id
    FROM jobrun jr
    LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
    WHERE jr.id = job_run_id_param;

    -- Fetch the jobconfig where source_path_id and target_path_id match and job_type is MIGRATION
    SELECT id 
    INTO jobconfig_id
    FROM jobconfig jc
    WHERE jc.source_path_id = var_source_path_id AND jc.target_path_id = var_target_path_id AND jc.job_type = 'MIGRATE';

    -- Fetch jobconfig_id as UUID for the given job_run_id (checked correct logic)
    -- SELECT jc.id 
    -- INTO jobconfig_id
    -- FROM jobrun jr
    -- JOIN jobconfig jc ON jc.id = jr.job_config_id
    -- WHERE jr.id = job_run_id_param;

    -- -- Fetch last job run details
    SELECT jsonb_build_object(
        'id', last_jr.id
    )
    INTO last_job_run
    FROM jobrun last_jr
    WHERE last_jr.job_config_id = jobconfig_id
    ORDER BY last_jr.created_at DESC
    LIMIT 1;

    -- Fetch summary data (aggregated for each jobrun)
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
            r.report_data::jsonb as coc_report
        FROM jobrun jr
        LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
        LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
        LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
        LEFT JOIN file_server fs ON v_source.file_server_id = fs.id
        LEFT JOIN inventory i ON i.job_run_id = jr.id
        LEFT JOIN operations o ON o.job_run_id = jr.id
        LEFT JOIN config cc ON fs.config_id = cc.id
        LEFT JOIN reports r ON jr.id = r.job_run_id AND r.report_type = 'MIGRATION_COC'
        WHERE jr.job_config_id = jobconfig_id AND jc.job_type in ('MIGRATE', 'CUT_OVER')
        GROUP BY 
            jr.id, jc.id, 
            v_source.id, v_target.id, 
            cc.config_name, fs.protocol, fs.protocol_version, 
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
            'job_type', a.job_type,
            'job_run_id', a.job_run_id,
            'created_at', a.created_at,
            'status', a.status,
            'iteration_number', a.iteration_number,
            'job_config_id', a.job_config_id,
            'capacity', a.capacity
        ),
        'coc_report', a.coc_report
    ) ORDER BY a.created_at DESC)
    INTO summary_data
    FROM aggregated_data a;

    -- Fetch last iteration data
   WITH last_iteration_data AS (
        SELECT 
            ljr.id AS job_run_id,
            ljr.start_time,
            COUNT(DISTINCT CASE 
                WHEN last_inventory.is_directory = FALSE 
                AND last_inventory.volume_id = ljr.job_config_id
                THEN last_inventory.id 
            END) AS files,
            COALESCE(EXTRACT(EPOCH FROM (ljr.end_time - ljr.start_time)), 0) AS duration,
            COUNT(DISTINCT CASE 
                WHEN last_inventory.is_directory = TRUE 
                THEN last_inventory.id 
            END) AS directories,
            COUNT(DISTINCT last_operations.id) AS operations,
            COUNT(last_operations.error_details) AS ljr_errors,
            COUNT(DISTINCT CASE 
                WHEN last_operations.operation_type = 'COPY' 
                THEN last_operations.id 
            END) AS capacity_copied,
            COUNT(DISTINCT CASE 
                WHEN last_operations.operation_type = 'DELETE' 
                THEN last_operations.id 
            END) AS capacity_deleted
        FROM jobrun AS ljr
        LEFT JOIN inventory last_inventory ON last_inventory.job_run_id = ljr.id
        LEFT JOIN operations last_operations ON last_operations.job_run_id = ljr.id
        WHERE ljr.id = (last_job_run->>'id')::UUID -- Fix: Extract ID from JSONB variable
        GROUP BY ljr.id, ljr.start_time, ljr.end_time
    )
    SELECT jsonb_build_object (
        'job_run_id', job_run_id,
        'start_time', start_time,
        'duration', duration,
        'delta_files', files,
        'delta_directories', directories,
        'delta_operations', operations,
        'errors', ljr_errors,
        'status', (SELECT status FROM jobrun WHERE id = job_run_id),
        'message', 'Pick scan items from first iteration',
        'capacity_copied', capacity_copied,
        'capacity_deleted', capacity_deleted,
        'speed_test_data', COALESCE(jsonb_build_object(), '{}'::jsonb)
    )
    INTO last_iteration
    FROM last_iteration_data
    LIMIT 1;



    -- Capture errors for last job run id from operation_errors table
    SELECT jsonb_build_object(
        'operation_id', oe.operation_id,
        'permission_denied', COUNT(CASE WHEN oe.error_code = 'OP_PERMISSION_DENIED' THEN 1 END),
        'file_not_found', COUNT(CASE WHEN oe.error_code = 'OP_FILE_NOT_FOUND' THEN 1 END),
        'out_of_space', COUNT(CASE WHEN oe.error_code = 'OP_OUT_OF_SPACE' THEN 1 END),
        'in_use', COUNT(CASE WHEN oe.error_code = 'OP_IN_USE' THEN 1 END),
        'timed_out', COUNT(CASE WHEN oe.error_code = 'OP_TIMED_OUT' THEN 1 END),
        'network_error', COUNT(CASE WHEN oe.error_code = 'OP_NETWORK_ERROR' THEN 1 END),
        'modified_externally', COUNT(CASE WHEN oe.error_code = 'OP_MODIFIED_EXTERNALLY' THEN 1 END),
        'others', COUNT(CASE WHEN oe.error_code NOT IN (
            'OP_PERMISSION_DENIED', 'OP_FILE_NOT_FOUND', 'OP_OUT_OF_SPACE',
            'OP_IN_USE', 'OP_TIMED_OUT', 'OP_NETWORK_ERROR', 'OP_MODIFIED_EXTERNALLY'
        ) THEN 1 END)
    )
    INTO last_errors
    FROM operation_errors oe
    WHERE oe.operation_id IN (
        SELECT id FROM operations op WHERE op.job_run_id = '5e62d89d-5bdc-437e-b268-694b5257b610'
    )
    GROUP BY oe.operation_id;
    
    -- Capture cut_over jobs data similar to summary data
    WITH cut_over_data as (
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
            r.report_data::jsonb as coc_report
        FROM jobrun jr
        LEFT JOIN jobconfig jc ON jc.id = jr.job_config_id
        LEFT JOIN volume v_source ON v_source.id = jc.source_path_id
        LEFT JOIN volume v_target ON v_target.id = jc.target_path_id
        LEFT JOIN file_server fs ON v_source.file_server_id = fs.id
        LEFT JOIN inventory i ON i.job_run_id = jr.id
        LEFT JOIN operations o ON o.job_run_id = jr.id
        LEFT JOIN config cc ON fs.config_id = cc.id
        LEFT JOIN reports r ON jr.id = r.job_run_id AND r.report_type = 'MIGRATION_COC'
        WHERE jr.job_config_id = cut_over_config_id AND jc.job_type = 'CUT_OVER'
        GROUP BY 
            jr.id, jc.id, 
            v_source.id, v_target.id, 
            cc.config_name, fs.protocol, fs.protocol_version, 
            jr.start_time, jr.end_time, jr.created_at, jr.status, jr.iteration_number, r.report_data
    )

        SELECT jsonb_agg(jsonb_build_object(
        'source', jsonb_build_object(
            'path_id', c.volume_source_path_id,  
            'path', c.source_path,
            'file_server', c.file_server,
            'protocol', c.protocol,
            'protocol_version', c.protocol_version,
            'job_type', c.job_type
        ),
        'target', jsonb_build_object(
            'path_id', c.volume_target_path_id,  
            'path', c.target_path,
            'file_server', c.file_server,
            'capacity', '-',
            'protocol', c.protocol,
            'protocol_version', c.protocol_version
        ),
        'details', jsonb_build_object(
            'files', c.files,
            'directories', c.directories,
            'operations', c.operations,
            'errors', c.errors,
            'duration', COALESCE(EXTRACT(EPOCH FROM (c.end_time - c.start_time)), 0),
            'job_type', c.job_type,
            'job_run_id', c.job_run_id,
            'created_at', c.created_at,
            'status', c.status,
            'iteration_number', c.iteration_number,
            'job_config_id', c.job_config_id,
            'capacity', c.capacity
        ),
        'coc_report', c.coc_report
    ) ORDER BY c.created_at DESC)
    INTO cutover_jobs_data
    FROM cut_over_data c;


    -- WITH cutover_job AS (
    --     SELECT id, job_config_id, start_time, end_time
    --     FROM jobrun
    --     WHERE job_config_id = jobconfig_id
    --     AND status = 'COMPLETED'
    --     ORDER BY created_at DESC  -- Get the most recent one
    --     LIMIT 1
    -- ),
    -- cutover_jobs_details AS (
    --     SELECT 
    --         cutover_jobconfig.id AS job_config_id,
    --         cutover_job_run.id AS job_run_id,
    --         cutover_job_run.start_time, -- This column must be included in GROUP BY
    --         COUNT(DISTINCT CASE 
    --             WHEN scan_iteration_inventory.is_directory = FALSE 
    --             AND scan_iteration_inventory.volume_id = cutover_jobconfig.source_path_id
    --             THEN scan_iteration_inventory.id 
    --         END) AS s_files,
    --         COALESCE(EXTRACT(EPOCH FROM (cutover_job_run.end_time - cutover_job_run.start_time)), 0) AS s_duration,
    --         COUNT(DISTINCT CASE 
    --             WHEN scan_iteration_inventory.is_directory = TRUE 
    --             THEN scan_iteration_inventory.id 
    --         END) AS s_directories,
    --         COUNT(DISTINCT scan_iteration_operations.id) AS s_operations,
    --         COUNT(scan_iteration_operations.error_details) AS s_errors
    --     FROM jobconfig cutover_jobconfig
    --     LEFT JOIN cutover_job cutover_job_run ON cutover_job_run.job_config_id = cutover_jobconfig.id
    --     LEFT JOIN inventory scan_iteration_inventory ON scan_iteration_inventory.job_run_id = cutover_job_run.id
    --     LEFT JOIN operations scan_iteration_operations ON scan_iteration_operations.job_run_id = cutover_job_run.id
    --     WHERE cutover_jobconfig.id = cut_over_config_id and cutover_jobconfig.job_type = 'CUT_OVER'
    --     GROUP BY 
    --         cutover_jobconfig.id, 
    --         cutover_job_run.id, 
    --         cutover_job_run.start_time,  -- **Added to GROUP BY**
    --         cutover_job_run.end_time     -- **Added to GROUP BY**
    -- )
    -- SELECT COALESCE(jsonb_agg(
    --         jsonb_build_object(
    --             'job_config_id', job_config_id,
    --             'job_run_id', job_run_id,
    --             'start_time', start_time,
    --             's_files', s_files,
    --             's_duration', s_duration,
    --             's_directories', s_directories,
    --             's_operations', s_operations,
    --             's_errors', s_errors
    --         )
    --     ), '[]'::JSONB)
    -- INTO cutover_jobs_data
    -- FROM cutover_jobs_details;

    -- Capture aggregated scan iteration data similar to last iteration data
    WITH aggregated_data AS (
        SELECT
            ljr.id AS job_run_id,
            ljr.start_time,
            COUNT(DISTINCT CASE 
                WHEN last_inventory.is_directory = FALSE 
                AND last_inventory.volume_id = ljr.job_config_id
                THEN last_inventory.id 
            END) AS files,
            COALESCE(EXTRACT(EPOCH FROM (ljr.end_time - ljr.start_time)), 0) AS duration,
            COUNT(DISTINCT CASE 
                WHEN last_inventory.is_directory = TRUE 
                THEN last_inventory.id 
            END) AS directories,
            COUNT(DISTINCT last_operations.id) AS operations,
            COUNT(last_operations.error_details) AS ljr_errors,
            COUNT(DISTINCT CASE 
                WHEN last_operations.operation_type = 'COPY' 
                THEN last_operations.id 
            END) AS capacity_copied,
            COUNT(DISTINCT CASE 
                WHEN last_operations.operation_type = 'DELETE' 
                THEN last_operations.id 
            END) AS capacity_deleted
        FROM jobrun AS ljr
        LEFT JOIN inventory last_inventory ON last_inventory.job_run_id = ljr.id
        LEFT JOIN operations last_operations ON last_operations.job_run_id = ljr.id
        WHERE ljr.job_config_id = jobconfig_id
        GROUP BY ljr.id, ljr.start_time, ljr.end_time
    )
    SELECT jsonb_agg(
            jsonb_build_object(
                'job_run_id', job_run_id,
                'start_time', start_time,
                'duration', duration,
                'delta_files', files,
                'delta_directories', directories,
                'delta_operations', operations,
                'errors', ljr_errors,
                'status', (SELECT status FROM jobrun WHERE id = job_run_id),
                'message', 'Pick scan items from first iteration',
                'capacity_copied', capacity_copied,
                'capacity_deleted', capacity_deleted,
                'speed_test_data', COALESCE(jsonb_build_object(), '{}'::jsonb)
            )
        )
    INTO scan_iterations
    FROM aggregated_data;

    UPDATE reports 
    SET report_data = jsonb_build_object(
        'job_type_const', job_type_const,
        'job_run_id', job_run_id_param,
        'job_config_id', jobconfig_id,
        'source_path_id', var_source_path_id,
        'target_path_id', var_target_path_id,
        'summary', summary_data,
        'last_iteration', last_iteration,
        'last_errors', last_errors,
        'cutovers', cutover_jobs_data,
        'scan_iterations', scan_iterations
    )
    WHERE job_run_id = job_run_id_param AND report_type = job_type_const;
    -- Insert report data

    IF NOT FOUND THEN
    INSERT INTO reports (job_run_id, report_type, report_data)
    VALUES (job_run_id_param, job_type_const, jsonb_build_object(
        'job_type_const', job_type_const,
        'job_run_id', job_run_id_param,
        'job_config_id', jobconfig_id,
        'source_path_id', var_source_path_id,
        'target_path_id', var_target_path_id,
        'summary', summary_data,
        'last_iteration', last_iteration,
        'last_errors', last_errors,
        'cutovers', cutover_jobs_data,
        'scan_iterations', scan_iterations
    ));
    END IF;

END;
$procedure$;
