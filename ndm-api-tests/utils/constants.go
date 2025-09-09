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
	CPSSHKeyData                                     = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUE0QkZMQTFOektLdmpTSGkyWWh2dmlaa1JGZ1VBN2p4K3ZZeHl6dTJDV0NjVTR6Q0pTOXRQCkptMUtIU1VFbHkxK0NINDQ5UzNzbnRUL1FPOXgwUHdIcXU1Q1dLSHBMckxkMllpK095ZFdJZ21maG9YNUdJM2t2QktCZzMKb0NnS1lMSnZ5N1QwRTR3QjFnckFJS0krSlh3S0x4R3lYRXpWMFdVNVlGYlNuRlhvbnR1NnB5K25rV1RwQVRWeVpyZG11MgpDd1o5QXFtQ1FCbWx4Nm42cnRZNkFER3JvcVZpdzN4eUs4dzNCOE9zc1M5cW5CUFlMTUI2T0kzai9UTFNKZ0VyTGVOdmRFCnNsb0RDVnlCVUJnTzJ0NlQrcEhBbFpWa0FzM0ptUHFPb1Iyc1RWVzcvVTBaVGplWXl2clJpQUU2VVNyTlErUEFEZ0J0Y1gKVjkvUW9mTEdoUUFBQStpLzVGNHV2K1JlTGdBQUFBZHpjMmd0Y25OaEFBQUJBUURnRVVzRFUzTW9xK05JZUxaaUcrK0ptUgpFV0JRRHVQSDY5akhMTzdZSllKeFRqTUlsTDIwOG1iVW9kSlFTWExYNElmamoxTGV5ZTFQOUE3M0hRL0FlcTdrSllvZWt1CnN0M1ppTDQ3SjFZaUNaK0doZmtZamVTOEVvR0RlZ0tBcGdzbS9MdFBRVGpBSFdDc0Fnb2o0bGZBb3ZFYkpjVE5YUlpUbGcKVnRLY1ZlaWUyN3FuTDZlUlpPa0JOWEptdDJhN1lMQm4wQ3FZSkFHYVhIcWZxdTFqb0FNYXVpcFdMRGZISXJ6RGNIdzZ5eApMMnFjRTlnc3dIbzRqZVA5TXRJbUFTc3Q0MjkwU3lXZ01KWElGUUdBN2EzcFA2a2NDVmxXUUN6Y21ZK282aEhheE5WYnY5ClRSbE9ONWpLK3RHSUFUcFJLczFENDhBT0FHMXhkWDM5Q2g4c2FGQUFBQUF3RUFBUUFBQVFBenVNb3dBbHRhMEJLdTcrNXAKeHprTDhpRlhpK0FqSGlQRGJXQXpFL0E2bVFyaFJwcnF2NzBOaWJ6SjdYbVp6QTZEdDE4K2VWTmRkcDFWUi9CbDVVZC8xVwovTE5kUzF5dVFiQ3MyZXFmM2Y3WWk5YkwrTFEzWEJWQ1JCVFRDMnNaMXhhblZ5WGdQVGxQUnp3Q1RIRThCZDN6NzRuVWRJCmdHeGU3d3Bob0hyR3ozRldiWjF4TjRwbWplKytFV3labkxITVhqNFcwN2hCdzZhN2JFa2N1MXVIUFRwSk5mUXRUTjQvYnIKZkRJM1EvRkVzMTk0VU9iQUp4WE9ONDl6WmtKTFFYa3RVemZOZytKOFBrSFRmdjF5dFQvZmE3SlZ6aUhHM01CUkY3MHRFNApLRGtON1grOW1wekNIdGc2dkVGanF1RkNzdEVLUk4zUlhKaEcvS3pvUVdZaEFBQUFnUURveU1uT0VXYUprdHdRWHI2Um5lCjVXVlR3MTFGbndJR1lmTDNsbkxSS2JYSGNScUxYZEZGS1UxQ1lML25ZRzd1RzVUUEtEUkZiWm9hUU11K0tKeXFBUElRU0wKMTRPTi9yRnFHZ3hGTHVHbjcyT2RSYlVhNlJRTHI4bDFIK1pPcXhaanJ0bytKUWxwYkltcVU4TlFFRis2ZkloVnhBZDc5UgpLY2VVQ1VCb0Ztb3dBQUFJRUE4TytPcXNDcDBOajRlc3NKZ1hOUjl1c25nZXhGVHVnL1RGbkVLdTRtZTdaRGJRZFRGaEwxCkNNTDNLNVNQdXFhUk15V2pHM1RsNGZsN3Y4bEtxOUdqZEN1Q09RbGZrTnl3a3dvdUdoblNhY1IwWlVUVzRPd2kwQS9KRWYKUzZhUWFkZ1o0M2tTWWVnVzZQU3ZWZGh2WjcveDgwemVjOVZYa1BjL2g2eUxyTFFVY0FBQUNCQU80VHZjT2tpZVdDTFRldgpKL2hQa1RwTTg0UkdhNGJIVnA0M2oxMFIrUjBsR0ZKRFVsZ0JtazM5aDFud0dqdnFRT2NDZ3JENW9TNEUzcDJzV1JEaURmCmtqQmloZDQ2cUNQMmFWejYrS2x6Z0twT2dydlR1QTFnVVJSR3E4WHhlRWh1SXdmaWFDenlhcXozWGlURzlNNEc0cGdtZVUKc3A0VUNMb3c0RXRmaUwvVEFBQUFMbTVrYlhWelpYSkFZM0F0TURZd09TMHhNakkyTURrM055MWhZbWhwYm1GMkxURXlNagpZeE55MDBNREE1TnpjQkFnTUUKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
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

	// Initialize the CONFIG_WORKERS map before assigning values
	CONFIG_WORKERS = make(map[string]string)
	CONFIG_WORKERS["172.30.114.81"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUF5T3ZpcmowSGJIN3V6M29QelljVmFIb09XaUt0MGVzN3ErMWkwaTMvQ3RUdzlIc2pOTFpaCnBZYVNVMWt2K1RSVjJjWHVJSEJrOURXSHdSZ3pBU0xyZytWbnhrQUhPYi9mK3JvcE52UzlneEhMUlJRUXloa1VBSGVlSUUKa0xrV1U3aFhiTEx2WC9FYitFRGYrbmU0b1dPQy9xeTR5TlN1c3o0bGRJaVQ0U0tqQnVOSE10NDFjNEFuNXJGQ3YyUUR3aQo2a1ozdytiSlRFMFdTRWVIVW84R3dCcE1sOFV3MGFqVWF2WitMSXZ0c3dkTU9xMnRkVmxHUTFBRFpMd0cwekp0TlFxVXBoCkJqZkVIYlFaMWxVMjdTNmtPVFZBeGhBeitCM0dmRVh0N3EwakpXenA3aEdRT2ZseDB3OHdoVTEzVFFhbGpITzZJQkhRSXoKL3RhNmRubitkUUFBQStnbG9QVDdKYUQwK3dBQUFBZHpjMmd0Y25OaEFBQUJBUURJNitLdVBRZHNmdTdQZWcvTmh4Vm9lZwo1YUlxM1I2enVyN1dMU0xmOEsxUEQwZXlNMHRsbWxocEpUV1MvNU5GWFp4ZTRnY0dUME5ZZkJHRE1CSXV1RDVXZkdRQWM1CnY5LzZ1aWsyOUwyREVjdEZGQkRLR1JRQWQ1NGdTUXVSWlR1RmRzc3U5ZjhSdjRRTi82ZDdpaFk0TCtyTGpJMUs2elBpVjAKaUpQaElxTUc0MGN5M2pWemdDZm1zVUsvWkFQQ0xxUm5mRDVzbE1UUlpJUjRkU2p3YkFHa3lYeFREUnFOUnE5bjRzaSsyegpCMHc2cmExMVdVWkRVQU5rdkFiVE1tMDFDcFNtRUdOOFFkdEJuV1ZUYnRMcVE1TlVER0VEUDRIY1o4UmUzdXJTTWxiT251CkVaQTUrWEhURHpDRlRYZE5CcVdNYzdvZ0VkQWpQKzFycDJlZjUxQUFBQUF3RUFBUUFBQVFBRUFEWjJVNzdIR1V2MkU2OG0KMzQ2OGt0bWdUOXA0T0ovcWo0S05QdDg2UHYxQlVRWmxjVkFkcksxVFBZNW4vdlBLcjFkTGpCRm1qMzVSaVFMUy9mZ0VtMQpmU3FjbTdDNmdSSFEzZkMwYU95cGJxbkRpdFhZeDVhZWhiS2preHZ2dE5jQTBodFVKTC95MUkvaE0rc1lRNXdES0R0UnZICkp5SFVXdnFWeVFlaGtXWTZEenJPaHlpd0RPRUhqVkt1WEVENUFMSlNJYTFMK2t3c3JucThVNkVYUC8vMTAzZm1lOUg5THcKV1U5Q0hleTVSU2FiUUJrR0dLdCs1OGVCckxuRmN0TyswaTd4UTlIQ25BaGI3bXVtTmM2Z1BmREtsN1VMU0JWbTNYbjR3cgpNbmJDQ0JoYkppSlQ4T3FBbFE2RzlRaGRUVTZqYVQwSTZZT0pPS2xYRGpTaEFBQUFnQVZZT0JHdkY2RkFtbm03NWlBcVNYClhGWGJKczdhRzgyQ1ppMHp4S3YxQk5qbjdicFVVdTNCQVZZd05zOUxVWk9KVS9mY2JiSEpzWlJJUTZUck9Idi9UWjUxdkcKcktpTUZVSllEQitLK0paWE94S0M4b0RpUCtOMDZIWjRBVW1kTk41S2dQMVd2SHFQNUkwTExmQlp1d2NVL3hBSGN2TDlBWQpodVNBaWdmamhDQUFBQWdRRDlQditGL0hmOTk4QU1JU1BHSUhnOHNnQnFTZkxxNktZNDN2SSs2VDZlYi9iMlB2bk9NMDN1CkNjVDRTU1AwQmUyTm41RHVaeXRVSDdEalV5dWlMenhFcmZnb2NNMFd0TS9qbDlIZXRGRzFWbkpNU1FpTWtrSmdOZlZ2ZGgKZHR1a1lvZHVvWTFyVk9JemhuMFUweEhZQmRtL0tmT2JudlA3QUd4bnV4dGEyNXZRQUFBSUVBeXhzNUJ4ZFZGT3pRbVZLeApiNHgwbFBTcERlY0YxUXA1aFNQQzIvZmJhTHFqeVZYMnlzc2k1aTdHcURqOTRmUTR0MWxrRWNrL2xJd1dLTkZORGkrYlg3CndFYkFvUVF5RTJLYjk0MnhQRytzdlkrRjNqd0F0V09pbXlQMUlMbVphRi9Hc24yMitHVkM4djFNM2JmR1JReCtDMUJ4czgKaCsyeENNamtvbWljZHhrQUFBQXdibVJ0ZFhObGNrQjNheTB3TmpBNUxURXlNall3T1RjM0xXRmlhR2x1WVhZdE1TMHhNagpJMk1UY3ROREF3T1RjM0FRSUQKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
	CONFIG_WORKERS["172.30.114.87"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUFtTmtlMHk3YkVpNDFoa3QxaEN2YmhkSjYweWdXZUdFYUQ1SlZpUHN3MnF1eUNPc0RRRzgrCllzVzBKeUcwdjNEaFFNaVhJTitwTzJPb0dtVW9JOEFRTGpPSmNCQmJ2Vm4xSit5T0M3UlZDTEw4cU9mTS9lbFVlNXc1UFMKUjg5dVMxSHgzbFd0WTlqUTRIMmlRU051RVBGTXZnLzZ6ajhvNHJnRlV2QUVsWVdBTjZoYWowY2xQRmhadVRmc05HWjhkdApacVlVSGtYNEozdUp2VjBpanRUNE9nOWVSNkMvdXNDSWsxTGhaTFFJNnNudytKS2ZtUmkxV1RtM0dEUjlGdndiVE5oOExvClZLSk9YQWVrYnpLVGxKN1JjRjNHMXBRRFhCaFdPOXJaL0ZzcnF6SWpCeTJlZU11dWt3b1hsZURRSmhyd1RWVTJVZ3RNckwKdHF0ZUtMZWZ1d0FBQStpRkROUFdoUXpUMWdBQUFBZHpjMmd0Y25OaEFBQUJBUUNZMlI3VEx0c1NMaldHUzNXRUs5dUYwbgpyVEtCWjRZUm9Qa2xXSSt6RGFxN0lJNndOQWJ6NWl4YlFuSWJTL2NPRkF5SmNnMzZrN1k2Z2FaU2dqd0JBdU00bHdFRnU5CldmVW43STRMdEZVSXN2eW81OHo5NlZSN25EazlKSHoyNUxVZkhlVmExajJORGdmYUpCSTI0UThVeStEL3JPUHlqaXVBVlMKOEFTVmhZQTNxRnFQUnlVOFdGbTVOK3cwWm54MjFtcGhRZVJmZ25lNG05WFNLTzFQZzZEMTVIb0wrNndJaVRVdUZrdEFqcQp5ZkQ0a3ArWkdMVlpPYmNZTkgwVy9CdE0ySHd1aFVvazVjQjZSdk1wT1VudEZ3WGNiV2xBTmNHRlk3MnRuOFd5dXJNaU1ICkxaNTR5NjZUQ2hlVjROQW1HdkJOVlRaU0MweXN1MnExNG90NSs3QUFBQUF3RUFBUUFBQVFCNk1ncU10d2I0Nyt4bW91a2UKYzVtYTBQelUxMVd2ZzZHOEZUZEF2ZUQrMFFrU1RDQmJZUlExRHUzSjR3Nkhob3p1cCs3Nm54VENvQmVDa3FDV2hEUHJXOQpSaXZSRTZ2akphYXFuYy9aeUZ5ZUpvZm5qSi9jSkcyRXlDYnl0Z2p0T21QdFpmMnF0Mm0yTDNxS0xQTVBwSG0vOFRLSHRNCkxSRG1GalB2UExQZUdCMktvL3JQQjJ1VlN5K2VHZFdJeWNrMWJ1QVp3VXFQMHFlRVc2dXF4aHp6aWNiSHVqcmJGT1A2cnIKUmJhM20xajhYY1FYbGhDM1ZvVHlqNHBETDFxU0JMdC8wY0FranJoUUY0VWl3b2ZZZmhaZ29vVUJEK0RtaThBYm95elBWcwpVSWpuZTlaVi91REk2U1J1cnUvUjZLSzZIdFdncFk3OU9NOUNKbDdISzB2QkFBQUFnUUNLNEtrc0FHUG8weDk3TzV0aGlhCmF1ZFFtRWVsSDZEUnpvcXo4dWxhZ0JyMTFlNGNSZUtsZjJlZklUMFNpQ2c1SmF2RUc5WHBpUVhvVEREOHlyVzFjNHZ5WVYKL3BLZm9EMlhTRVBkUjNtVlJvc1k1TWg5UWgxejA4VUlmeDFoSHl6NnJkRnpnQk1SV2lOSnI0WHNXbnRyVUg2WWQyVlVZagpnWFZONjRmK1orTmdBQUFJRUF5Q1hXbGwxM1VZSk9zWklycEJmR3BMM0NRY290ZU0rTm9MWXlGV0RoZVhqQVIycC80U0JwCldzMXJ1MStxakRxQVRRV0FtcDY4NHJneHdDc3hkQks5VnhKVU9VT3JiKzkwek1pRE90K3NOMEJNVit4d3FCWEV6L0tLZTUKUDVRRk5ZVlhUTU4yc3lsb2ttTTNEeW5HMEFocUlzaDFUNnpIODFCcXpNWnNTRGZPc0FBQUNCQU1PQVNYdUNtZEJzbkZESQpVaWYyYjJuMlJsMm4rNE1GcVdrMnJ5UVh5Z0VNWW0vQTJrMWlCbTA1dC9rMFJEakI4c25wL0U2K3ZxVmJJT0NPOVpjN0ZmCnBhS0VoQXdyVWRZZlRvMEFWSFRoU0I4UCtBNkJtR1RVMEhYbnI3SitTVGVFVGdKMjVUa0ZUK29tUjR5MU1sclgvcjZrSGMKQUgrdWZ4RVVsOENoZVhSeEFBQUFNRzVrYlhWelpYSkFkMnN0TURZd09TMHhNakkyTURrM055MWhZbWhwYm1GMkxUSXRNVApJeU5qRTNMVFF3TURrM053RUMKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="

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

			SOURCE_VOLUMES_LIST = os.Getenv("AZURE_SMB_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("AZURE_SMB_DESTINATION_VOLUMES")

			SOURCE_HOST_IP = os.Getenv("AZURE_SMB_SOURCE_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("AZURE_SMB_DESTINATION_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("AZURE_SMB_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("AZURE_SMB_PROTOCOL_PASSWORD")

			SMB_EXECUTABLE_FILENAME = os.Getenv("SMB_EXECUTABLE_FILENAME")
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
