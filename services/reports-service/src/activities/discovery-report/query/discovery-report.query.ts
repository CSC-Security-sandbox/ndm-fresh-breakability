

export const NUMBER_OF_FILES_BY_SIZE = (schema: string) => `
    select  
        case 
            when file_size = 0 then 'File Size: 0B'
            when file_size between 1 and 8192 then 'File Size: <8KiB'
            when file_size between 8193 and 65536 then 'File Size: 8-64KiB'
            when file_size between 65537 and 1048576 then 'File Size: 64KiB-1MiB'
            when file_size between 1048577 and 10485760 then 'File Size: 1-10MiB'
            when file_size between 10485761 and 104857600 then 'File Size: 10-100MiB'
            when file_size between 104857601 and 1073741824 then 'File Size: 100 MiB - 1 GiB'
            when file_size > 1073741824 then 'File Size: 1+ GiB'
            else 'Unknown'
        end as size_group,
        count(1),
        sum(i.file_size) as total_size
    from ${schema}.inventory i 
    where i.job_run_id = $1 and i.is_directory = false
    group by size_group
`;

export const MODIFIED_TIME_DISTRIBUTION = (schema: string) => `
    select
        case
            when modified_time > CURRENT_DATE then 'future'
            when modified_time >= CURRENT_date - interval '1 week' then '0-1 wk'
            when modified_time >= CURRENT_date - interval '1 month' then '1 wk - 1 mo'
            when modified_time >= CURRENT_date - interval '3 months' then '1-3 mo'
            when modified_time >= CURRENT_date - interval '6 months' then '3-6 mo'
            when modified_time >= CURRENT_date - interval '1 year' then '6-12 mo'
            when modified_time >= CURRENT_date - interval '2 year' then '1-2 yr'
            when modified_time >= CURRENT_date - interval '3 year' then '2-3 yr'
            when modified_time >= CURRENT_date - interval '4 year' then '3-4 yr'
            when modified_time >= CURRENT_date - interval '5 year' then '4-5 yr'
            when modified_time >= CURRENT_date - interval '6 year' then '5-6 yr'
            when modified_time >= CURRENT_date - interval '7 year' then '6-7 yr'
            when modified_time >= CURRENT_date - interval '8 year' then '7-8 yr'
            when modified_time >= CURRENT_date - interval '9 year' then '8-9 yr'
            when modified_time >= CURRENT_date - interval '10 year' then '9-10 yr'
            when modified_time < CURRENT_date - interval '10 year' then '10+ yr'
            else 'invalid'
        end as modified_group,
        count(1),
        sum(case when i.is_directory = false then i.file_size else 0 end) as total_size
    from ${schema}.inventory i
    where i.job_run_id = $1
    group by modified_group;
`;

export const CREATED_TIME_DISTRIBUTION = (schema: string) => `
    select
        case
            when birth_time > CURRENT_DATE then 'future'
            when birth_time >= CURRENT_date - interval '1 week' then '0-1 wk'
            when birth_time >= CURRENT_date - interval '1 month' then '1 wk - 1 mo'
            when birth_time >= CURRENT_date - interval '3 months' then '1-3 mo'
            when birth_time >= CURRENT_date - interval '6 months' then '3-6 mo'
            when birth_time >= CURRENT_date - interval '1 year' then '6-12 mo'
            when birth_time >= CURRENT_date - interval '2 year' then '1-2 yr'
            when birth_time >= CURRENT_date - interval '3 year' then '2-3 yr'
            when birth_time >= CURRENT_date - interval '4 year' then '3-4 yr'
            when birth_time >= CURRENT_date - interval '5 year' then '4-5 yr'
            when birth_time >= CURRENT_date - interval '6 year' then '5-6 yr'
            when birth_time >= CURRENT_date - interval '7 year' then '6-7 yr'
            when birth_time >= CURRENT_date - interval '8 year' then '7-8 yr'
            when birth_time >= CURRENT_date - interval '9 year' then '8-9 yr'
            when birth_time >= CURRENT_date - interval '10 year' then '9-10 yr'
            when birth_time < CURRENT_date - interval '10 year' then '10+ yr'
            else 'invalid'
        end as created_group,
        count(1),
        sum(case when i.is_directory = false then i.file_size else 0 end) as total_size
    from ${schema}.inventory i
    where i.job_run_id = $1
    group by created_group;
`;
export const ACCESS_TIME_DISTRIBUTION = (schema: string) => `
    select
        case
            when access_time  > CURRENT_DATE then 'future'
            when access_time >= CURRENT_date - interval '1 week' then '0-1 wk'
            when access_time >= CURRENT_date - interval '1 month' then '1 wk - 1 mo'
            when access_time >= CURRENT_date - interval '3 months' then '1-3 mo'
            when access_time >= CURRENT_date - interval '6 months' then '3-6 mo'
            when access_time >= CURRENT_date - interval '1 year' then '6-12 mo'
            when access_time >= CURRENT_date - interval '2 year' then '1-2 yr'
            when access_time >= CURRENT_date - interval '3 year' then '2-3 yr'
            when access_time >= CURRENT_date - interval '4 year' then '3-4 yr'
            when access_time >= CURRENT_date - interval '5 year' then '4-5 yr'
            when access_time >= CURRENT_date - interval '6 year' then '5-6 yr'
            when access_time >= CURRENT_date - interval '7 year' then '6-7 yr'
            when access_time >= CURRENT_date - interval '8 year' then '7-8 yr'
            when access_time >= CURRENT_date - interval '9 year' then '8-9 yr'
            when access_time >= CURRENT_date - interval '10 year' then '9-10 yr'
            when access_time < CURRENT_date - interval '10 year' then '10+ yr'
            else 'invalid'
        end as access_group,
        count(1),
        sum(case when i.is_directory = false then i.file_size else 0 end) as total_size
    from ${schema}.inventory i
    where i.job_run_id = $1
    group by access_group;
`;

