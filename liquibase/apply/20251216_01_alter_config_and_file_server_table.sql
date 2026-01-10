ALTER TABLE datamigrator.config
ADD COLUMN hostname varchar(255),
ADD COLUMN port integer NULL,
ADD COLUMN server_type varchar NOT NULL,
ADD COLUMN username varchar(255),
ADD COLUMN password varchar(255),
ADD COLUMN tls_accepted boolean DEFAULT false,
ADD COLUMN tls_ca_certificate text,
ADD COLUMN tls_expiry date NULL;

ALTER TABLE datamigrator.file_server
ADD COLUMN file_server_name varchar NOT NULL,
ADD COLUMN zone_id integer NULL,
ADD COLUMN status varchar(255),
ADD COLUMN smart_connect_ssip text NULL,
ADD COLUMN smart_connect_dns_zone text NULL,
DROP COLUMN IF EXISTS server_type;

ALTER TABLE datamigrator.volume
ADD COLUMN directory_path text NULL;
