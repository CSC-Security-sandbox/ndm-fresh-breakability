ALTER TABLE datamigrator.config
ADD COLUMN IF NOT EXISTS hostname varchar(255),
ADD COLUMN IF NOT EXISTS port integer NULL,
ADD COLUMN IF NOT EXISTS server_type varchar NOT NULL,
ADD COLUMN IF NOT EXISTS username varchar(255),
ADD COLUMN IF NOT EXISTS password varchar(255),
ADD COLUMN IF NOT EXISTS tls_accepted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS tls_ca_certificate text,
ADD COLUMN IF NOT EXISTS tls_expiry date NULL;

ALTER TABLE datamigrator.file_server
ADD COLUMN IF NOT EXISTS file_server_name varchar NOT NULL,
ADD COLUMN IF NOT EXISTS zone_id integer NULL,
ADD COLUMN IF NOT EXISTS status varchar(255),
ADD COLUMN IF NOT EXISTS smart_connect_ssip text NULL,
ADD COLUMN IF NOT EXISTS smart_connect_dns_zone text NULL,
ADD COLUMN IF NOT EXISTS error_message text,
DROP COLUMN IF EXISTS server_type;

ALTER TABLE datamigrator.volume
ADD COLUMN IF NOT EXISTS directory_path text NULL;
