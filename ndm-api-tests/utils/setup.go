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
	// err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	// if err != nil {
	// 	LogFatalf("Error updating app admin: %v", err)
	// }

	AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
	if tokenErr != nil {
		LogFatalf("Error getting bearer token: %v", tokenErr)
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
// and performs one‑time setup tasks for the smoke(yaml) tests.
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

	// Update the app admin profile during the first login.
	// err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	// if err != nil {
	// 	LogFatalf("Error updating app admin: %v", err)
	// }

	AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
	if tokenErr != nil {
		LogFatalf("Error getting bearer token: %v", tokenErr)
	}

	AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
	if roleIdsErr != nil {
		LogFatalf("Error getting Role Ids: %v", roleIdsErr)
	}
}

func SetupTestEnv(workerCount int) (string, map[string]SSHConfig, error) {
	// Create the project first.
	projectId, err := CreateProject(AuthToken, AccountId)
	if err != nil {
		return "", nil, fmt.Errorf("failed to create project: %w", err)
	}

	attachedWorkersConfig, err := AttachWorkers(workerCount, AuthToken, AccountId, projectId)
	if err != nil {
		return "", nil, fmt.Errorf("failed to attach workers: %w", err)
	}
	if len(attachedWorkersConfig) == 0 {
		return "", nil, fmt.Errorf("failed to attach workers: worker may have been already attached")
	}
	workerIds := GetWorkerIds()
	for i := 0; i < MaxPollRetries; i++ {
		workerIdWithStatus, err := GetWorkerStatus(projectId, workerIds)
		if err != nil {
			return "", nil, fmt.Errorf("error getting worker status: %w", err)
		}
		onlineWorkers := 0
		for _, workerId := range workerIds {
			if workerIdWithStatus[workerId] == "Online" {
				LogDebug(fmt.Sprintf("Worker %s is Online", workerId))
				onlineWorkers++
			}
		}
		if onlineWorkers == len(workerIds) {
			LogDebug("All workers are Online")
			break
		}
		Wait(DefaultPollInterval)
	}
	LogDebug("Test environment setup complete and all worker are Online")
	return projectId, attachedWorkersConfig, nil
}

func CleanupTestEnv() error {
	err := DetachAllWorkers()
	if err != nil {
		return fmt.Errorf("failed to detach workers: %w", err)
	}

	LogDebug("Test environment deletion complete.")
	return nil
}
