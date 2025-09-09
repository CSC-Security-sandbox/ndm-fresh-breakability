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
	DefaultPollInterval                              = 5
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
	CPSSHKeyData                                     = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUFzbThoMnUyYTRtenhFNTdwdThrM3VMUDNpcm9KS1drdm52eEJYaFZTSDZzalJCSEw2czhiCmgvZWt4STg5SHFIV3FGVXc3dXkxWkxhUnRiRmtDa0drSVBSSVVIS3BISUZVYnBEUmJhUS8rS3lSaGVrWEo2OVFFSzFpNGMKN2JtcmIvS3pWQXc2RzFlRXNzQk9mRGtONGNzZjU5L3RRcjE1VWU2UDludjZrLzNmNFZBWXpBVTl3SVZBV2g4Rktid0d5Wgp6RDQ5anFhOGxxL3pnVkNoTGxpWWZIeWc3N2pna2hKUjRqZklvd2xkMWNYd2cvTm8rUk5tbU1sSFlFbGNRUVQ1NU0zNWlPCnpMcWgrMDVNOVFCV29OT1BjZmN2cm5wOEVTVkVtZGx6a3BZUnBEZld3bGp6SHRPamtTZVJBbFUzYjhNWW5iQVFSS1VCUFEKVy9kU2RDbjN1d0FBQStqZHY0dXczYitMc0FBQUFBZHpjMmd0Y25OaEFBQUJBUUN5YnlIYTdacmliUEVUbnVtN3lUZTRzLwplS3Vna3BhUytlL0VGZUZWSWZxeU5FRWN2cXp4dUg5NlRFanowZW9kYW9WVER1N0xWa3RwRzFzV1FLUWFRZzlFaFFjcWtjCmdWUnVrTkZ0cEQvNHJKR0Y2UmNucjFBUXJXTGh6dHVhdHY4ck5VRERvYlY0U3l3RTU4T1EzaHl4L24zKzFDdlhsUjdvLzIKZS9xVC9kL2hVQmpNQlQzQWhVQmFId1VwdkFiSm5NUGoyT3ByeVdyL09CVUtFdVdKaDhmS0R2dU9DU0VsSGlOOGlqQ1YzVgp4ZkNEODJqNUUyYVl5VWRnU1Z4QkJQbmt6Zm1JN011cUg3VGt6MUFGYWcwNDl4OXkrdWVud1JKVVNaMlhPU2xoR2tOOWJDCldQTWUwNk9SSjVFQ1ZUZHZ3eGlkc0JCRXBRRTlCYjkxSjBLZmU3QUFBQUF3RUFBUUFBQVFCSnpqWU92R0ZvYnU5NDBpNlUKQWpNT0wwS2hHenBXNnE5TDc4T0tDditoSWNUQWp5dnR3Q1QvSkt2K3NkRHlMcmIvZ2QxdnRuR0JheEx5T0tITXJFSWJiMgovSjl1T0VhdXBsb1hrL0JNV0JNc0F1eDY5UU51L0ROalRFZWkvVDJ3WEk5WW9JWVljU2J1V1NVZHRPdk5EWnZ3NldyV1JGCkUrVnBNdHZUSjBySG8zUElHbVFFWDhBdm5hank2b1lQbFQ1RU54NEt3WDh5Y3RlMTlrNUZKRkhpdEJVSDlqcjhsZ1d4amsKMzdqMnA5V3d3Rk41YXYyTm1DNVFTRzVyRFZVUHk0enJyWFlmbzYyZHBkNHJCQnJ3d2F0U2lUajJUMUVEK1dWeE40K2RkRgpRRjBpQWlaWEZUSDZmaTFVZEhZTUZ0Vi9JTlRJamkyVU5vSUNlUTY4empkQkFBQUFnSHpIK0N1ZHVyODlDUzI1bEg0V1czCkppSkp2V3Q0Rks5ZU03OVJ0M1RjTVFSTWJXUVl0OGxSUlJyamJ2MWhmd09UeWVWdm51cHJYWW9hL3BhdmMyY2dRWVpDazIKUzVrZUFvbVUrd0VXYUE4L2JSZWtyQUhjNjYwZjhmb2NiTWdPRWVZVUVNbzAvNHo3MFFQalVsRTdPMVppRmQxRDF1c2lHRAo0T20xZFVyYjdzQUFBQWdRRHBSbmN6QTA1dVI1bTE1Z0g5UTVPWHV4SktUSFRqWDRqYmdzQzNqY0VmaW5IUWgvd3hUK3lJCis3YXdOa0JBMW8ySnNsR3dTVHRqQlU4a3dLYTRjNjBTVENIL0JtcnozVUxUQ0hHZDhVOXhUSzU4S1FSN1lFM2UvNjZYMkMKUkM0VkRFMEtrT0h1d0hsU010WWZvQ1RwWmNCa1hHWWo2L3lzMXVqVFNKUnd3L0tRQUFBSUVBdzlFQ3h0dDl1eVV2Tm1uYQpPVHN6bk1kc0VoQ3RJSWpxZTRZQTdzVVljZVFNQm4rVWR0OHJBNUdXSSsyOFUzWUI5SUovUlkzMjAwMWhndk05QnpBSUpJCnhKYldhZkpCajZjczRuRnp4cWo3NHZ3RUZqVXFuWGorUmpvSjlwOTR0UDFsMlh3ckt2Z1dTM081dUNFdGlpZ2tWRlUvU2IKR1kwaG15Mm8rV1duOEVNQUFBQXVibVJ0ZFhObGNrQmpjQzB3TmpBNUxXSjFhV3hrTFRBNU1Ea3RjblZ1TFRBd016SXlOQwoxdVpHMHRZWFYwYndFQ0F3UUYKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
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
	CONFIG_WORKERS["172.30.114.79"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUExUWpqVTV0SlczcU9kbGNIb1hGZjYwdFhPUFlaczc1VUtsN2VlVkNRVFpIa0toUFExNzl0Cm5VMzBzMjRJVHFTZUd1dUdIT0t1MlNCRmNDbEo5eXg5cEtvbi9zUkpuZWpoa1ZxRFJCYWdySk1hUkNDajZ0cjhaK3RZZ1kKWDlidWpVTXJvQ3pqUXNxWU0wVE90Nyt0VGttV0FTbzZvdFUzR2ZKb2lpTlNuU3B0Q0tSSHh6LzBrVU50ZC9CT29vcnIybApOR094bXNaK2tjM0JaMXlkVUIyWUU3d3NqRjJsYW1vWFdqQ1JTaUhmQzVheFhsYUVWaEppSldMbnBlckRLaFg1THEwMVdNCmh1WEh2UExlVldzUFRVSWVOblZUakJmaFFpeHdsMFhOaTVTMmtCaVM5MnJpQVkrZlNmZnhQcEN2cjVxZzE1eVlURy9QTWMKUHZ2QWJzYzgyUUFBQStnaGVEMEhJWGc5QndBQUFBZHpjMmd0Y25OaEFBQUJBUURWQ09OVG0wbGJlbzUyVndlaGNWL3JTMQpjNDlobXp2bFFxWHQ1NVVKQk5rZVFxRTlEWHYyMmRUZlN6YmdoT3BKNGE2NFljNHE3WklFVndLVW4zTEgya3FpZit4RW1kCjZPR1JXb05FRnFDc2t4cEVJS1BxMnZ4bjYxaUJoZjF1Nk5ReXVnTE9OQ3lwZ3pSTTYzdjYxT1NaWUJLanFpMVRjWjhtaUsKSTFLZEttMElwRWZIUC9TUlEyMTM4RTZpaXV2YVUwWTdHYXhuNlJ6Y0ZuWEoxUUhaZ1R2Q3lNWGFWcWFoZGFNSkZLSWQ4TApsckZlVm9SV0VtSWxZdWVsNnNNcUZma3VyVFZZeUc1Y2U4OHQ1VmF3OU5RaDQyZFZPTUYrRkNMSENYUmMyTGxMYVFHSkwzCmF1SUJqNTlKOS9FK2tLK3ZtcURYbkpoTWI4OHh3Kys4QnV4enpaQUFBQUF3RUFBUUFBQVFBL1c0UllZaStnQUVRTVYvZlMKQU9qNURwQWpSYllCS2hMWUF4MEJVWCtKUW1Gc1RqWm5ZK3hTdzFPS1phZ2MwNEtlR1B2cTdWUDVDVXI5ZjVvYTQrVitLbwpqNGtTSWZ6NW4rWTcvMGFSSmlJT0hIN3prdzZPMzJiaDBGY0hjZUhDcTM1M0JjS1ZJN0crVmJGeEhwV0pXZ005MTNSVzV6CmliQStncFpUWDF2aDlrcDVOekNiOUJTK3NIcHVLTzI2SzZzMzdzNi9ZNXQvNjFaZlRSb2I0VE42bEZlQUIyK1FHdlZubTIKcVpzNWRBdEs4SDY3Rnp4d0kzb0NqUUdjcmF3L3JQYjZjbVBiT3JQSTlyYW1DK0ZUZXZZZmJKWm52VXBPY0NWUlQrb2pkMwpaalJ6YjN3Mis4TXptcFRLU2RVeEdoVE9GN3prdUVpcWtzQzhmQnJnNXFjeEFBQUFnUUM3ZFQ0RVFwK1BjL3ZDSTFwQk1SCjQ1SXh6YjZnVWZsR25MbkxtV0phd2ZzSG8zVFpPUmw0Y2VWSWJBaXArUDdzKzdJQktDdis4OWhKSi9EQnlWTTE1UnFhTXIKSCtIVUhoaGQxVGx0M3pWNnB0WVgrQ1NucXVieHZmaWh3cTRKQ1h3aGxkY2RBMTdxTFEvQ0UzTGRDYkZTekZsYlpWTjVPZwpqNnp0SHVCSmhiSlFBQUFJRUE5dVpKaW1idXJhMDlPYkpnaHNVR3ViU3A3cW02cVZ6SUtKSUUxM25SczFBVTNvUGJrcUpDCnRKNkdwZHZqbzg1R2RaeWpUV1lONFpLbTZCQVIzeUdWM2JGcHlVRWlvc0pMWkZ5MlNMbjY1d0J5U0tkNkRwWld5RjVlM1MKSnFMb1FlYTdIcEZzUE9sOWgrM0o5S05JL20rdmV4REtXT0E4Y2pkdlNLMmE2eE9NVUFBQUNCQU56akRuRGdUb1NhMkZERQpZWGdvWmpFTTA2UGp2STVOS2k5c0tFellMd2h0TzM5cHlBVEphR3Q4ZHNrRWJsRUoycXdMODZJZXdhTEEyMkl1VFVZcVJWCkx2elIwOFVnb09laGVGR1lNa2cyZmN5eTNsZ213enFNTmY5UWdPS3FMNkVwOUdxdDZhTDc4MktaY200MzZRd2xxQXdraGkKZ2NpZmxzaUtQOWNSWkswRkFBQUFNRzVrYlhWelpYSkFkMnN0TURZd09TMWlkV2xzWkMwd09UQTVMWEoxYmkwd01ETXlNagpRdGJtUnRMV0YxZEc4dE1RRUMKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="
	CONFIG_WORKERS["172.30.114.85"] = "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUJGd0FBQUFkemMyZ3RjbgpOaEFBQUFBd0VBQVFBQUFRRUF3R01mbSs3MUF1bC9ZU1Q3RkxYWnhWUzhMcTJNUWk0Sm5EMk1NK2k5YTZ4QUVIUWY3Y2Y4Cng1aFJMcVVqK2FkT2ttTWZ4MHFqVjducDMwajJ1TU1kKy9xMlJwQjlrVSsyRlVPbXljUUgyc3FRUGNFQW9nUjlwUHZSVlgKZTh5Z0s1eHA5RG1TSGRQTERCZUJNeHJPMWV3SzNWUXhUZ1pZeExWeGlHb2RxN2lheDhWNHo5STdiTjRqNnJIbzJvUlA2RQp0bEE1WnRLZkJydWtMajJmRkRUeW1kQzQ3c3VtUStOZmY3QlFFNGxESnlucDFLa1RNRGhxKyt1enpWaUwrc2NJcTJqazJvCmZ0bnpIN1hhRTlra0IwZjRyYTlzZWE5dXUzb203Ynd3bUFIUkxqMmlRWTZDUkdPRVErM3E3a0p6UE5keSsrQTdDbVlaZm0Kc3Fiek93alFiUUFBQStqRkZrTmd4UlpEWUFBQUFBZHpjMmd0Y25OaEFBQUJBUURBWXgrYjd2VUM2WDloSlBzVXRkbkZWTAp3dXJZeENMZ21jUFl3ejZMMXJyRUFRZEIvdHgvekhtRkV1cFNQNXAwNlNZeC9IU3FOWHVlbmZTUGE0d3gzNytyWkdrSDJSClQ3WVZRNmJKeEFmYXlwQTl3UUNpQkgyays5RlZkN3pLQXJuR24wT1pJZDA4c01GNEV6R3M3VjdBcmRWREZPQmxqRXRYR0kKYWgycnVKckh4WGpQMGp0czNpUHFzZWphaEUvb1MyVURsbTBwOEd1NlF1UFo4VU5QS1owTGp1eTZaRDQxOS9zRkFUaVVNbgpLZW5VcVJNd09Hcjc2N1BOV0l2Nnh3aXJhT1RhaCsyZk1mdGRvVDJTUUhSL2l0cjJ4NXIyNjdlaWJ0dkRDWUFkRXVQYUpCCmpvSkVZNFJEN2VydVFuTTgxM0w3NERzS1pobCtheXB2TTdDTkJ0QUFBQUF3RUFBUUFBQVFBaVN3ajlZTERuM2Z0SXM3RFYKMWp5RlFqOXhDcHB2eVlrSkFxZVZNUzFpbmdlbFp5MngwdTRxSGVxS3FBRXJwVGtLT3dVVkh5YlNvbDhmMy8rcW00MGl0MgpQNlhCTWw3ZEdGSk5QOEx5Yy9SdEJEVWIzdEkyUEtIdUVIblJwWDMvaUJnUzRwZzdITithdmkzWGtEWENTQnIvck54RkRqCmlRaDg4L0E3dGFPc1BIV1IxZHQ5TWdtZ2pXcjJvNExnb0ZBVTc5bHpqQWJaRmk0alZ6Ni9SMGlPMEg2VGdSbGQ1L2dVblMKbFNrY3FGbWhWeHMvdmFRYnAvSnc3M1IwWWFaWXBGa0JlSENqNGhhTVJDK0haUU5UL2kvYWZGS1pETEdMTSsxSUQva2pjRgpKOFhBVlAyZi80L0pjU21qTnZTTWs0OVlTeVJxMFdOTUVVYTcrVWNlWG5RQkFBQUFnQXk0R0orSCttR3cyUzZrdU5JY2kyCnZqaG8reVRXcDNDMkxUVHhRRGJHMS9IZGFFRnVrK0lnOFJCZmU1RWs4V3I1M3hKeG9wdVpZRS9NR2ZwZmNHYzNkbDBGZFEKQm1yWlovZDVaWnVpRXNWcDlRcnVjS2h6aTZzVnRGNGlyZkEzVkF2dWhVdEY1UDA1NVRkMUdWNDRLczhTdFpkOXBUVDM1Swpoc3ZBTWpCd09tQUFBQWdRRG9hRVBoM0hGMWs4L2NKWnpTVFFmcDk3Mk52YzhGdHU5THk0Vlk1Sm5JN1ZLZnpybTZ5OUxmCkJUdzBTQWQvT3R5QkVQMzUrL0IwZHFkcTIzUjJWNGZITFdiVXJWUDBONStCU2F6bDJQQUY3UDcvUFlZeVp2OW5HU1g2engKa3JFUDZzVElzOEcxUVdxRzYyTU1mMnBjdFZoSFdmN0lqWWVmc0J3amZIdzc5cTdRQUFBSUVBMCtyVDRaUFpWWjZ6K3RmWApFMU12OWI5K3JTbmhVUTcvYkFmM0h5cmZPejhwaGZOVUgvOHplaHhJbHJIakNqRmN1ZVVUOGUzUWp3WHBlSEo2TlpoNUkxCnV1eEJEd1hacHYzQ0NQcERCeTFiMFIwdnZqaDVQM1pVYjZiaDhnY1VsS0d4QURhTnBmdWtGK0VyckdSKzdqYUhyajZmck4KajBsTERMVXRxcW15eTRFQUFBQXdibVJ0ZFhObGNrQjNheTB3TmpBNUxXSjFhV3hrTFRBNU1Ea3RjblZ1TFRBd016SXlOQwoxdVpHMHRZWFYwYnkweUFRSUQKLS0tLS1FTkQgT1BFTlNTSCBQUklWQVRFIEtFWS0tLS0tCg=="

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
			NDM_WORKERS_HOST = os.Getenv("AZURE_NFS_NDM_WORKERS_HOST")
			NDM_WORKERS_USER_NAME = os.Getenv("AZURE_NFS_NDM_WORKERS_USER_NAME")
			NDM_WORKERS_PORT = os.Getenv("AZURE_NFS_NDM_WORKERS_PORT")
			NDM_WORKERS_PASSWORD = os.Getenv("AZURE_NFS_NDM_WORKERS_PASSWORD")

			SOURCE_VOLUMES_LIST = os.Getenv("AZURE_NFS_SOURCE_VOLUMES")
			DESTINATION_VOLUMES_LIST = os.Getenv("AZURE_NFS_DESTINATION_VOLUMES")

			SOURCE_HOST_IP = os.Getenv("AZURE_NFS_SOURCE_HOST_IP")
			DESTINATION_HOST_IP = os.Getenv("AZURE_NFS_DESTINATION_HOST_IP")

			PROTOCOL_USERNAME = os.Getenv("AZURE_NFS_PROTOCOL_USERNAME")
			PROTOCOL_PASSWORD = os.Getenv("AZURE_NFS_PROTOCOL_PASSWORD")

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
