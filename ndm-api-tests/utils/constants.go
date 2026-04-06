package utils

import (
	"log"
	"os"
	"strconv"
)

type ConfigType string
type ServerType string
type Protocol string
type ProtocolVersion string
type CloudEnvironment string
type FileServerStatus string

// Package-level configuration variables loaded from the environment.
var (
	PROTOCOL_TYPE            Protocol
	CLOUD_ENVIRONMENT        CloudEnvironment
	JOB_SERVICE_URL          string
	CONFIG_SERVICE_URL       string
	ADMIN_SERVICE_URL        string
	REPORT_SERVICE_URL       string
	KEYCLOAK_IP              string
	CLIENT_SECRET            string
	USERNAME                 string
	PASSWORD                 string
	NDM_VM_USER_NAME         string
	NDM_VM_HOST              string
	NDM_VM_PORT              string
	NDM_VM_PASSWORD          string
	BASE_PROJECT_START_DATE  string
	SOURCE_VOLUMES_LIST      string
	DESTINATION_VOLUMES_LIST string
	SOURCE_HOST_IP           string
	DESTINATION_HOST_IP      string
	NDM_WORKERS_HOST         string
	NDM_WORKERS_USER_NAME    string
	NDM_WORKERS_PORT         string
	NDM_WORKERS_PASSWORD     string
	PROTOCOL_USERNAME        string
	PROTOCOL_PASSWORD        string
	BUILD_VERSION            string
	REF_TYPE                 string
	NDM_NEXUS_USERNAME       string
	NDM_NEXUS_PASSWORD       string

	RATE_LIMIT_MAX_ALLOWED_SUCCESS_REQ int

	ProtocolVersion3 ProtocolVersion

	SOURCE_VOLUMES      []string
	DESTINATION_VOLUMES []string

	SOURCE_HOST_IPs      []string
	DESTINATION_HOST_IPs []string
)

// NFS / SMB specific variables from the environment.
var (
	// Azure NFS
	AZURE_NFS_NDM_WORKERS_HOST      string
	AZURE_NFS_NDM_WORKERS_USER_NAME string
	AZURE_NFS_NDM_WORKERS_PORT      string
	AZURE_NFS_NDM_WORKERS_PASSWORD  string
	AZURE_NFS_SOURCE_VOLUMES        string
	AZURE_NFS_DESTINATION_VOLUMES   string
	AZURE_NFS_SOURCE_HOST_IP        string
	AZURE_NFS_DESTINATION_HOST_IP   string
	AZURE_NFS_PROTOCOL_USERNAME     string
	AZURE_NFS_PROTOCOL_PASSWORD     string

	// vSphere NFS
	VSPHERE_NFS_NDM_WORKERS_HOST      string
	VSPHERE_NFS_NDM_WORKERS_USER_NAME string
	VSPHERE_NFS_NDM_WORKERS_PORT      string
	VSPHERE_NFS_NDM_WORKERS_PASSWORD  string
	VSPHERE_NFS_SOURCE_VOLUMES        string
	VSPHERE_NFS_DESTINATION_VOLUMES   string
	VSPHERE_NFS_SOURCE_HOST_IP        string
	VSPHERE_NFS_DESTINATION_HOST_IP   string
	VSPHERE_NFS_PROTOCOL_USERNAME     string
	VSPHERE_NFS_PROTOCOL_PASSWORD     string

	// Azure SMB
	AZURE_SMB_NDM_WORKERS_HOST      string
	AZURE_SMB_NDM_WORKERS_USER_NAME string
	AZURE_SMB_NDM_WORKERS_PORT      string
	AZURE_SMB_NDM_WORKERS_PASSWORD  string
	AZURE_SMB_SOURCE_VOLUMES        string
	AZURE_SMB_DESTINATION_VOLUMES   string
	AZURE_SMB_SOURCE_HOST_IP        string
	AZURE_SMB_DESTINATION_HOST_IP   string
	AZURE_SMB_PROTOCOL_USERNAME     string
	AZURE_SMB_PROTOCOL_PASSWORD     string

	// vSphere SMB
	VSPHERE_SMB_NDM_WORKERS_HOST      string
	VSPHERE_SMB_NDM_WORKERS_USER_NAME string
	VSPHERE_SMB_NDM_WORKERS_PORT      string
	VSPHERE_SMB_NDM_WORKERS_PASSWORD  string
	VSPHERE_SMB_SOURCE_VOLUMES        string
	VSPHERE_SMB_DESTINATION_VOLUMES   string
	VSPHERE_SMB_SOURCE_HOST_IP        string
	VSPHERE_SMB_DESTINATION_HOST_IP   string
	VSPHERE_SMB_PROTOCOL_USERNAME     string
	VSPHERE_SMB_PROTOCOL_PASSWORD     string

	// SMB Executable
	SMB_EXECUTABLE_FILENAME string

	// ONTAP Configuration for volume cloning
	// Source ONTAP
	ONTAP_SRC_API_URL                 string
	ONTAP_SYSTEM_MANAGER_SRC_USERNAME string
	ONTAP_SYSTEM_MANAGER_SRC_PASSWORD string
	ONTAP_SRC_SVM_NAME                string
	ONTAP_SRC_HOST_IP                 string

	// Destination ONTAP
	ONTAP_DST_API_URL                 string
	ONTAP_SYSTEM_MANAGER_DST_USERNAME string
	ONTAP_SYSTEM_MANAGER_DST_PASSWORD string
	ONTAP_DST_SVM_NAME                string
	ONTAP_DST_HOST_IP                 string

	// NFS Volume configurations
	ONTAP_NFS_SOURCE_VOLUMES string
	ONTAP_NFS_DEST_VOLUMES   string

	// SMB Volume configurations
	ONTAP_SMB_SOURCE_VOLUMES string
	ONTAP_SMB_DEST_VOLUMES   string
)

