-- DROP PROCEDURE datamigrator.generate_discovery_report(uuid);

CREATE OR REPLACE PROCEDURE generate_discovery_report(
	IN jobrunid uuid,
	IN schema_name TEXT
)
 LANGUAGE plpgsql
AS $procedure$
declare
aggregated_json JSONB := '[]';

temp_json JSONB;

begin
-- Create a temporary table to store the categorized file data
EXECUTE format('SET search_path TO %I', schema_name);
drop table if exists temp_categorized_files;

create temp table temp_categorized_files as
select
    case
        when file_size = 0 then 'File Size: 0B'
        when file_size between 1 and 8192 then 'File Size: <8KiB'
        when file_size between 8193 and 65536 then 'File Size: 8-64KiB'
        when file_size between 65537 and 1048576 then 'File Size: 64KiB-1MiB'
        when file_size between 1048577 and 10485760 then 'File Size: 1-10MiB'
        when file_size between 10485761 and 104857600 then 'File Size: 10-100MiB'
        WHEN file_size BETWEEN 104857601 AND 1073741824 THEN 'File Size: 100 MiB - 1 GiB'
        WHEN file_size > 1073741824 THEN 'File Size: 1+ GiB'
        end as size_group,
    file_size,
    depth,
    is_directory,
    file_name,
    --cast(left(modified_time,
    --19) as TIMESTAMP) as modified_time,
    --cast(left(creation_time,
    --19) as TIMESTAMP) as creation_time,
    --cast(left(access_time,
    --19) as TIMESTAMP) as access_time,
    CAST(modified_time AS TIMESTAMP) AS modified_time,
    CAST(birth_time AS TIMESTAMP) AS creation_time,
    CAST(access_time AS TIMESTAMP) AS access_time,
    parent_path,
    volume_id as path_id,
    path,
    file_type
from
    inventory
where
    job_run_id = jobrunid;
-- Perform aggregation directly using subqueries
select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Number of Files',
                    'sub_category',
                    'File Count with ' || size_group,
                    'valueType',
                    'count',
                    'value',
                    file_count
            )
    )
into
    temp_json
from
    (
        select
            size_group,
            COUNT(*) as file_count
        from
            temp_categorized_files
        group by
            size_group
    ) as file_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Modified',
                    'sub_category',
                    'File Count with Modification Time ' || date_group,
                    'valueType',
                    'count',
                    'value',
                    file_count
            )
    )
into
    temp_json
from
    (
        select
            modified_group as date_group,
            COUNT(*) as file_count
        from
            (
                select
                    case
                        WHEN modified_time > CURRENT_DATE THEN 'future'
                        WHEN modified_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN modified_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN modified_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as modified_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            modified_group) as modified_date_metrics;

aggregated_json := aggregated_json || temp_json;
   raise notice 'Aggregated Data: second %',
aggregated_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Modified',
                    'sub_category',
                    'Capacity With Modification Time ' || date_group,
                    'valueType',
                    'size',
                    'value',
                    total_space
            )
    )
into
    temp_json
from
    (
        select
            modified_group as date_group,
            sum(file_size) as total_space
        from
            (
                select
                    case
                        WHEN modified_time > CURRENT_DATE THEN 'future'
                        WHEN modified_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN modified_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN modified_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN modified_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN modified_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as modified_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            modified_group) as modified_date_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Created',
                    'sub_category',
                    'File Count with Creation Time '|| date_group,
                    'valueType',
                    'count',
                    'value',
                    file_count
            )
    )
into
    temp_json
from
    (
        select
            created_group as date_group,
            COUNT(*) as file_count
        from
            (
                select
                    case
                        WHEN creation_time > CURRENT_DATE THEN 'future'
                        WHEN creation_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN creation_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN creation_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as created_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            created_group) as created_date_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Created',
                    'sub_category',
                    'Capacity  with Creation Time '|| date_group,
                    'valueType',
                    'size',
                    'value',
                    total_space
            )
    )
into
    temp_json
from
    (
        select
            created_group as date_group,
            SUM(file_size) as total_space
        from
            (
                select
                    case
                        WHEN creation_time > CURRENT_DATE THEN 'future'
                        WHEN creation_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN creation_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN creation_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN creation_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN creation_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as created_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            created_group) as created_date_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Access Time',
                    'sub_category',
                    'File Count with Access Time '|| date_group,
                    'valueType',
                    'count',
                    'value',
                    file_count
            )
    )
into
    temp_json
