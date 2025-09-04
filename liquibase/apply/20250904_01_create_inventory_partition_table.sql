DO $$
BEGIN
   IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'inventory_admin'
   ) THEN
      CREATE ROLE inventory_admin;
   END IF;
END
$$;

GRANT inventory_admin TO dmadmin, liquibase;

ALTER TABLE inventory  OWNER TO inventory_admin;

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
    schema_name,     -- schema for new partition
    tbl_name,        -- safe table name
    schema_name,     -- parent table schema
    in_job_run_id    -- original job_run_id value (with dashes, no replace!)
  );
  EXECUTE sql;
END;
$$;

GRANT EXECUTE ON PROCEDURE create_inventory_partition(text,text) TO dmadmin;