export const DEPTH_DISTRIBUTION = (schema: string) => `
    select
        case
            when depth between 0 and 5 then '0-5'
            when depth between 6 and 10 then '6-10'
            when depth between 11 and 15 then '11-15'
            when depth between 16 and 20 then '16-20'
            when depth between 21 and 100 then '21-100'
            when depth > 100 then '>100'
            else 'unknown'
        end as depth_group,
        count(1),
        sum(i.file_size) as size
    from ${schema}.inventory i
    where i.job_run_id = $1
    group by depth_group;
`;

export const FILE_SYSTEM_DISTRIBUTION = (schema: string) => `
    select
        count(*) as total_count,
        sum(case when is_directory = false then 1 else 0 end) as regular_files,
        sum(case when upper(file_type) = 'SYMBOLIC_LINK' then 1 else 0 end) as symbolic_links,
        sum(case when is_directory = false then file_size else 0 end) as total_space_regular_files,
        sum(case when is_directory = true then file_size else 0 end) as total_space_directories,
        sum(file_size) as total_space_used,
        COALESCE((
            SELECT SUM(link_count - 1)
            FROM (
                SELECT COUNT(1) as link_count
                FROM ${schema}.inventory i2
                WHERE i2.job_run_id = $1
                    AND i2.inode IS NOT NULL
                GROUP BY i2.inode
                HAVING COUNT(1) > 1
            ) AS hard_links
        ), 0) as total_hard_link_files
    from ${schema}.inventory i
    where i.job_run_id = $1
`;

export const EXTENSION_DISTRIBUTION = (schema: string) => `
WITH extension_stats AS (
    SELECT
        i.extension,
        COUNT(*) AS file_count,
        SUM(i.file_size) AS total_size
    FROM ${schema}.inventory i
    WHERE i.is_directory = false
      AND i.job_run_id = $1
      AND i.extension IS NOT NULL
      AND i.extension != ''
    GROUP BY i.extension
),
top_extensions AS (
    SELECT
        extension,
        file_count,
        total_size
    FROM extension_stats
    ORDER BY total_size DESC, file_count DESC, extension
    LIMIT 5
),
extension_totals AS (
    SELECT
        'TOTAL_OF_TOP_5' AS extension,
        SUM(file_count) AS file_count,
        SUM(total_size) AS total_size
    FROM top_extensions
)
SELECT extension, file_count AS count, total_size, 0 AS sort_order
FROM top_extensions
UNION ALL
SELECT extension, file_count AS count, total_size, 1 AS sort_order
FROM extension_totals
ORDER BY sort_order, total_size DESC`;

export const MAX_VALUES = (schema: string) => `
    select
        max(case when is_directory = false then file_size end)::numeric as max_file_size,
        max(depth)::numeric as max_depth,
        max(case when is_directory = false then length(file_name) end)::numeric as max_name_length,
        avg(case when is_directory = false then file_size end)::numeric as avg_file_size,
        avg(depth)::numeric as avg_depth,
        avg(case when is_directory = false then length(file_name) end)::numeric as avg_name_length,
        sum(case when is_directory = true then 1 else 0 end)::numeric as total_directories,
        count(case when is_directory = false then 1 end)::numeric as total_files
    from ${schema}.inventory i
    where i.job_run_id = $1 
`;

