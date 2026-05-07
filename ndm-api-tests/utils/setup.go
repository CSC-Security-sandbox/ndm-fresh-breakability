package utils

import (
	"fmt"
	"ndm-api-tests/tests/smoke/parser"

	"os"
	"path/filepath"

	"gopkg.in/yaml.v2"
)

var (
	// Path to the scenarios directory (relative to the project root).
	wd, _                                                                                                = os.Getwd()
	projectRoot                                                                                          = filepath.Dir(wd)
	ScenariosDir                                                                                         = filepath.Join(projectRoot, "smoke", "scenarios")
	ScenarioFileNames                                                                                    []string
	ScenarioFiles                                                                                        []string
	AccountId                                                                                            = DEFAULT_ACCOUNT_ID
	AuthToken, RefreshToken, KeycloakUser, KeycloakPassword, AppAdminId, ProjectAdminId, ProjectViewerId string

	TokenExpiresAt int64 // Unix timestamp when current token expires

	// Global project and workers - created once in InitTestEnv and reused across all tests
	GlobalProjectId             string
	GlobalProjectName           string
	GlobalAttachedWorkersConfig map[string]SSHConfig
)

// InitTestEnvForSMoke sets up variables, loads configuration,
// and performs one‑time setup tasks for the smoke(yaml) tests.
func InitTestEnvForSMoke() {
	var tokenErr, keycloakErr, roleIdsErr error

	creds, keycloakErr := GetKeyCloakAdminCredentials()
	if keycloakErr != nil {
		LogFatalf("Error getting Keycloak secrets: %v", keycloakErr)
	} else {
		KeycloakUser = creds.AdminUser
		KeycloakPassword = creds.AdminPassword
		CLIENT_SECRET = creds.ClientSecret
	}

	// Update the app admin profile during the first login.
	err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	// Wait for Keycloak to propagate password changes
	LogDebug("Waiting 3 seconds for Keycloak password update to propagate...")
	Wait(3)

	// Retry logic for initial token fetch
	for attempt := 1; attempt <= 5; attempt++ {
		LogDebug(fmt.Sprintf("[InitTestEnvForSMoke] Token fetch attempt %d/5", attempt))
		AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
		if tokenErr == nil {
			LogDebug(fmt.Sprintf("[InitTestEnvForSMoke] Successfully obtained token on attempt %d", attempt))
			break
		}
		LogError(fmt.Sprintf("[InitTestEnvForSMoke] Token fetch attempt %d/5 failed", attempt), tokenErr)
		if attempt < 5 {
			LogDebug(fmt.Sprintf("[InitTestEnvForSMoke] Retrying in 3 seconds..."))
			Wait(3)
		}
	}
	if tokenErr != nil {
		LogFatalf("Error getting bearer token after 5 attempts: %v", tokenErr)
	}

	AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
	if roleIdsErr != nil {
		LogFatalf("Error getting Role Ids: %v", roleIdsErr)
	}

	LogDebug(fmt.Sprintf("Project root: %s", projectRoot))
	scenarioConfigPath := filepath.Join(projectRoot, "smoke/scenarios/scenario_config.yml")
	LogDebug(fmt.Sprintf("Reading scenario configuration from: %s", scenarioConfigPath))
	configBytes, err := os.ReadFile(scenarioConfigPath)
	if err != nil {
		LogFatalf("Error reading configuration file: %v", err)
	}

	var scConfig parser.ScenarioConfig
	if err = yaml.Unmarshal(configBytes, &scConfig); err != nil {
		LogFatalf("Error parsing scenario configuration file: %v", err)
	}

	if len(scConfig.Files) == 0 {
		LogFatalf("Scenario configuration file does not list any files")
	}

	ScenarioFileNames = scConfig.Files
	LogDebug(fmt.Sprintf("Using scenario files: %+v", ScenarioFileNames))

	ScenarioFiles = make([]string, len(ScenarioFileNames))
	for i, name := range ScenarioFileNames {
		ScenarioFiles[i] = filepath.Join(ScenariosDir, name)
	}
}

