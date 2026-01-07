ALTER TABLE datamigrator.config
ADD COLUMN hostname varchar(255);

ALTER TABLE datamigrator.config
ADD COLUMN port integer NULL;

ALTER TABLE datamigrator.config
ADD COLUMN server_type varchar NOT NULL;

ALTER TABLE datamigrator.config
ADD COLUMN username varchar(255);

ALTER TABLE datamigrator.config
ADD COLUMN password varchar(255);

ALTER TABLE datamigrator.config
ADD COLUMN tls_accepted boolean DEFAULT false;

ALTER TABLE datamigrator.config
ADD COLUMN tls_ca_certificate text;

ALTER TABLE datamigrator.config
ADD COLUMN tls_expiry date NULL;

ALTER TABLE datamigrator.file_server
ADD COLUMN file_server_name varchar NOT NULL;

ALTER TABLE datamigrator.file_server
ADD COLUMN zone_id integer NULL;

ALTER TABLE datamigrator.file_server
ADD COLUMN status varchar(255);

ALTER TABLE datamigrator.file_server
DROP COLUMN IF EXISTS server_type;

ALTER TABLE datamigrator.volume
ADD COLUMN directory_path text NULL;

ALTER TABLE datamigrator.file_server 
ADD COLUMN smart_connect_ssip text NULL;

ALTER TABLE datamigrator.file_server 
ADD COLUMN smart_connect_dns_zone text NULL;