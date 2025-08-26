

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
        sum(file_size) as total_space_used
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