// InitTestEnv sets up variables, loads configuration,
// and performs one‑time setup tasks for the smoke and e2e tests.
// This creates global workers that are shared across tests.
func InitTestEnv() {
	var tokenErr, keycloakErr, roleIdsErr error

	creds, keycloakErr := GetKeyCloakAdminCredentials()
	if keycloakErr != nil {
		LogFatalf("Error getting Keycloak secrets: %v", keycloakErr)
	} else {
		KeycloakUser = creds.AdminUser
		KeycloakPassword = creds.AdminPassword
		CLIENT_SECRET = creds.ClientSecret
	}

	if JWT_REFRESH_INTERVAL_MINUTES > 0 {
		LogDebug("Configuring Keycloak for JWT refresh testing...")
		err := UpdateKeycloakTokenLifespan(KEYCLOAK_TOKEN_LIFESPAN_SECONDS) // 20 minutes for E2E JWT refresh testing
		if err != nil {
			LogFatalf("Failed to configure Keycloak token lifespan: %v", err)
		}
		LogDebug(fmt.Sprintf("Keycloak configured with %d-second token lifespan", KEYCLOAK_TOKEN_LIFESPAN_SECONDS))
	}

	// Update the app admin profile during the first login.
	err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	// Wait for Keycloak to propagate password changes
	LogDebug("Waiting 3 seconds for Keycloak password update to propagate...")
	Wait(3)

	// Retry logic for initial token fetch (Keycloak might need time)
	for attempt := 1; attempt <= 5; attempt++ {
		LogDebug(fmt.Sprintf("[InitTestEnv] Token fetch attempt %d/5", attempt))
		AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
		if tokenErr == nil {
			LogDebug(fmt.Sprintf("[InitTestEnv] Successfully obtained token on attempt %d", attempt))
			break
		}
		LogError(fmt.Sprintf("[InitTestEnv] Token fetch attempt %d/5 failed", attempt), tokenErr)
		if attempt < 5 {
			LogDebug(fmt.Sprintf("[InitTestEnv] Retrying in 3 seconds..."))
			Wait(3)
		}
	}
	if tokenErr != nil {
		LogFatalf("Error getting bearer token after 5 attempts: %v", tokenErr)
	}

	AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
	if roleIdsErr != nil {
		LogFatalf("Error getting Role Ids: %v", roleIdsErr)
	}

	// Create project and attach 2 workers once for all tests
	LogDebug("Creating project and attaching 2 workers for all test cases")
	GlobalProjectId, GlobalProjectName, GlobalAttachedWorkersConfig, err = SetupTestEnv(2)
	if err != nil {
		LogFatalf("Error setting up test environment with workers: %v", err)
	}
	LogDebug(fmt.Sprintf("Global project created: %s (name: %s) with %d workers attached", GlobalProjectId, GlobalProjectName, len(GlobalAttachedWorkersConfig)))
}

// InitTestEnvWithoutWorkers sets up auth tokens and configuration WITHOUT creating global workers.
// Use this for regression tests where each test creates its own isolated project and workers.
func InitTestEnvWithoutWorkers() {
	var tokenErr, keycloakErr, roleIdsErr error

	creds, keycloakErr := GetKeyCloakAdminCredentials()
	if keycloakErr != nil {
		LogFatalf("Error getting Keycloak secrets: %v", keycloakErr)
	} else {
		KeycloakUser = creds.AdminUser
		KeycloakPassword = creds.AdminPassword
		CLIENT_SECRET = creds.ClientSecret
	}

	// Update the app admin profile during the first login.
	err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	// Wait for Keycloak to propagate password changes
	LogDebug("Waiting 3 seconds for Keycloak password update to propagate...")
	Wait(3)

	// Retry logic for initial token fetch
	for attempt := 1; attempt <= 5; attempt++ {
		LogDebug(fmt.Sprintf("[InitTestEnvWithoutWorkers] Token fetch attempt %d/5", attempt))
		AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
		if tokenErr == nil {
			LogDebug(fmt.Sprintf("[InitTestEnvWithoutWorkers] Successfully obtained token on attempt %d", attempt))
			break
		}
		LogError(fmt.Sprintf("[InitTestEnvWithoutWorkers] Token fetch attempt %d/5 failed", attempt), tokenErr)
		if attempt < 5 {
			LogDebug(fmt.Sprintf("[InitTestEnvWithoutWorkers] Retrying in 3 seconds..."))
			Wait(3)
		}
	}
	if tokenErr != nil {
		LogFatalf("Error getting bearer token after 5 attempts: %v", tokenErr)
	}

	AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
	if roleIdsErr != nil {
		LogFatalf("Error getting Role Ids: %v", roleIdsErr)
	}

	LogDebug("Test environment initialized (auth tokens and configs only, no global workers)")
}

func ensureSMBWorkersDomainJoinedIfNeeded() error {
	if PROTOCOL_TYPE != "SMB" {
		return nil
	}

	domainUser := PROTOCOL_USERNAME
	domainPassword := PROTOCOL_PASSWORD
	if domainUser == "" || domainPassword == "" {
		LogDebug("Skipping Windows worker domain join because SMB domain credentials are not configured")
		return nil
	}

	domainName := PROTOCOL_DOMAIN_NAME
	if domainName == "" {
		return fmt.Errorf("SMB domain name is not configured. Set AZURE_SMB_DOMAIN_NAME")
	}

	LogDebug(fmt.Sprintf("Domain join parameters: domain=%s, user=%s", domainName, domainUser))

	if err := EnsureWindowsWorkerDomainJoined(domainName, domainUser, domainPassword); err != nil {
		return fmt.Errorf("error joining Windows workers to domain: %w", err)
	}

	LogDebug("Windows workers are domain-joined and ready for AD operations")
	return nil
}

