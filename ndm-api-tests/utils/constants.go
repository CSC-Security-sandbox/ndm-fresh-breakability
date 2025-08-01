package utils

import (
	"log"
	"os"
)

type ConfigType string
type ServerType string
type Protocol string
type ProtocolVersion string

// Package-level configuration variables loaded from the environment.
var (
	JOB_SERVICE_URL         string
	CONFIG_SERVICE_URL      string
	ADMIN_SERVICE_URL       string
	REPORT_SERVICE_URL      string
	KEYCLOAK_IP             string
	CLIENT_SECRET           string
	USERNAME                string
	PASSWORD                string
	NDM_VM_USER_NAME        string
	NDM_VM_HOST             string
	NDM_VM_PORT             string
	NDM_VM_PASSWORD         string
	BASE_PROJECT_START_DATE string
	SOURCE_HOST_IP          string
	DESTINATION_HOST_IP     string
	NDM_WORKERS_HOST        string
	NDM_WORKERS_USER_NAME   string
	NDM_WORKERS_PORT        string
	NDM_WORKERS_PASSWORD    string
)

// Default environment variable constants (if needed).
const (
	ContentTypeJSON                                 = "application/json"
	ContentTypeForm                                 = "application/x-www-form-urlencoded"
	AuthHeader                                      = "Authorization"
	BearerPrefix                                    = "Bearer "
	KEYCLOAK_TOKEN_URL                              = "keycloak/realms/master/protocol/openid-connect/token"
	KEYCLOAK_BASE_URL                               = "keycloak/admin/realms/datamigrator/users"
	KEYCLOAK_CREDENTIALS_URL                        = "v1/secrets/keycloak-secrets/keycloak-creds"
	TOKEN_URL                                       = "keycloak/realms/datamigrator/protocol/openid-connect/token"
	BASE_ACCOUNT_NAME                               = "TestAccount"
	KEYCLOAK_CLIENT_ID                              = "admin-cli"
	CLIENT_ID                                       = "datamigrator-client"
	GRANT_TYPE                                      = "password"
	DEFAULT_ACCOUNT_ID                              = "753975cb-2f97-4230-b632-6815515a7d0d"
	LOGOUT_URL                                      = "keycloak/realms/datamigrator/protocol/openid-connect/logout"
	LOGOUT_USER                                     = "logout-user"
	NFS_SOURCE_VOLUME                               = "/vol_src_automation"
	NFS_DESTINATION_VOLUME                          = "/vol_dest_automation"
	NFS_SOURCE_VOLUME_1                             = "/vol_src_automation2"
	NFS_DESTINATION_VOLUME_1                        = "/vol_dest_automation2"
	NFS_SOURCE_VOLUME_2                             = "/vol_src_automation"
	CREATE_FILESERVER_ENDPOINT                      = "/api/v1/servers"
	CREATE_DISCOVERY_ENDPOINT                       = "/api/v1/jobs/bulk-discovery"
	CREATE_MIGRATION_ENDPOINT                       = "/api/v1/jobs/bulk-migrate"
	CREATE_CUTOVER_ENDPOINT                         = "/api/v1/jobs/bulk-cutover"
	CUTOVER_APPROVE_REJECT_ENDPOINT                 = "/api/v1/job-run/cutover/approve"
	JOB_RUN_ACTION_ENDPOINT                         = "/api/v1/job-run/action"
	JOB_RUN_ENDPOINT                                = "/api/v1/job-run"
	JOBS_ENDPOINT                                   = "/api/v1/jobs"
	FILE_SERVER_REFRESH_URL                         = "/api/v1/servers/refresh"
	ADHOC_JOBRUN_URL                                = "/api/v1/job-run/ad-hoc"
	JobTypeDiscovery                JobType         = "DISCOVER"
	JobTypeCutover                  JobType         = "CUTOVER"
	JobTypeMigration                JobType         = "MIGRATE"
	FormatPDF                       Format          = "pdf"
	FormatCSV                       Format          = "csv"
	DefaultPollInterval                             = 5
	MaxPollRetries                                  = 70
	WORKER_TIMEOUT                                  = 180
	RUNNING_JOBRUN                                  = "RUNNING"
	PAUSE_JOBRUN                                    = "PAUSE"
	COMPLETED_JOBRUN                                = "COMPLETED"
	RESUME_JOBRUN                                   = "RESUME"
	STOP_JOBRUN                                     = "STOP"
	READY_JOBRUN                                    = "READY"
	BLOCKED_JOBRUN                                  = "BLOCKED"
	APPROVED_JOBRUN                                 = "APPROVED"
	ERRORED_JOBRUN                                  = "ERRORED"
	PAUSED_JOBRUN                                   = "PAUSED"
	DeltaFolder                                     = "delta"
	ConfigTypeFile                  ConfigType      = "FILE"
	ServerTypeOtherNAS              ServerType      = "OtherNAS"
	ProtocolNFS                     Protocol        = "NFS"
	ProtocolVersion3                ProtocolVersion = "v3"
	TIME_FORMAT                                     = "2006-01-02T15:04:05.000Z"
)

func init() {
	// Load the .env file.
	if err := loadEnvFromEnvFile(); err != nil {
		// If the .env file is not found, log the error but continue
		log.Printf("Error loading environment variables from .env file: %v", err)
	} else {
		log.Println("Environment variables loaded successfully from .env file")
	}

	// Load configuration from environment.
	JOB_SERVICE_URL = os.Getenv("JOB_SERVICE_URL")
	CONFIG_SERVICE_URL = os.Getenv("CONFIG_SERVICE_URL")
	ADMIN_SERVICE_URL = os.Getenv("ADMIN_SERVICE_URL")
	REPORT_SERVICE_URL = os.Getenv("REPORT_SERVICE_URL")
	KEYCLOAK_IP = os.Getenv("KEYCLOAK_IP")
	USERNAME = os.Getenv("NDM_USERNAME")
	PASSWORD = os.Getenv("PASSWORD")
	NDM_VM_USER_NAME = os.Getenv("NDM_VM_USER_NAME")
	NDM_VM_HOST = os.Getenv("NDM_VM_HOST")
	NDM_VM_PORT = os.Getenv("NDM_VM_PORT")
	NDM_VM_PASSWORD = os.Getenv("NDM_VM_PASSWORD")
	NDM_WORKERS_USER_NAME = os.Getenv("NDM_WORKERS_USER_NAME")
	NDM_WORKERS_HOST = os.Getenv("NDM_WORKERS_HOST")
	NDM_WORKERS_PORT = os.Getenv("NDM_WORKERS_PORT")
	NDM_WORKERS_PASSWORD = os.Getenv("NDM_WORKERS_PASSWORD")
	SOURCE_HOST_IP = os.Getenv("SOURCE_HOST_IP")
	DESTINATION_HOST_IP = os.Getenv("DESTINATION_HOST_IP")
}
