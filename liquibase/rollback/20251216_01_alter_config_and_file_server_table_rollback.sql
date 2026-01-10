ALTER TABLE datamigrator.file_server 
DROP COLUMN IF EXISTS smart_connect_dns_zone,
DROP COLUMN IF EXISTS smart_connect_ssip,
DROP COLUMN IF EXISTS status,
DROP COLUMN IF EXISTS file_server_name,
ADD COLUMN server_type varchar NOT NULL;

ALTER TABLE datamigrator.volume
DROP COLUMN IF EXISTS directory_path;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS tls_expiry,
DROP COLUMN IF EXISTS tls_ca_certificate,
DROP COLUMN IF EXISTS tls_accepted,
DROP COLUMN IF EXISTS password,
DROP COLUMN IF EXISTS username,
DROP COLUMN IF EXISTS server_type,
DROP COLUMN IF EXISTS port,
DROP COLUMN IF EXISTS hostname;