func SetupTestEnv(workerCount int) (string, string, map[string]SSHConfig, error) {
	// Create the project first.
	projectId, projectName, err := CreateProject(AuthToken, AccountId)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to create project: %w", err)
	}

	attachedWorkersConfig, err := AttachWorkers(workerCount, AuthToken, AccountId, projectId)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to attach workers: %w", err)
	}
	if len(attachedWorkersConfig) == 0 {
		return "", "", nil, fmt.Errorf("failed to attach workers: worker may have been already attached")
	}
	workerIds := GetWorkerIds()
	for i := 0; i < MaxWorkerStatusRetries; i++ {
		workerIdWithStatus, err := GetWorkerStatus(projectId, workerIds)
		if err != nil {
			return "", "", nil, fmt.Errorf("error getting worker status: %w", err)
		}
		onlineWorkers := 0
		for _, workerId := range workerIds {
			if workerIdWithStatus[workerId] == "Online" {
				LogDebug(fmt.Sprintf("Worker %s is Online", workerId))
				onlineWorkers++
			} else {
				LogDebug(fmt.Sprintf("Worker %s status: %s (waiting for Online)", workerId, workerIdWithStatus[workerId]))
			}
		}
		if onlineWorkers == len(workerIds) {
			LogDebug("All workers are Online")
			if err := ensureSMBWorkersDomainJoinedIfNeeded(); err != nil {
				return "", "", nil, err
			}
			LogDebug("Test environment setup complete and all workers are Online")
			return projectId, projectName, attachedWorkersConfig, nil
		}
		LogDebug(fmt.Sprintf("Workers online: %d/%d (attempt %d/%d)", onlineWorkers, len(workerIds), i+1, MaxWorkerStatusRetries))
		Wait(DefaultPollInterval)
	}

	// If we exit the loop, workers didn't come online in time
	return "", "", nil, fmt.Errorf("timeout waiting for workers to come online after %d seconds", MaxWorkerStatusRetries*DefaultPollInterval)
}

// GetGlobalTestEnv returns the globally created project and workers
// This should be used in test cases instead of SetupTestEnv to reuse the same workers
func GetGlobalTestEnv() (string, string, map[string]SSHConfig, error) {
	if GlobalProjectId == "" || GlobalAttachedWorkersConfig == nil {
		return "", "", nil, fmt.Errorf("global test environment not initialized. Make sure InitTestEnv() is called in BeforeSuite")
	}
	return GlobalProjectId, GlobalProjectName, GlobalAttachedWorkersConfig, nil
}

// SharedSuiteData holds data to be shared across parallel Ginkgo processes
type SharedSuiteData struct {
	AuthToken                   string
	RefreshToken                string
	TokenExpiresAt              int64
	KeycloakUser                string
	KeycloakPassword            string
	ClientSecret                string
	AppAdminId                  string
	ProjectAdminId              string
	ProjectViewerId             string
	GlobalProjectId             string
	GlobalProjectName           string
	GlobalAttachedWorkersConfig map[string]SSHConfig
}

// SetGlobalTestVariables sets global variables from shared suite data
// Used by parallel Ginkgo processes that didn't run InitTestEnv()
func SetGlobalTestVariables(data SharedSuiteData) {
	AuthToken = data.AuthToken
	RefreshToken = data.RefreshToken
	TokenExpiresAt = data.TokenExpiresAt
	KeycloakUser = data.KeycloakUser
	KeycloakPassword = data.KeycloakPassword
	CLIENT_SECRET = data.ClientSecret
	AppAdminId = data.AppAdminId
	ProjectAdminId = data.ProjectAdminId
	ProjectViewerId = data.ProjectViewerId
	GlobalProjectId = data.GlobalProjectId
	GlobalProjectName = data.GlobalProjectName
	GlobalAttachedWorkersConfig = data.GlobalAttachedWorkersConfig
	AttachedWorkersConfig = data.GlobalAttachedWorkersConfig
}

func CleanupTestEnv() error {
	if JWT_REFRESH_INTERVAL_MINUTES > 0 {
		LogDebug("Restoring Keycloak default token lifespan...")
		err := UpdateKeycloakTokenLifespan(86400) // Restore to 24 hours
		if err != nil {
			LogError("Failed to restore Keycloak token lifespan", err)
		}
	}

	err := DetachAllWorkers()
	if err != nil {
		return fmt.Errorf("failed to detach workers: %w", err)
	}

	LogDebug("Test environment deletion complete.")
	return nil
}