/* Top Biggest */

export const TOP_LONGEST_FILE_NAMES = (schema: string) => `
    SELECT i.path,
        LENGTH(SPLIT_PART(i.path, '/', array_length(string_to_array(i.path, '/'), 1))) AS length
    FROM ${schema}.inventory i
    where i.job_run_id = $1 and i.is_directory = false
    ORDER BY length DESC
    LIMIT 5;
`;

export const TOP_LONGEST_DIRECTORY_NAMES = (schema: string) => `
    SELECT i.path,
        LENGTH(SPLIT_PART(i.path, '/', array_length(string_to_array(i.path, '/'), 1))) AS length
    FROM ${schema}.inventory i
    where i.job_run_id = $1 and i.is_directory = true
    ORDER BY length DESC
    LIMIT 5;
`;

export const TOP_DIRECTORY_WITH_MAX_SIZE = (schema: string) => `
    WITH cleaned_inventory AS (
        SELECT
            regexp_replace(regexp_replace(i."path", '/+$', ''), '/[^/]+$', '') AS directory,
            i.file_size
        FROM ${schema}.inventory i
        WHERE i.job_run_id = $1 AND i.is_directory = false
    )
    SELECT directory, SUM(file_size) AS total_size
    FROM cleaned_inventory
    GROUP BY directory
    ORDER BY total_size DESC
    LIMIT 5;
`;

export const TOP_DIRECTORY_WITH_MAX_COUNT_CHILD = (schema: string) => `
    WITH cleaned_inventory AS (
        SELECT
            regexp_replace(regexp_replace(i."path", '/+$', ''), '/[^/]+$', '') AS directory
        FROM ${schema}.inventory i
        WHERE i.job_run_id = $1 AND i.is_directory = false
    )
    SELECT directory, COUNT(*) AS child
    FROM cleaned_inventory
    GROUP BY directory
    ORDER BY child DESC
    LIMIT 5;
`;

export const TOP_LONGEST_DIRECTORY_PATHS = (schema: string) => `
    SELECT
        i.path,
        LENGTH(i.path) AS length
    FROM ${schema}.inventory i
    WHERE i.job_run_id = $1 AND i.is_directory = true
    ORDER BY length DESC
    LIMIT 5;
`;

export const TOP_LONGEST_FILE_PATHS = (schema: string) => `
    SELECT
        i.path,
        LENGTH(i.path) AS length
    FROM ${schema}.inventory i
    WHERE i.job_run_id = $1 AND i.is_directory = false
    ORDER BY length DESC
    LIMIT 5;
`;
export const TOP_BIGGEST_FILE_NAME = (schema: string) => `
    SELECT
        i.path,
        i.file_size  
    FROM ${schema}.inventory i
    WHERE i.job_run_id = $1 AND i.is_directory = false
    ORDER BY file_size DESC
    LIMIT 5;
`;