from
    (
        select
            created_group as date_group,
            COUNT(*) as file_count
        from
            (
                select
                    case
                        WHEN access_time > CURRENT_DATE THEN 'future'
                        WHEN access_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN access_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN access_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN access_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN access_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN access_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN access_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN access_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN access_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN access_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN access_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN access_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN access_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN access_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN access_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as created_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            created_group) as created_date_metrics;

aggregated_json := aggregated_json || temp_json;

-- Add Top File Extensions category with combined file counts and sizes
select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Top 5 File Extensions',
                    'sub_category',
                    '.' || COALESCE(file_extension, 'none'),
                    'valueType',
                    'string',
                    'value',
                    'size(' || total_size || ');count(' || file_count || ')'
            )
    )
into
    temp_json
from
    (
        select
            SUBSTRING(file_name FROM '\.([^\.]+)$') as file_extension,
            COUNT(*) as file_count,
            SUM(file_size) as total_size
        from
            temp_categorized_files
        where
            is_directory = false
        group by
            file_extension
        order by
            total_size desc
    ) as extension_metrics;

aggregated_json := aggregated_json || temp_json;
-- Top File Extensions category

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Access Time',
                    'sub_category',
                    'Capacity with Access Time '|| date_group,
                    'valueType',
                    'size',
                    'value',
                    total_space
            )
    )
into
    temp_json
from
    (
        select
            created_group as date_group,
            SUM(file_size) as total_space
        from
            (
                select
                    CASE
                        WHEN access_time > CURRENT_DATE THEN 'future'
                        WHEN access_time >= CURRENT_DATE - interval '1 week' THEN '0-1 wk'
                    WHEN access_time >= CURRENT_DATE - interval '1 month' THEN '1 wk - 1 mo'
                    WHEN access_time >= CURRENT_DATE - interval '3 months' THEN '1-3 mo'
                    WHEN access_time >= CURRENT_DATE - interval '6 months' THEN '3-6 mo'
                    WHEN access_time >= CURRENT_DATE - interval '1 year' THEN '6-12 mo'
                    WHEN access_time >= CURRENT_DATE - interval '2 year' THEN '1-2 yr'
                    WHEN access_time >= CURRENT_DATE - interval '3 year' THEN '2-3 yr'
                    WHEN access_time >= CURRENT_DATE - interval '4 year' THEN '3-4 yr'
                    WHEN access_time >= CURRENT_DATE - interval '5 year' THEN '4-5 yr'
                    WHEN access_time >= CURRENT_DATE - interval '6 year' THEN '5-6 yr'
                    WHEN access_time >= CURRENT_DATE - interval '7 year' THEN '6-7 yr'
                    WHEN access_time >= CURRENT_DATE - interval '8 year' THEN '7-8 yr'
                    WHEN access_time >= CURRENT_DATE - interval '9 year' THEN '8-9 yr'
                    WHEN access_time >= CURRENT_DATE - interval '10 year' THEN '9-10 yr'
                    WHEN access_time < CURRENT_DATE - interval '10 year' THEN '10+ yr'
                    ELSE 'invalid'
                    end as created_group,
                    file_size
                from
                    temp_categorized_files) as date_metrics
        group by
            created_group) as created_date_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category', 'Depth',
                    'sub_category', 'Files and Directory with depth: ' || COALESCE(depth_group::TEXT, 'Unknown'),
                    'valueType','count',
                    'value', depth_count
            )
    )
into
    temp_json
from
    (
        select
            case
                when depth between 0 and 5 then '0-5'
                when depth between 6 and 10 then '6-10'
                when depth between 11 and 15 then '11-15'
                when depth between 16 and 20 then '16-20'
                when depth between 21 and 100 then '21-100'
                when depth > 100 then '>100'
                end as depth_group,
            COUNT(*) as depth_count
        from
            temp_categorized_files
        group by
            depth_group) as depth_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category', 'Depth',
                    'sub_category', 'Total Sum Of Depth',
                    'valueType', 'count',
                    'value', sunOfDepth
            )
    )
into
    temp_json
from
    (
        select
            SUM(depth) as sunOfDepth
        from
            temp_categorized_files
    ) as depth_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Space Used',
                    'sub_category',
                    'Capacity with ' || size_group,
                    'valueType',
                    'size',
                    'value',
                    total_space
            )
    )
into
    temp_json
from
    (
        select
            size_group,
            COUNT(*) as file_count,
            SUM(file_size) as total_space
        from
            temp_categorized_files
        group by
            size_group
    ) as file_space_metrics;