// Default environment variable constants (if needed).
const (
	ContentTypeJSON                                  = "application/json"
	ContentTypeForm                                  = "application/x-www-form-urlencoded"
	AuthHeader                                       = "Authorization"
	BearerPrefix                                     = "Bearer "
	KEYCLOAK_TOKEN_URL                               = "keycloak/realms/master/protocol/openid-connect/token"
	KEYCLOAK_BASE_URL                                = "keycloak/admin/realms/datamigrator/users"
	KEYCLOAK_CREDENTIALS_URL                         = "v1/secrets/keycloak-secrets/keycloak-creds"
	TOKEN_URL                                        = "keycloak/realms/datamigrator/protocol/openid-connect/token"
	BASE_ACCOUNT_NAME                                = "TestAccount"
	KEYCLOAK_CLIENT_ID                               = "admin-cli"
	CLIENT_ID                                        = "datamigrator-client"
	GRANT_TYPE                                       = "password"
	DEFAULT_ACCOUNT_ID                               = "753975cb-2f97-4230-b632-6815515a7d0d"
	LOGOUT_URL                                       = "keycloak/realms/datamigrator/protocol/openid-connect/logout"
	LOGOUT_USER                                      = "logout-user"
	NFS_SOURCE_VOLUME                                = "/volSrcAuto"
	NFS_DESTINATION_VOLUME                           = "/vol_dest_automation"
	NFS_SOURCE_VOLUME_1                              = "/vol_src_automation2"
	NFS_DESTINATION_VOLUME_1                         = "/vol_dest_automation2"
	NFS_SOURCE_VOLUME_2                              = "/vol_src_automation"
	FILESERVER_ENDPOINT                              = "/api/v1/servers"
	CREATE_DISCOVERY_ENDPOINT                        = "/api/v1/jobs/bulk-discovery"
	CREATE_MIGRATION_ENDPOINT                        = "/api/v1/jobs/bulk-migrate"
	CREATE_CUTOVER_ENDPOINT                          = "/api/v1/jobs/bulk-cutover"
	CUTOVER_APPROVE_REJECT_ENDPOINT                  = "/api/v1/job-run/cutover/approve"
	JOB_RUN_ACTION_ENDPOINT                          = "/api/v1/job-run/action"
	JOB_RUN_ENDPOINT                                 = "/api/v1/job-run"
	JOB_RUN_REPORT_ENDPOINT                          = "/api/v1/report/job-run"
	JOBS_ENDPOINT                                    = "/api/v1/jobs"
	FILE_SERVER_REFRESH_URL                          = "/api/v1/servers/refresh"
	ADHOC_JOBRUN_URL                                 = "/api/v1/job-run/ad-hoc"
	IS_SUPPORT_BUNDLE_READY_URL                      = "/api/v1/support-bundle/is-bundle-ready"
	GENERATE_SUPPORT_BUNDLE_URL                      = "/api/v1/support-bundle"
	DOWNLOAD_SUPPORT_BUNDLE_URL                      = "/api/v1/support-bundle/download"
	ABOUT_NDM_URL                                    = "/api/v1/about-ndm"
	INVENTORY_PREPARE_DOWNLOAD_ENDPOINT              = "/api/v1/report/inventory/prepare-download"
	INVENTORY_DOWNLOAD_BY_TOKEN_ENDPOINT             = "/api/v1/report/inventory/download/"
	JobTypeDiscovery                JobType          = "DISCOVER"
	JobTypeCutover                  JobType          = "CUTOVER"
	JobTypeMigration                JobType          = "MIGRATE"
	FormatPDF                       Format           = "pdf"
	FormatCSV                       Format           = "csv"
	DefaultPollInterval                              = 5
	MaxPollRetries                                   = 600
	MaxFileServerStatusRetries                       = 60 // 60 × 5s = 5 minutes for FileServer status to become ACTIVE
	MaxVolumeDiscoveryRetries                        = 60 // 60 × 5s = 5 minutes for volume discovery after FileServer creation
	MaxFileServerDetailsRetries                      = 60 // 60 × 5s = 5 minutes for retrieving FileServer details
	MaxWorkerStatusRetries                           = 60 // 60 × 5s = 5 minutes for workers to come online
	WORKER_TIMEOUT                                   = 180
	RUNNING_JOBRUN                                   = "RUNNING"
	PAUSE_JOBRUN                                     = "PAUSE"
	COMPLETED_JOBRUN                                 = "COMPLETED"
	RESUME_JOBRUN                                    = "RESUME"
	STOP_JOBRUN                                      = "STOP"
	STOPPED_JOBRUN                                   = "STOPPED"
	READY_JOBRUN                                     = "READY"
	BLOCKED_JOBRUN                                   = "BLOCKED"
	APPROVED_JOBRUN                                  = "APPROVED"
	ERRORED_JOBRUN                                   = "ERRORED"
	FAILED_JOBRUN                                    = "FAILED"
	PAUSED_JOBRUN                                    = "PAUSED"
	FileServerStatusActive          FileServerStatus = "ACTIVE"
	FileServerStatusInProgress      FileServerStatus = "IN_PROGRESS"
	FileServerStatusErrored         FileServerStatus = "ERRORED"
	DeltaFolder                                      = "delta"
	ConfigTypeFile                  ConfigType       = "FILE"
	ServerTypeOtherNAS              ServerType       = "OtherNAS"
	ProtocolNFS                     Protocol         = "NFS"
	ProtocolSMB                     Protocol         = "SMB"
	ProtocolVersionNFS_V3           ProtocolVersion  = "v3"
	ProtocolVersionSMB_V3           ProtocolVersion  = "v3.0"
	AzureEnv                        CloudEnvironment = "Azure"
	vSphereEnv                      CloudEnvironment = "vSphere"
	GcpEnv                          CloudEnvironment = "GCP"
	TIME_FORMAT                                      = "2006-01-02T15:04:05.000Z"
	ARTIFACTORY_URL                                  = "https://generic.repo.eng.netapp.com/artifactory/openlab-generic"
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
	BUILD_VERSION = os.Getenv("BUILD_VERSION")
	REF_TYPE = os.Getenv("REF_TYPE")
	NDM_NEXUS_USERNAME = os.Getenv("NDM_NEXUS_USERNAME")
	NDM_NEXUS_PASSWORD = os.Getenv("NDM_NEXUS_PASSWORD")

	// ONTAP Configuration for parallel testing with volume cloning
	// Source ONTAP
	ONTAP_SRC_API_URL = os.Getenv("ONTAP_SRC_API_URL")
	ONTAP_SYSTEM_MANAGER_SRC_USERNAME = os.Getenv("ONTAP_SYSTEM_MANAGER_SRC_USERNAME")
	ONTAP_SYSTEM_MANAGER_SRC_PASSWORD = os.Getenv("ONTAP_SYSTEM_MANAGER_SRC_PASSWORD")
	ONTAP_SRC_SVM_NAME = os.Getenv("ONTAP_SRC_SVM_NAME")
	ONTAP_SRC_HOST_IP = os.Getenv("ONTAP_SRC_HOST_IP")

	// Destination ONTAP
	ONTAP_DST_API_URL = os.Getenv("ONTAP_DST_API_URL")
	ONTAP_SYSTEM_MANAGER_DST_USERNAME = os.Getenv("ONTAP_SYSTEM_MANAGER_DST_USERNAME")
	ONTAP_SYSTEM_MANAGER_DST_PASSWORD = os.Getenv("ONTAP_SYSTEM_MANAGER_DST_PASSWORD")
	ONTAP_DST_SVM_NAME = os.Getenv("ONTAP_DST_SVM_NAME")
	ONTAP_DST_HOST_IP = os.Getenv("ONTAP_DST_HOST_IP")

	// NFS Volume configurations
	ONTAP_NFS_SOURCE_VOLUMES = os.Getenv("ONTAP_NFS_SOURCE_VOLUMES")
	ONTAP_NFS_DEST_VOLUMES = os.Getenv("ONTAP_NFS_DEST_VOLUMES")

	// SMB Volume configurations
	ONTAP_SMB_SOURCE_VOLUMES = os.Getenv("ONTAP_SMB_SOURCE_VOLUMES")
	ONTAP_SMB_DEST_VOLUMES = os.Getenv("ONTAP_SMB_DEST_VOLUMES")

	// Rate limiting test configuration
	if envVal := os.Getenv("RATE_LIMIT_MAX_ALLOWED_SUCCESS_REQ"); envVal != "" {
		if parsedVal, err := strconv.Atoi(envVal); err == nil && parsedVal > 0 {
			RATE_LIMIT_MAX_ALLOWED_SUCCESS_REQ = parsedVal
		}
	}
}

