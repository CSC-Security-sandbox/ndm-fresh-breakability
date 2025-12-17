ALTER TABLE datamigrator.config
ADD COLUMN hostname varchar(255) NOT NULL;

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