export const POTENTIAL_8DOT3_CONFLICTS = (schema: string) => `
    WITH all_files AS (
        SELECT 
            i.path,
            i.file_name,
            i.parent_path,
            i.is_directory,
            -- Check if filename is already in 8.3 format (tilde pattern)
            CASE 
                WHEN i.is_directory = true THEN 
                    i.file_name ~ '^[A-Z0-9]{1,6}~[0-9]+$'
                ELSE 
                    i.file_name ~ '^[A-Z0-9]{1,6}~[0-9]+(\.[A-Z0-9]{1,3})?$'
            END as is_shortname_format,
            -- Extract base name for long files (before extension)
            CASE 
                WHEN i.is_directory = true THEN i.file_name
                ELSE SPLIT_PART(i.file_name, '.', 1)
            END as base_name,
            -- Extract extension for files
            CASE 
                WHEN i.is_directory = true THEN ''
                WHEN POSITION('.' IN i.file_name) > 0 THEN 
                    SUBSTRING(i.file_name FROM POSITION('.' IN i.file_name) + 1)
                ELSE ''
            END as extension,
            -- Check if filename needs 8.3 conversion (long name)
            CASE 
                WHEN i.is_directory = true AND LENGTH(i.file_name) > 8 THEN true
                WHEN i.is_directory = false AND (
                    LENGTH(SPLIT_PART(i.file_name, '.', 1)) > 8 OR 
                    (POSITION('.' IN i.file_name) > 0 AND LENGTH(SUBSTRING(i.file_name FROM POSITION('.' IN i.file_name) + 1)) > 3)
                ) THEN true
                ELSE false
            END as needs_shortname
        FROM ${schema}.inventory i 
        WHERE i.job_run_id = $1
    ),
    shortname_patterns AS (
        SELECT 
            parent_path,
            is_directory,
            -- Generate the base short name pattern (without ~number)
            CASE 
                WHEN is_directory = true THEN 
                    UPPER(LEFT(REGEXP_REPLACE(base_name, '[^A-Z0-9]', '', 'g'), 6))
                ELSE 
                    UPPER(LEFT(REGEXP_REPLACE(base_name, '[^A-Z0-9]', '', 'g'), 6)) ||
                    CASE WHEN extension != '' THEN '.' || UPPER(LEFT(extension, 3)) ELSE '' END
            END as base_pattern,
            file_name,
            is_shortname_format,
            needs_shortname
        FROM all_files
    ),
    conflicts AS (
        SELECT 
            s1.parent_path,
            s1.base_pattern,
            s1.is_directory,
            -- Count existing short names with this pattern
            COUNT(CASE WHEN s2.is_shortname_format = true AND s2.file_name ~ ('^' || s1.base_pattern || '~[0-9]+' || 
                CASE WHEN s1.is_directory = false AND POSITION('.' IN s1.base_pattern) > 0 THEN '$' ELSE '$' END)
                THEN 1 END) as existing_shortnames,
            -- Count long names that would generate this pattern
            COUNT(CASE WHEN s2.needs_shortname = true THEN 1 END) as long_names_count,
            ARRAY_AGG(DISTINCT CASE WHEN s2.needs_shortname = true THEN s2.file_name END) 
                FILTER (WHERE s2.needs_shortname = true) as long_filenames,
            ARRAY_AGG(DISTINCT CASE WHEN s2.is_shortname_format = true AND 
                s2.file_name ~ ('^' || s1.base_pattern || '~[0-9]+' || 
                CASE WHEN s1.is_directory = false AND POSITION('.' IN s1.base_pattern) > 0 THEN '$' ELSE '$' END)
                THEN s2.file_name END) 
                FILTER (WHERE s2.is_shortname_format = true) as existing_shortnames_list
        FROM shortname_patterns s1
        JOIN shortname_patterns s2 ON s1.parent_path = s2.parent_path 
            AND s1.is_directory = s2.is_directory 
            AND s1.base_pattern = s2.base_pattern
        WHERE s1.needs_shortname = true OR s1.is_shortname_format = true
        GROUP BY s1.parent_path, s1.base_pattern, s1.is_directory
        HAVING (COUNT(CASE WHEN s2.is_shortname_format = true AND s2.file_name ~ ('^' || s1.base_pattern || '~[0-9]+' || 
            CASE WHEN s1.is_directory = false AND POSITION('.' IN s1.base_pattern) > 0 THEN '$' ELSE '$' END) THEN 1 END) > 0
            AND COUNT(CASE WHEN s2.needs_shortname = true THEN 1 END) > 0)
    )
    SELECT 
        'Real 8.3 Conflicts Detected' as conflict_type,
        COUNT(*)::text as total_conflict_groups,
        SUM(long_names_count)::text as total_files_affected
    FROM conflicts
    WHERE existing_shortnames > 0 AND long_names_count > 0
    UNION ALL
    SELECT 
        CONCAT('Directory: ', parent_path) as conflict_type,
        CONCAT(existing_shortnames, ' existing + ', long_names_count, ' long names') as total_conflict_groups,
        CONCAT('Existing: ', COALESCE(ARRAY_TO_STRING(existing_shortnames_list, ', '), 'none'), 
               ' | Long: ', COALESCE(ARRAY_TO_STRING(long_filenames, ', '), 'none')) as total_files_affected
    FROM conflicts
    WHERE existing_shortnames > 0 AND long_names_count > 0
    ORDER BY conflict_type;
`;

export const JOB_RUN_DETAILS = (schema: string) => `
    select 
        COALESCE(EXTRACT(EPOCH FROM (jr.end_time - jr.start_time))::INT, 0)::TEXT AS stat_value,
        v.volume_path,
        jr.status,
        c.config_name,
        fsrv.protocol
    from ${schema}.jobRun jr
    inner join ${schema}.jobconfig jc on jc.id = jr.job_config_id
    inner join ${schema}.volume v on v.id = jc.source_path_id
    inner join ${schema}.file_server fsrv on fsrv.id = file_server_id
    inner join ${schema}.config c on c.id = fsrv.config_id
    where jr.id = $1
`;