func UpdateConfVariables(protocolType, environment string) {
	PROTOCOL_TYPE = Protocol(protocolType)
	CLOUD_ENVIRONMENT = CloudEnvironment(environment)

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		switch CLOUD_ENVIRONMENT {
		case AzureEnv:
			NDM_WORKERS_HOST = os.Getenv("AZURE_SMB_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("AZURE_SMB_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("AZURE_SMB_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("AZURE_SMB_NDM_WORKERS_PASSWORD")

			// Use ONTAP volumes for parallel testing with volume cloning
			SOURCE_VOLUMES_LIST = os.Getenv("ONTAP_SMB_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("ONTAP_SMB_DEST_VOLUMES")

			// Use SMB-specific ONTAP host IPs for mounting volumes
			SOURCE_HOST_IP = os.Getenv("ONTAP_SMB_SRC_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("ONTAP_SMB_DST_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("AZURE_SMB_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("AZURE_SMB_PROTOCOL_PASSWORD")

			SMB_EXECUTABLE_FILENAME = os.Getenv("SMB_EXECUTABLE_FILENAME")
			ProtocolVersion3 = ProtocolVersionSMB_V3

		case vSphereEnv:
			NDM_WORKERS_HOST = os.Getenv("VSPHERE_SMB_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("VSPHERE_SMB_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("VSPHERE_SMB_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("VSPHERE_SMB_NDM_WORKERS_PASSWORD")

			// Use ONTAP volumes for parallel testing with volume cloning
			SOURCE_VOLUMES_LIST = os.Getenv("ONTAP_SMB_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("ONTAP_SMB_DEST_VOLUMES")

			// Use SMB-specific ONTAP host IPs for mounting volumes
			SOURCE_HOST_IP = os.Getenv("ONTAP_SMB_SRC_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("ONTAP_SMB_DST_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("VSPHERE_SMB_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("VSPHERE_SMB_PROTOCOL_PASSWORD")

			SMB_EXECUTABLE_FILENAME = os.Getenv("SMB_EXECUTABLE_FILENAME")
			ProtocolVersion3 = ProtocolVersionSMB_V3

		default:
			LogFatalf("Invalid cloud environment: %s. Valid protocol types are: NFS / SMB.", environment)
		}

	case ProtocolNFS:
		switch CLOUD_ENVIRONMENT {
		case AzureEnv:
			NDM_WORKERS_HOST = os.Getenv("AZURE_NFS_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("AZURE_NFS_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("AZURE_NFS_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("AZURE_NFS_NDM_WORKERS_PASSWORD")

			// Use ONTAP volumes for parallel testing with volume cloning
			SOURCE_VOLUMES_LIST = os.Getenv("ONTAP_NFS_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("ONTAP_NFS_DEST_VOLUMES")

			// Use NFS-specific ONTAP host IPs for mounting volumes
			SOURCE_HOST_IP = os.Getenv("ONTAP_NFS_SRC_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("ONTAP_NFS_DST_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("AZURE_NFS_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("AZURE_NFS_PROTOCOL_PASSWORD")

			ProtocolVersion3 = ProtocolVersionNFS_V3

		case vSphereEnv:
			NDM_WORKERS_HOST = os.Getenv("VSPHERE_NFS_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("VSPHERE_NFS_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("VSPHERE_NFS_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("VSPHERE_NFS_NDM_WORKERS_PASSWORD")

			// Use ONTAP volumes for parallel testing with volume cloning
			SOURCE_VOLUMES_LIST = os.Getenv("ONTAP_NFS_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("ONTAP_NFS_DEST_VOLUMES")

			// Use NFS-specific ONTAP host IPs for mounting volumes
			SOURCE_HOST_IP = os.Getenv("ONTAP_NFS_SRC_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("ONTAP_NFS_DST_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("VSPHERE_NFS_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("VSPHERE_NFS_PROTOCOL_PASSWORD")

			ProtocolVersion3 = ProtocolVersionNFS_V3

		default:
			LogFatalf("Invalid cloud environment: %s. Valid protocol types are: NFS / SMB.", environment)
		}
	default:
		LogFatalf("Invalid protocol type: %s. Valid protocol types are: NFS / SMB.", protocolType)
	}

	LogDebug("UpdateConfVariables: Initializing workers and file server...")
	InitWorkers(NDM_WORKERS_HOST, NDM_WORKERS_PORT, NDM_WORKERS_PASSWORD, NDM_WORKERS_USER_NAME)
	InitFileServer(SOURCE_VOLUMES_LIST, DESTINATION_VOLUMES_LIST, SOURCE_HOST_IP, DESTINATION_HOST_IP, 2)
	LogDebug("UpdateConfVariables: Successfully completed InitWorkers and InitFileServer")
}