aggregated_json := aggregated_json || temp_json;

select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'File System Stats',
                    'sub_category',
                    sub_category,
                    'valueType',
                    valueType,
                    'value',
                    count_or_space
            )
    )
into
    temp_json
from
    (
        select
            'Total Count' as sub_category,
            COUNT(*) as count_or_space,
            'count' as valueType
        from
            temp_categorized_files
        union all
        select
            'Regular Files',
            SUM(case when is_directory = false then 1 else 0 end),
            'count' as valueType
        from
            temp_categorized_files
        union all
        select
            'Symbolic Links',
            SUM(case when UPPER(file_type) = 'SYMBOLIC_LINK' then 1 else 0 end),
            'count' as valueType
        from
            temp_categorized_files
        union all
        select
            'Total Space for Regular Files',
            SUM(case when is_directory = false then file_size else 0 end),
            'size' as valueType
        from
            temp_categorized_files
        union all
        select
            'Total Space for Directories',
            SUM(case when is_directory = true then file_size else 0 end),
            'size' as valueType
        from
            temp_categorized_files
        union all
        select
            'Total Space Used',
            SUM(file_size),
            'size' as valueType
        from
            temp_categorized_files
    ) as stats;

 aggregated_json := aggregated_json || temp_json;

 select
    jsonb_agg(
            jsonb_build_object(
                    'category',
                    'Maximum Values',
                    'sub_category',
                    stat_type,
                    'valueType',
                    valueType,
                    'value',
                    stat_value
            )
    )
into
    temp_json
from
    (
        select
            'max_file_size' as stat_type,
            MAX(case when is_directory = false then file_size else null end)::numeric as stat_value,
            'size' as valueType
        from
            temp_categorized_files
        union all
        select
            'max_name_length' as stat_type,
            MAX(case when is_directory = false then LENGTH(file_name) else null end)::numeric as stat_value,
            'length' as valueType
        from
            temp_categorized_files
        union all
        select
            'total_directories' as stat_type,
            SUM(case when is_directory = true then 1 else 0 end)::numeric as stat_value,
            'count' as valueType
        from
            temp_categorized_files
    ) as stats;

aggregated_json := aggregated_json || temp_json;

SELECT
    jsonb_agg(
            jsonb_build_object(
                    'category', 'Job Run Stats',
                    'sub_category', stat_type,
                    'valueType', valueType,
                    'value', stat_value
            )
    ) into temp_json
FROM (
         SELECT
             'Total Time' AS stat_type,
             COALESCE(EXTRACT(EPOCH FROM (jr.end_time - jr.start_time))::INT, 0)::TEXT AS stat_value,
             'time' as valueType
         FROM
             jobrun jr
         WHERE
             jr.id = jobrunid

         UNION ALL

         SELECT
             'Status' AS stat_type,
             jr.status AS stat_value,
             'status' as valueType
         FROM
             jobrun jr
         WHERE
             jr.id = jobrunid
     ) AS job_run_stats;

aggregated_json := aggregated_json || temp_json;

SELECT
    jsonb_agg(
            jsonb_build_object(
                    'category', 'File Server Info',
                    'sub_category', sub_category,
                    'valueType', 'string',
                    'value', value
            )
    ) into temp_json
FROM (
         SELECT 'Path' AS sub_category, v.volume_path AS value
         FROM config c
             JOIN file_server fs2 ON fs2.config_id = c.id
             JOIN volume v ON v.file_server_id = fs2.id
         WHERE v.id in (select path_id from temp_categorized_files limit 1 )

         UNION ALL

         SELECT 'Protocol' AS sub_category, fs2.protocol AS value
         FROM config c
             JOIN file_server fs2 ON fs2.config_id = c.id
             JOIN volume v ON v.file_server_id = fs2.id
         WHERE v.id in (select path_id from temp_categorized_files limit 1 )

         UNION ALL

         SELECT 'Config Name' AS sub_category, c.config_name AS value
         FROM config c
             JOIN file_server fs2 ON fs2.config_id = c.id
             JOIN volume v ON v.file_server_id = fs2.id
         WHERE v.id in (select path_id from temp_categorized_files limit 1 )
     ) AS file_server_data;

aggregated_json := aggregated_json || temp_json;

-- Longest File Names
select
    jsonb_agg(result) into temp_json
