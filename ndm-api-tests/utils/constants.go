package utils

import (
	"log"
	"os"
)

type ConfigType string
type ServerType string
type Protocol string
type ProtocolVersion string
type CloudEnvironment string

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

	CONFIG_WORKERS map[string]string
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
	NFS_SOURCE_VOLUME                                = "/LargeEDA_70G_1"
	NFS_DESTINATION_VOLUME                           = "/gcp-sanity-1"
	NFS_SOURCE_VOLUME_1                              = "/LargeEDA_70G_2"
	NFS_DESTINATION_VOLUME_1                         = "/gcp-sanity-2"
	NFS_SOURCE_VOLUME_2                              = "/LargeEDA_70G_2"
	CREATE_FILESERVER_ENDPOINT                       = "/api/v1/servers"
	CREATE_DISCOVERY_ENDPOINT                        = "/api/v1/jobs/bulk-discovery"
	CREATE_MIGRATION_ENDPOINT                        = "/api/v1/jobs/bulk-migrate"
	CREATE_CUTOVER_ENDPOINT                          = "/api/v1/jobs/bulk-cutover"
	CUTOVER_APPROVE_REJECT_ENDPOINT                  = "/api/v1/job-run/cutover/approve"
	JOB_RUN_ACTION_ENDPOINT                          = "/api/v1/job-run/action"
	JOB_RUN_ENDPOINT                                 = "/api/v1/job-run"
	JOBS_ENDPOINT                                    = "/api/v1/jobs"
	FILE_SERVER_REFRESH_URL                          = "/api/v1/servers/refresh"
	ADHOC_JOBRUN_URL                                 = "/api/v1/job-run/ad-hoc"
	IS_SUPPORT_BUNDLE_READY_URL                      = "/api/v1/support-bundle/is-bundle-ready"
	GENERATE_SUPPORT_BUNDLE_URL                      = "/api/v1/support-bundle"
	DOWNLOAD_SUPPORT_BUNDLE_URL                      = "/api/v1/support-bundle/download"
	ABOUT_NDM_URL                                    = "/api/v1/about-ndm"
	JobTypeDiscovery                JobType          = "DISCOVER"
	JobTypeCutover                  JobType          = "CUTOVER"
	JobTypeMigration                JobType          = "MIGRATE"
	FormatPDF                       Format           = "pdf"
	FormatCSV                       Format           = "csv"
	DefaultPollInterval                              = 100
	MaxPollRetries                                   = 240
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
	PAUSED_JOBRUN                                    = "PAUSED"
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
	CPSSHKeyData                                     = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUExQ3A0ZmdGekMyWi9RSFdJNFd5MU1yeWJEYjJSeUpvcFd3bDhuV1BkT0QvQjJvaVpldHhFCjZLeWhHV3ZXSzhIblhMeEFrZ3BtdFhkNmprMkErVzg3RktlQ0dPM0xrRG9kaUxVU1RSTVFoQ0d6ZjdCQjcwR0NOOG1ZSS8KSzBYTnZpUlNRSVRiUzdERC9ORWJGMm1jdkRRTXhseHVET01uRzBPdStadVhjaWZpeWY0VlhIdW9nNzA4WG9ldWE5Zi9WbQpOa0hqQVRvK2FJaVZoTlNFWTk3bGUyRCs2Q2pSY0w5eUlVTmJjelFrUkQzWnRpR1VSSEFhL2JNOGFPSzF5NnFrYVJGQWNWCkJobm9Md1dXdk9zMEthYXROWHNtZVR5M1FtNTZ4V1FDbThLeGRGN041czZoelQ2ZUtVWkRJMlRnK1VhVjVGaVdFL09YRnEKalMyaS90TFBGUUFBQS9oZ3lPa1VZTWpwRkFBQUFBZHpjMmd0Y25OaEFBQUJBUURVS25oK0FYTUxabjlBZFlqaGJMVXl2SgpzTnZaSEltaWxiQ1h5ZFk5MDRQOEhhaUpsNjNFVG9yS0VaYTlZcndlZGN2RUNTQ21hMWQzcU9UWUQ1YnpzVXA0SVk3Y3VRCk9oMkl0UkpORXhDRUliTi9zRUh2UVlJM3laZ2o4clJjMitKRkpBaE50THNNUDgwUnNYYVp5OE5BekdYRzRNNHljYlE2NzUKbTVkeUorTEovaFZjZTZpRHZUeGVoNjVyMS85V1kyUWVNQk9qNW9pSldFMUlSajN1VjdZUDdvS05Gd3YzSWhRMXR6TkNSRQpQZG0ySVpSRWNCcjlzenhvNHJYTHFxUnBFVUJ4VUdHZWd2QlphODZ6UXBwcTAxZXlaNVBMZENibnJGWkFLYndyRjBYczNtCnpxSE5QcDRwUmtNalpPRDVScFhrV0pZVDg1Y1dxTkxhTCswczhWQUFBQUF3RUFBUUFBQVFBTE42ZWhPZUJrUk9vTGRXdGsKUjhRWXg2SUhDdlBQUUY5Wllkb0YxRWJZOTMzL1dPT01mR0xrVG1SQ0hOSjVBOHFBdTY5S1NXUit5YTlnSUxibCtUeU5iZwpIUjRaaTJxbXZ2VTJ1QlNiWEExcXRQMy9qTWRwRTA4K0tvVytldlZTelViUUJIWTN2VVBQZFJyU2xSSGxYWGNqY2JXYjF0CksxZlZHZC90ejEreWZmN2NlZDRUNWdybEptQitEeENvV1M2MEtZSDd1TFRmVXBrQnQwNTczWHZ5WEhKV0c5MTZxdHZuYjQKck1hOUZZc3RBc1hUcmxodXRZODVmVXo5Z0hqb1ZGaStUTURzZWRSNFFleVdURU5FN1FmQTFxUlZMYkJCVWx4ZHliS1dWbQp5ZjczbFZLUUhsb1RjVlAvT1RVQjBpYzNxbFdTUFVrclcwY2wrUy9JV0huQkFBQUFnUUNMS0dkRGZBUkVQekdVdTFoamloCnU3ays0YXVqWlRsaFdjcmxnSFB0RXM5a2pGd0ZTUktTbG4yTFcwblM4TGptN0VVejFYeE5UTzg5enFaUkdTR1JUT2lnVnAKYnlFMTN1amhvVVVzUzhkRDVteTk0ZGF3ZjFMNDdDcys3QVpPcGtkWHdhRHBwRExkK0M5UlFNMmRGWndxWnhMWXEySFBURgp2andhSWVxRVgwQ1FBQUFJRUE3SG5DT3lyVTRrV01IWXBBMDBoOU5LS01mTlNTUVM0eTFMdUg0aGF1MnpQR1d0cXNUUzVlCkRuQktLU0s3MnArN3F6YjNhdHZGU1ZnenhnT1Jkc2RpK3pGV21HeFlqVG1CU2NPNHQ2VDM5VDZicW4rdlB4bHFjYXZFMjIKYkV2Q0I1QUdhbnZmV2tqanIyNGVCYjl5RTdNZVVXMDhEeXhGSGxMRGpBSENneXpPVUFBQUNCQU9XdTVHaVpKZ2VJWG5ibgpoUHdReEcrSnl2WTZEVHl3cUorODhCNk96QVN0RnFMNk1Eb3d4WWZmSGRNVlpKUVR3elQ4TjNEeHV6cmREN0lQN3lTY2dtCmpjbnV6aGRsYmRmM0VTY3AvWEs1MFBvcGM3UEZrYWIvSzIxN2NQbjU3Zmx2bXR5dlFBY2VkczZoMEMrT0ZYNUF0L1hMUjAKcVFtK2dxenBmdzRBcFFaeEFBQUFRVzVrYlhWelpYSkFZWE5vYVhOb0xXVXlaUzFrWVhSaGJXbG5jbUYwYjNJdFkyOXVkSApKdmJDMXdiR0Z1WlMwd05pMHdPUzB5TURJMUxURTVMVEV3TFRBd0FRPT0KLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
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
	JOB_SERVICE_URL = "https://172.30.205.247"
	CONFIG_SERVICE_URL = "https://172.30.205.247"
	ADMIN_SERVICE_URL = "https://172.30.205.247"
	REPORT_SERVICE_URL = "https://172.30.205.247"
	KEYCLOAK_IP = "172.30.205.247"
	USERNAME = "admin@datamigrator.local"
	PASSWORD = "Welcome@123"

	NDM_VM_USER_NAME = "admin"
	NDM_VM_HOST = "172.30.205.247"
	NDM_VM_PORT = "22"
	NDM_VM_PASSWORD = "Welcome@123"
	BUILD_VERSION = os.Getenv("BUILD_VERSION")
	REF_TYPE = os.Getenv("REF_TYPE")
	NDM_NEXUS_USERNAME = os.Getenv("NDM_NEXUS_USERNAME")
	NDM_NEXUS_PASSWORD = os.Getenv("NDM_NEXUS_PASSWORD")

	// Initialize the CONFIG_WORKERS map before assigning values
	CONFIG_WORKERS = make(map[string]string)
	CONFIG_WORKERS["172.30.205.248"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUFtL3FFYWZ3Y2drN2ZPMjNYTXlxMXNwT1VoQ0RibjRJTnE2NERmMnN4VDZ4UkV0VGowWk90CklpY0w1RnMyeE9mYnYwUGQxT3pHdlJOR1lxSjc4aGQvK2NMRlBSSCs0WmRpcFNscWd0WFZNcXlpMmoyM3ZyOVRnMXJKbmUKTEVWc0g1UDdHY01jSG1YR0tJcDlGaFRMNll2L052WlFINTNPcHVURXFoak1QcXcxK1gxOVNITGhPWjNFdG9maUhCSHlvdQpvUmxOY2YzaERrM2gwdzcxL0ZpNWR0eURQYlA2aW50anY5eStSMUZwRm90VUhzODc3QjFFakFyTTZjaUpSaStoa2sySXo3CmpmazZYRThhWmZ5SCsrbEswL1FOZmdGdFc4aGxIMk5GM1FaTHdqZjQrSkdKWHVaZHB1cDZ3ZzNUSTUxMHdQc1E4eVpFQzEKSnRPelJWcUEwd0FBQTloVG5aYVdVNTJXbGdBQUFBZHpjMmd0Y25OaEFBQUJBUUNiK29ScC9CeUNUdDg3YmRjektyV3lrNQpTRUlOdWZnZzJycmdOL2F6RlByRkVTMU9QUms2MGlKd3ZrV3piRTU5dS9ROTNVN01hOUUwWmlvbnZ5RjMvNXdzVTlFZjdoCmwyS2xLV3FDMWRVeXJLTGFQYmUrdjFPRFdzbWQ0c1JXd2ZrL3Nad3h3ZVpjWW9pbjBXRk12cGkvODI5bEFmbmM2bTVNU3EKR013K3JEWDVmWDFJY3VFNW5jUzJoK0ljRWZLaTZoR1UxeC9lRU9UZUhURHZYOFdMbDIzSU05cy9xS2UyTy8zTDVIVVdrVwppMVFlenp2c0hVU01Dc3pweUlsR0w2R1NUWWpQdU4rVHBjVHhwbC9JZjc2VXJUOUExK0FXMWJ5R1VmWTBYZEJrdkNOL2o0CmtZbGU1bDJtNm5yQ0RkTWpuWFRBK3hEekprUUxVbTA3TkZXb0RUQUFBQUF3RUFBUUFBQVFFQWhiT2pKM3BOTWNITUJwUXMKQUpjZXN0bGdXRFlXTEU5OXltamFaTEdNemwvR0N4OWp2WFVaMW9tajN2WDFKNm9icW9MUk4wQlRSeVdya3NiMitkajlBUwpuY2luSFBpcTZLaDByT0d5S1NvdUpxb2lwL1E4bWJHNkNKN0lYQ2lSK3l1TTlWTlMyaGVoV1lVRW5oWHJpT0ZSUGxxNjZhCjhLd2ZLZFJiVUY5cjhGVzlMWmxMTzFSUWphTnZpYVorbnB5SzhMcDV0RUNpeFdGTnhMWlRGNCtKakxXdEtTb1p1Z3RWUVUKOHJCYnVpcUZLL2Q2SjNQdlhqeWhaWEt0dFBEWmtMTU9CakFvV1owR0kybGVYMDNudnphUGpEZGdmNEUvNGdwNkFZVXI4aApST2E4elY1WnV2UklHSDI2R2JvQndJY1YrWGFESGlqTGsvMW5mS3k3MCthVVNRQUFBSUVBcjNSNkRJalFWYll6YisvZ2J6ClVpMGU5cnBxYWM5VTIwbGEwRjgzS3FzY1A0VEk0N0JoOTY5TTNadldPcXdidlJGUDhocGFFd3dQbmRxcHhJRVFMKzV6RUoKYm9RSjZlZlNEelY3UElYdThwWnF4WXFGdVZCQ2JWTlZaZjhJSVZFMzNWWG9xeUE5RytPZHAxS2FVRlFHR0NLcFJuVXRtMgptMVFuQ1kwajNNckZVQUFBQ0JBTWYrREZzUDVydW55c2NvMTgwYm5RNkF6TW81b2lpT2F2dzU5NWM1M3dBZ3MzWUN4MGorCnUwWjd2cm4zbVo4ZmFqNEVsUWpLbjVDNVhWUS8wUDZWckFtU2ZHNFFVb0Z3dnpTMkw3czZGeXlMTlFpdWNEVmZrVXl0YzkKS1lyRy9FaytjbXRvbmFvSVhkZERYS09TUVJ0QUhEK0lRSzE3V3VocUE3c1N2Q2VFV1BBQUFBZ1FESHFRS3ZjSHRVMVhLUgpBVVFzYzcvQmpydGZ1Tis3cVh5dnllRGRUZUdScHlJVFVhK01RVTUrSGtCQnZyOHhPM2JzWlJKOWlBdlhmSUR4aUpmOFpHCnVleFhtak1LRkxCMThjUytjWStpYXEwRnNJVmxZN0x0QzlmYWoyb1kwWUpvb01qOFhVYWVrOGZYMlhxSUFudExvVkYrQm8KM01tYTFBYlF0cEJrY2xYV2ZRQUFBQnB1WkcxMWMyVnlRR0Z6YUdsemFDMWxNbVV0ZDJsdVpHOTNjd0VDQXdRRkJnYz0KLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
	CONFIG_WORKERS["172.30.205.252"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUE3cHhVMVM4L3dTVE44Q3JXdGRwck9oMzYvNTNGRUVHamlZUllyMHY2cUJ6Q0dzdXl2YzVpCnhXR3Mxdyt5cWxaOG1MRWdrTjk5UnZlMDkvL3hCbjBLRnB1OHZrR3Rna0N3bUg0ZzNJbzFCN1Z2MUxFQ0hEWm5hcWRXTzUKcUczLzdES3JVOVZMK2Q1OTNlVDNUTlhjR1IxM2kvbTgzeFFXQjNkWlUwOW05U1V5VkpjM1JwK0Q5NEx1b21tSkJydmRRdwphUWtsZGJid0pxWC9TVWJ6K2pyTUt1RytKMDk3N2xyeXYvZW9RR1FmRGFFdFJ0TkRxVU5QcXBlZWhzdG9Rc1lXY2JFZzRhCjFDejQxNmNENDdqRkZPTkl0Q1RRVkFVSjMwdXBMb004SE05WjVUMXNCUVA5L1BwNTFINXV6WFlmcGVmMUhkRFpYZVRBRUMKTDVsMG85MUNvUUFBQTlnNzZIR05PK2h4alFBQUFBZHpjMmd0Y25OaEFBQUJBUUR1bkZUVkx6L0JKTTN3S3RhMTJtczZIZgpyL25jVVFRYU9KaEZpdlMvcW9ITUlheTdLOXptTEZZYXpYRDdLcVZueVlzU0NRMzMxRzk3VDMvL0VHZlFvV203eStRYTJDClFMQ1lmaURjaWpVSHRXL1VzUUljTm1kcXAxWTdtb2JmL3NNcXRUMVV2NTNuM2Q1UGRNMWR3WkhYZUwrYnpmRkJZSGQxbFQKVDJiMUpUSlVsemRHbjRQM2d1NmlhWWtHdTkxREJwQ1NWMXR2QW1wZjlKUnZQNk9zd3E0YjRuVDN2dVd2Sy85NmhBWkI4TgpvUzFHMDBPcFEwK3FsNTZHeTJoQ3hoWnhzU0RoclVMUGpYcHdQanVNVVU0MGkwSk5CVUJRbmZTNmt1Z3p3Y3oxbmxQV3dGCkEvMzgrbm5VZm03TmRoK2w1L1VkME5sZDVNQVFJdm1YU2ozVUtoQUFBQUF3RUFBUUFBQVFCQk53a1lteWxacUsyQWpyVFEKVHpvdlVESmgyc1VaaEZjbUpyMzJhMVcrek4xZ1pYd2MxR082ZnMrMmw5dkZJbzQ3VFc0UktvUWErV2pFdjNjb3h0UVRDYwoyMFVrOFI0b3hob1ZkcDczdys5eC94aWMrQjFueTljYTduNjN3aGpJZmJERjRPNDdCTXh4OFRxR0RZMXliOU5VdHBVZ2cyClRoOVlTOGVGOHpjVThmemQ3TU1OUklwV2dwUDI0QWU2RGhXVEg3ZUZZVzViVHl5eDFoS0ROUFpoaXFacXN4dFFWQ0RpdnAKNi9PYmlmQTZCMVdqSWVZOFppSWljbm5STm4yWTd2ZitGUkEyU1ZuUUdISkRMQ3ZURi9TOUk4VERkUFk0cml4VnZBZHk5NApvek1BT1YrditIcDgvc1M3eHJEMmliS1Nnd1FvbXljLzBTNFdRWmNVRDJ0aEFBQUFnQUZtSG1PNzF0TkllNnJGd2ttdG1mClpodG1GRko5aElHVWl5UXFyZDE2RkUyNStMOXlOWEpseVVaWU1aVlFyK0FpRVBJZlF2OG96b2JGSXM3Uzl0WXg1V2xZdHQKWGtwanVRN3djYzZ4OHlVV1lYSGVzU2pZVWQweFM2YXZRWkxwZUlHc0RTTE1kcTQvNzdjSFVZa2ZtbjluSGFDOWw0Q0ZTMwoyV0J3N2hxaldPQUFBQWdRRDVjRmFDNWJLN0xSRzZHZEViZ284amROMkpNQStCNEhXdlNCRzR1ZG1pVlRwYk5OQU1RV2FiCm1UMnUyaGtaS25BVTNiSDJ1MW02RlZtUmdNSTgwVUNjalhQM0ppYVg0THF0TThlaHZHUGJ4bWVKMVJlbllTR3BqY1NFR0MKV1MzZUZZSkRhZHBURGpoSUJTUHBHbjluOVRaNzhHbFNMY3REZGdGRVRoOVZDT0V3QUFBSUVBOU9NVVNNMG5Ob0RxNlRjNgowU3h2N3FNazhPdzZwS0YyK1ByaFB3R2R2VHh0aUYrTnBITTQ3TldON3VsUStIL2pBc2w2WUZ1MHNVaEpQTXFGTHBNUXdYCk9GRWJXRFl1TG80WWRpNkdCektST0NRVlB2SllTbmV2M3N0aDVQOXhnTEJmQlU0QmRPMkNvUjJCOVU4WDBxTVAzaDNRemUKUVpROHI1dEhIb3ljOHZzQUFBQWNibVJ0ZFhObGNrQmhjMmhwYzJndFpUSmxMWGRwYm1SdmQzTXRNZ0VDQXdRRkJnYz0KLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="

}

func UpdateConfVariables(protocolType, environment string) {
	PROTOCOL_TYPE = Protocol(protocolType)
	CLOUD_ENVIRONMENT = CloudEnvironment(environment)

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		switch CLOUD_ENVIRONMENT {
		case AzureEnv:
			NDM_WORKERS_HOST = "172.30.205.248, 172.30.205.252"
			NDM_WORKERS_USER_NAME = "ashishe2e"
			NDM_WORKERS_PORT = "22"
			NDM_WORKERS_PASSWORD = "/7DnO!1rlSsej]Q,yu.V8rv)GFz}UtQ"

			SOURCE_VOLUMES_LIST = "sfsd1, sfsd2"
			DESTINATION_VOLUMES_LIST = "abcd, abcd"

			SOURCE_HOST_IP = "172.30.114.67,172.30.114.67"
			DESTINATION_HOST_IP = "1,2"

			PROTOCOL_USERNAME = "ndmuser"
			PROTOCOL_PASSWORD = "test@123"

			SMB_EXECUTABLE_FILENAME = "C:\\Users\\ashishe2e\\Downloads\\windows-worker-installer-2025.09.06183801-nightly.exe"
			ProtocolVersion3 = ProtocolVersionSMB_V3

		case vSphereEnv:
			NDM_WORKERS_HOST = os.Getenv("VSPHERE_SMB_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("VSPHERE_SMB_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("VSPHERE_SMB_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("VSPHERE_SMB_NDM_WORKERS_PASSWORD")

			SOURCE_VOLUMES_LIST = os.Getenv("VSPHERE_SMB_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("VSPHERE_SMB_DESTINATION_VOLUMES")

			SOURCE_HOST_IP = os.Getenv("VSPHERE_SMB_SOURCE_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("VSPHERE_SMB_DESTINATION_HOST_IP")

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
			NDM_WORKERS_HOST = "172.30.114.81, 172.30.114.87"
			NDM_WORKERS_USER_NAME = "ubuntu"
			NDM_WORKERS_PORT = "22"
			NDM_WORKERS_PASSWORD = "Dm@admin123456"

			SOURCE_VOLUMES_LIST = "nfs/LargeEDA_70G_1, nfs/LargeEDA_70G_2"
			DESTINATION_VOLUMES_LIST = "gcp-sanity-1, gcp-sanity-2"

			SOURCE_HOST_IP = "172.30.121.91, 172.30.121.91"
			DESTINATION_HOST_IP = "10.127.176.21, 10.127.176.21"

			PROTOCOL_USERNAME = "Root"
			PROTOCOL_PASSWORD = ""

			ProtocolVersion3 = ProtocolVersionNFS_V3

		case vSphereEnv:
			NDM_WORKERS_HOST = os.Getenv("VSPHERE_NFS_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("VSPHERE_NFS_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("VSPHERE_NFS_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("VSPHERE_NFS_NDM_WORKERS_PASSWORD")

			SOURCE_VOLUMES_LIST = os.Getenv("VSPHERE_NFS_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("VSPHERE_NFS_DESTINATION_VOLUMES")

			SOURCE_HOST_IP = os.Getenv("VSPHERE_NFS_SOURCE_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("VSPHERE_NFS_DESTINATION_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("VSPHERE_NFS_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("VSPHERE_NFS_PROTOCOL_PASSWORD")

			ProtocolVersion3 = ProtocolVersionNFS_V3

		default:
			LogFatalf("Invalid cloud environment: %s. Valid protocol types are: NFS / SMB.", environment)
		}
	default:
		LogFatalf("Invalid protocol type: %s. Valid protocol types are: NFS / SMB.", protocolType)
	}

	InitWorkers(NDM_WORKERS_HOST, NDM_WORKERS_PORT, NDM_WORKERS_PASSWORD, NDM_WORKERS_USER_NAME)
	InitFileServer(SOURCE_VOLUMES_LIST, DESTINATION_VOLUMES_LIST, SOURCE_HOST_IP, DESTINATION_HOST_IP)
}
