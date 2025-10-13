CREATE OR REPLACE PROCEDURE create_inventory_partition(
    in_job_run_id text,
    schema_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  tbl_name text := format('inventory_%s', regexp_replace(in_job_run_id, '-', '_','g'));
  sql text;
BEGIN
  sql := format(
    'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %I.inventory FOR VALUES IN (%L::uuid)',
    schema_name,    
    tbl_name,        
    schema_name,     
    in_job_run_id
  );
  EXECUTE sql;
END;
$$;

ALTER PROCEDURE create_inventory_partition(text, text) OWNER TO liquibase;

GRANT EXECUTE ON PROCEDURE create_inventory_partition(text,text) TO dmadmin;