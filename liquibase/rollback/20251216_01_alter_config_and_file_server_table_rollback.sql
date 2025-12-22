ALTER TABLE datamigrator.file_server
DROP COLUMN IF EXISTS status;

ALTER TABLE datamigrator.file_server
DROP COLUMN zone_id IF EXISTS status;

ALTER TABLE datamigrator.file_server
DROP COLUMN IF EXISTS file_server_name;

ALTER TABLE datamigrator.file_server
ADD COLUMN server_type varchar NOT NULL;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS tls_expiry;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS tls_ca_certificate;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS tls_accepted;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS password;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS username;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS server_type;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS port;

ALTER TABLE datamigrator.config
DROP COLUMN IF EXISTS hostname;
