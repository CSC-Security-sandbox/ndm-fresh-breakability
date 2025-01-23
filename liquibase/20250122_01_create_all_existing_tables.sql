CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE "config_status" AS ENUM ('DRAFT', 'ACTIVE');
CREATE TYPE "job_status" AS ENUM ('ACTIVE', 'IN_ACTIVE');
CREATE TYPE "job_type" AS ENUM ('SCAN', 'MIGRATE', 'CUT_OVER', 'SPEED_TEST');
CREATE TYPE "job_run_status" AS ENUM ('READY', 'PENDING', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED', 'ERRORED');
CREATE TYPE "protocol" AS ENUM ('NFS', 'SMB');
CREATE TYPE "protocol_version" AS ENUM ('v3', 'v4.0', 'v4.1', 'v4.2', 'v2.0', 'v3.0', 'v3.1.1');
CREATE TYPE "server_type" AS ENUM ('OtherNAS', 'dell', 'emc');
CREATE TYPE "worker_status" AS ENUM ('Online', 'Offline');

CREATE TABLE "project" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "project_name" TEXT,
    "start_date" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "config" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "config_name" TEXT,
    "config_type" TEXT,
    "project_id" uuid NOT NULL REFERENCES "project" ("id") ON DELETE CASCADE,
    "status" "config_status" NOT NULL,
    "scanned_date" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "file_server" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "hostname" TEXT,
    "username" TEXT,
    "protocol" "protocol",
    "server_type" "server_type" NOT NULL,
    "password" TEXT,
    "config_id" uuid REFERENCES "config" ("id") ON DELETE CASCADE,
    "is_refreshed" BOOLEAN,
    "protocol_version" "protocol_version" NOT NULL,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "volume" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "volume_path" TEXT,
    "reachable_count" INT,
    "file_server_id" uuid REFERENCES "file_server" ("id") ON DELETE CASCADE,
    "is_discovery_done" BOOLEAN DEFAULT false,
    "is_baseline_migration_done" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "jobconfig" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "job_type" "job_type" NOT NULL,
    "status" "job_status" NOT NULL,
    "exclude_older_than" TIMESTAMP,
    "exclude_file_patterns" TEXT,
    "preserve_access_time" BOOLEAN DEFAULT false,
    "first_run_at" TIMESTAMP,
    "future_schedule_at" TEXT,
    "source_path_id" uuid NOT NULL REFERENCES "volume" ("id") ON DELETE CASCADE,
    "target_path_id" uuid REFERENCES "volume" ("id") ON DELETE CASCADE,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "jobrun" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "status" "job_run_status" DEFAULT 'PENDING',
    "start_time" TIMESTAMP,
    "end_time" TIMESTAMP,
    "job_config_id" uuid NOT NULL REFERENCES "jobconfig" ("id"),
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "fileserver_workingdirectory_mapping" (
    "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    "path_name" TEXT,
    "working_directory" TEXT,
    "path_id" uuid,
    "config_id" uuid REFERENCES "config" ("id") ON DELETE CASCADE,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "worker" (
    "id" uuid PRIMARY KEY,
    "project_id" uuid NOT NULL REFERENCES "project" ("id") ON DELETE CASCADE,
    "client_id" VARCHAR(255) NOT NULL,
    "worker_name" VARCHAR(255) NOT NULL,
    "ip_address" VARCHAR(255) NOT NULL,
    "status" "worker_status" NOT NULL,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    "created_by" uuid,
    "updated_by" uuid
);

CREATE TABLE "file_server_worker" (
    "file_server_id" uuid REFERENCES "file_server" ("id") ON DELETE CASCADE,
    "worker_id" uuid REFERENCES "worker" ("workerId") ON DELETE CASCADE,
    PRIMARY KEY ("file_server_id", "worker_id")
);