from
    (
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Longest File Names',
                    'valueType', 'string',
                    'value',
                    longest_file_names
            ) as result
        from
            (
                select
                    STRING_AGG(file_name || ' (' || length(file_name) || ')',
                               '; ') as longest_file_names
                from
                    (
                        select
                            file_name,
                            length(file_name)
                        from
                            inventory i
                        where
                            i.is_directory is false
                        order by
                            length(file_name) desc
                            limit 5
                    ) subquery

            ) combined_results
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'File Path Summary',
                    'valueType', 'string',
                    'value',
                    'Total Path: ' || path_count || '; Total Length: ' || total_length
            ) as result
        from
            (
                select
                    COUNT(path) as path_count,
                    SUM(length(path)) as total_length
                from
                    inventory i
                where
                    i.is_directory is false
            ) as summary_result

        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Longest Directory Names',
                    'valueType', 'string',
                    'value',
                    longest_file_names
            ) as result
        from
            (
                select
                    STRING_AGG(file_name || ' (' || length(file_name) || ')',
                               '; ') as longest_file_names
                from
                    (
                        select
                            file_name,
                            length(file_name)
                        from
                            inventory i
                        where
                            i.is_directory is true
                        order by
                            length(file_name) desc
                            limit 5
                    ) subquery) as combined_result
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Longest File Path',
                    'valueType', 'string',
                    'value',
                    longest_file_paths
            ) as result
        from
            (
                select
                    STRING_AGG(path || ' (' || length(path) || ')',
                               '; ') as longest_file_paths
                from
                    (
                        select
                            path,
                            length(path)
                        from
                            inventory i
                        where
                            i.is_directory is false
                        group by
                            path
                        order by
                            length(path) desc
                            limit 5
                    )subquery
            ) as combined_result
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Longest Directory Path',
                    'valueType', 'string',
                    'value',
                    longest_directory_paths
            ) as result
        from
            (
                select
                    STRING_AGG(path || ' (' || length(path) || ')',
                               '; ') as longest_directory_paths
                from
                    (
                        select
                            path,
                            length(path)
                        from
                            inventory i
                        where
                            i.is_directory is true
                        order by
                            length(path) desc
                            limit 5
                    )subquery
            ) as combined_result
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Biggest File Names',
                    'valueType', 'string',
                    'value',
                    biggest_file_name
            ) as result
        from
            (
                select
                    STRING_AGG(file_name || ' (' || file_size || ')',
                               '; ') as biggest_file_name
                from
                    (
                        select
                            file_name,
                            file_size
                        from
                            inventory i
                        where
                            i.is_directory is false
                        group by
                            file_name,
                            file_size
                        order by
                            file_size desc
                            limit 5
                    ) subquery
            ) as combined_result
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Biggest Directory With Count',
                    'valueType', 'count',
                    'value',
                    biggest_directory_count
            ) as result
        from
            (
                select
                    STRING_AGG(directory || ' (' || file_count || ')',
                               '; ') as biggest_directory_count
                from
                    (
                        select
                            parent_path as directory,
                            COUNT(*) as file_count
                        from
                            inventory
                        where
                            parent_path is not null
                          and is_directory is true
                        group by
                            parent_path
                        order by
                            file_count desc
                            limit 5

                    ) subquery
            ) as combined_result
        union all
        select
            jsonb_build_object(
                    'category',
                    'Biggest',
                    'sub_category',
                    'Top 5 Biggest Directory With Capacity',
                    'valueType', 'size',
                    'value',
                    biggest_directory_with_capcity
            ) as result
        from
            (
                select
                    STRING_AGG(directory || ' (' || total_size || ')',
                               '; ') as biggest_directory_with_capcity
                from
                    (
                        select
                            parent_path as directory,
                            SUM(file_size) as total_size
                        from
                            inventory
                        where
                            parent_path is not null
                          and is_directory is true
                        group by
                            parent_path
                        order by
                            total_size desc
                            limit 5

                    ) subquery
            ) as combined_result

    ) result;

aggregated_json := aggregated_json || temp_json;


-- Log the aggregated data using RAISE NOTICE
    raise notice 'Aggregated Data: %',
aggregated_json;


UPDATE reports
SET report_data = aggregated_json
WHERE job_run_id = jobrunid AND report_type = 'DISCOVER';

IF NOT FOUND THEN
    INSERT INTO reports (job_run_id, report_type, report_data)
    VALUES (jobrunid, 'DISCOVER', aggregated_json);
END IF;

update jobrun set is_report_ready = TRUE where id = jobrunid;
-- Add more aggregations if needed in similar fashion
end;

$procedure$
;