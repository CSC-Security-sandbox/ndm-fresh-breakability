-- DROP PROCEDURE migrateadmin.generate_migration_coc_report(uuid, text);
CREATE OR REPLACE PROCEDURE migrateadmin.generate_migration_coc_report(IN job_run_id_param uuid, IN output_dir text)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    output_file TEXT;
    report_data JSONB;
BEGIN
    output_file := format('%s/%s-migration_coc-report.csv', output_dir, job_run_id_param);
    CREATE TEMP TABLE temp_migration_coc_report AS
    SELECT
        "path",
        CASE 
            WHEN source_checksum = target_checksum THEN 'success'
            ELSE 'fail'
        END AS status,
        CASE 
            WHEN is_directory THEN 'd'
            ELSE 'f'
        END AS type,
        file_size,
        source_checksum,
        target_checksum,
        to_char(modified_time, 'YYYY-MM-DD HH24:MI:SS') AS src_cts,
        to_char(access_time, 'YYYY-MM-DD HH24:MI:SS') AS tgt_cts
    FROM inventory
    WHERE job_run_id = job_run_id_param;

    -- Export to CSV
    EXECUTE format(
        'COPY temp_migration_coc_report TO %L WITH CSV HEADER',
        output_file
    );

    -- Drop the temporary table
    DROP TABLE temp_migration_coc_report;

    -- Construct the JSON object with the file path
    report_data := jsonb_build_object('report_path', output_file);

    -- Insert the JSON data into the reports table
    INSERT INTO migrateadmin.reports(report_data, report_type, job_run_id)
    VALUES (report_data, 'MIGRATION_COC', job_run_id_param);
    RAISE NOTICE 'Report data % inserted into reports table.', report_data;
END;
$procedure$
;