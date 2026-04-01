-- ============================================================
-- generate_inventory_csv
-- ============================================================
-- Writes a COC/Migrate inventory report directly to a CSV file
-- on the host mount shared between the reports-service and
-- postgres containers (/reports → host /data/reports).
--
-- PREREQUISITE — run once as the postgres superuser before
-- applying this changeset (or at cluster init time):
--
--   GRANT pg_write_server_files TO dmadmin;
--
-- This grants the app role the right to COPY TO a server-side
-- file without needing full superuser privileges.
-- ============================================================

CREATE OR REPLACE PROCEDURE generate_inventory_csv(
    IN p_job_run_id  UUID,
    IN p_file_path   TEXT,
    IN p_schema_name TEXT,
    IN p_job_type    TEXT
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_protocol   TEXT;
    v_job_type   TEXT;
    v_is_migrate BOOLEAN;
    v_columns    TEXT;
    v_select_sql TEXT;
BEGIN
    -- Security: only allow writes inside the shared reports mount
    IF p_file_path NOT LIKE '/reports/%' THEN
        RAISE EXCEPTION
            'File path % is not within the allowed /reports/ directory',
            p_file_path;
    END IF;

    -- Boost sort memory for this transaction so large DISTINCT ON
    -- operations stay in memory and don't spill to disk
    SET LOCAL work_mem = '256MB';

    v_job_type := UPPER(TRIM(p_job_type));

    -- ── CutOver ──────────────────────────────────────────────
    IF v_job_type = 'CUT_OVER' THEN

        v_select_sql := format(
            'WITH all_related_jobs AS (
                SELECT jr.id, jr.start_time
                FROM %I.jobrun jr
                JOIN %I.jobconfig jc ON jr.job_config_id = jc.id
                WHERE (jc.source_path_id, jc.target_path_id) = (
                    SELECT jc2.source_path_id, jc2.target_path_id
                    FROM %I.jobrun jr2
                    JOIN %I.jobconfig jc2 ON jr2.job_config_id = jc2.id
                    WHERE jr2.id = %L::uuid
                )
                ORDER BY jr.start_time DESC
            ),
            latest_file_versions AS (
                SELECT DISTINCT ON (i.path)
                    COALESCE(v_source.volume_path, '''') || i.path AS "Source Path",
                    v_target.volume_path || i.path                 AS "Destination Path",
                    i.source_checksum                              AS "Source Checksum",
                    i.target_checksum                              AS "Destination Checksum",
                    CASE WHEN i.source_checksum = i.target_checksum
                         THEN ''yes'' ELSE ''no'' END              AS "ChecksumMatchStatus",
                    TO_CHAR(i.checksum_time AT TIME ZONE ''UTC'',
                            ''Dy Mon DD YYYY HH24:MI:SS'')         AS "Checksum Generated Timestamp (UTC)",
                    CASE
                        WHEN UPPER(TRIM(COALESCE(i.file_type, ''''))) = ''SYMBOLIC_LINK'' THEN ''softlink''
                        WHEN i.is_directory THEN ''directory''
                        ELSE ''file''
                    END                                            AS "Type",
                    FIRST_VALUE(i.is_deleted) OVER (
                        PARTITION BY i.path ORDER BY arj.start_time DESC
                    )                                              AS latest_deletion_status
                FROM %I.inventory i
                JOIN  all_related_jobs arj ON i.job_run_id = arj.id
                JOIN  %I.jobrun jr         ON jr.id        = i.job_run_id
                JOIN  %I.jobconfig jc      ON jc.id        = jr.job_config_id
                LEFT JOIN %I.volume v_source ON jc.source_path_id = v_source.id
                LEFT JOIN %I.volume v_target ON jc.target_path_id = v_target.id
                WHERE i.is_directory = false
                ORDER BY i.path,
                         CASE WHEN i.is_deleted = true THEN 1 ELSE 0 END,
                         CASE WHEN i.source_checksum IS NOT NULL
                               AND i.target_checksum IS NOT NULL THEN 0 ELSE 1 END,
                         arj.start_time DESC
            )
            SELECT "Source Path", "Destination Path",
                   "Source Checksum", "Destination Checksum",
                   "ChecksumMatchStatus",
                   "Checksum Generated Timestamp (UTC)", "Type"
            FROM latest_file_versions
            WHERE latest_deletion_status = false
               OR latest_deletion_status IS NULL
            ORDER BY "Source Path"',
            -- format args (10 schema names + 1 UUID literal)
            p_schema_name, p_schema_name,   -- all_related_jobs: jobrun jr, jobconfig jc
            p_schema_name, p_schema_name,   -- subquery: jobrun jr2, jobconfig jc2
            p_job_run_id,                   -- %L — UUID value
            p_schema_name,                  -- inventory i
            p_schema_name,                  -- jobrun jr (latest_file_versions)
            p_schema_name,                  -- jobconfig jc
            p_schema_name,                  -- volume v_source
            p_schema_name                   -- volume v_target
        );

    -- ── Migrate / CoC ────────────────────────────────────────
    ELSE

        -- Resolve source protocol once (NFS default)
        EXECUTE format(
            'SELECT COALESCE(UPPER(fs.protocol), %L)
             FROM %I.jobrun jr
             JOIN %I.jobconfig  jc ON jc.id  = jr.job_config_id
             JOIN %I.volume      v  ON v.id   = jc.source_path_id
             JOIN %I.file_server fs ON fs.id  = v.file_server_id
             WHERE jr.id = %L::uuid',
            'NFS',
            p_schema_name, p_schema_name, p_schema_name, p_schema_name,
            p_job_run_id
        ) INTO v_protocol;

        v_protocol   := COALESCE(v_protocol, 'NFS');
        v_is_migrate := (v_job_type = 'MIGRATE');

        -- Base columns shared by Migrate and CoC
        v_columns :=
             'i.source_checksum AS "Source Checksum"'
          || ',i.target_checksum AS "Destination Checksum"'
          || ',CASE WHEN i.is_directory THEN ''yes'''
          || '      ELSE CASE WHEN i.source_checksum = i.target_checksum'
          || '                THEN ''yes'' ELSE ''no'' END'
          || '  END AS "ChecksumMatchStatus"'
          || ',TO_CHAR(i.checksum_time AT TIME ZONE ''UTC'','
          || '         ''Dy Mon DD YYYY HH24:MI:SS'')'
          || '  AS "Checksum Generated Timestamp (UTC)"';

        -- CoC-only status columns
        IF NOT v_is_migrate THEN
            v_columns := v_columns
              || ',COALESCE(i.copy_content_status,    '''') AS "CopyContentStatus"'
              || ',COALESCE(i.stamp_meta_data_status, '''') AS "StampMetaDataStatus"';
        END IF;

        -- Type + size (common)
        v_columns := v_columns
          || ',CASE'
          || '   WHEN UPPER(TRIM(COALESCE(i.file_type, ''''))) = ''SYMBOLIC_LINK'' THEN ''softlink'''
          || '   WHEN i.is_directory THEN ''directory'''
          || '   ELSE ''file'''
          || '  END AS "Type"'
          || ',i.file_size AS "Size in Bytes"';

        -- Protocol-specific metadata columns
        IF v_protocol = 'SMB' THEN
            v_columns := v_columns
              || ',(regexp_match(i.source_meta->>''sid'', ''Owner: (S-[0-9-]+)''))[1]  AS "Source Owner SID"'
              || ',(regexp_match(i.source_meta->>''sid'', ''Group: (S-[0-9-]+)''))[1]  AS "Source Group SID"'
              || ',regexp_replace('
              || '    substring(i.source_meta->>''sid'' FROM ''ACE in source:.*$''),'
              || '    ''ACE in source: '', '''', ''g'')                                AS "Source ACE Details"'
              || ',(regexp_match(i.target_meta->>''sid'', ''Owner: (S-[0-9-]+)''))[1]  AS "Target Owner SID"'
              || ',(regexp_match(i.target_meta->>''sid'', ''Group: (S-[0-9-]+)''))[1]  AS "Target Group SID"'
              || ',regexp_replace('
              || '    substring(i.target_meta->>''sid'' FROM ''ACE in target:.*$''),'
              || '    ''ACE in target: '', '''', ''g'')                                AS "Target ACE Details"';
        ELSE
            v_columns := v_columns
              || ',i.source_meta->>''uid''        AS "Source UID"'
              || ',i.target_meta->>''uid''        AS "Destination UID"'
              || ',i.source_meta->>''gid''        AS "Source GID"'
              || ',i.target_meta->>''gid''        AS "Destination GID"'
              || ',i.source_meta->>''permission'' AS "Source Unix Permissions"'
              || ',i.target_meta->>''permission'' AS "Destination Unix Permissions"';
        END IF;

        v_select_sql := format(
            'SELECT DISTINCT ON (i.path)
                COALESCE(v_source.volume_path, '''') || i.path AS "Source Path",
                v_target.volume_path || i.path                 AS "Destination Path",
                %s
             FROM %I.inventory i
             LEFT JOIN %I.jobrun      ON jobrun.id         = i.job_run_id
             LEFT JOIN %I.jobconfig jc ON jc.id            = jobrun.job_config_id
             LEFT JOIN %I.volume v_source ON jc.source_path_id = v_source.id
             LEFT JOIN %I.volume v_target ON jc.target_path_id = v_target.id
             WHERE i.job_run_id = %L::uuid
               AND (i.is_deleted = false OR i.is_deleted IS NULL)
             ORDER BY i.path, i.updated_at DESC, i.created_at DESC',
            v_columns,
            p_schema_name,  -- inventory i
            p_schema_name,  -- jobrun
            p_schema_name,  -- jobconfig jc
            p_schema_name,  -- volume v_source
            p_schema_name,  -- volume v_target
            p_job_run_id    -- %L — UUID value
        );

    END IF;

    -- Hand off to PostgreSQL's native CSV writer — no Node.js round-trip
    EXECUTE format(
        'COPY (%s) TO %L WITH (FORMAT CSV, HEADER)',
        v_select_sql,
        p_file_path
    );

END;
$procedure$;
