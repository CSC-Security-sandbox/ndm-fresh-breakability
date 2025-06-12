package utils

import (
	"fmt"
	"io/ioutil"
	"ndm-api-tests/internal/scenario"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v2"
)

var (
	// Path to the scenarios directory (relative to the project root).
	wd, _                                                                                                = os.Getwd()
	projectRoot                                                                                          = filepath.Dir(wd)
	ScenariosDir                                                                                         = filepath.Join(projectRoot, "resources", "scenarios")
	ScenarioFileNames                                                                                    []string
	ScenarioFiles                                                                                        []string
	AccountId                                                                                            = DEFAULT_ACCOUNT_ID
	AuthToken, RefreshToken, KeycloakUser, KeycloakPassword, AppAdminId, ProjectAdminId, ProjectViewerId string
)

// InitTestEnv sets up variables, loads configuration,
// and performs one‑time setup tasks for the tests.
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
	err := UpdateAppAdmin(KeycloakUser, KeycloakPassword)
	if err != nil {
		LogFatalf("Error updating app admin: %v", err)
	}

	AuthToken, RefreshToken, tokenErr = GetBearerToken("", "")
	if tokenErr != nil {
		LogFatalf("Error getting bearer token: %v", tokenErr)
	}

	AppAdminId, ProjectAdminId, ProjectViewerId, roleIdsErr = GetRoleId(AuthToken)
	if roleIdsErr != nil {
		LogFatalf("Error getting Role Ids: %v", roleIdsErr)
	}

	scenarioConfigPath := filepath.Join(projectRoot, "scenario_config.yml")
	configBytes, err := ioutil.ReadFile(scenarioConfigPath)
	if err != nil {
		LogFatalf("Error reading configuration file: %v", err)
	}

	var scConfig scenario.ScenarioConfig
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

func SetupTestEnv(workerCount int) (string, []string, error) {
	// Create the project first.
	projectId, err := createProject(AuthToken, AccountId)
	if err != nil {
		return "", nil, fmt.Errorf("failed to create project: %w", err)
	}
	LogDebug(fmt.Sprintf("Project created with ID: %s", projectId))

	workerIds, err := AttachWorkers(workerCount, AuthToken, AccountId, projectId)
	if err != nil {
		return "", nil, fmt.Errorf("failed to attach workers: %w", err)
	}

	if len(workerIds) == 0 {
		return "", nil, fmt.Errorf("failed to attach workers: worker may have been already attached")
	}

	LogDebug(fmt.Sprintf("Attached worker IDs: %v", workerIds))
	LogDebug("Test environment setup complete.")
	return projectId, workerIds, nil
}

func CleanupTestEnv() error {

	output, err := DetachWorkers()
	if err != nil {
		return fmt.Errorf("failed to detach workers: %w", err)
	}

	LogDebug(fmt.Sprintf("Detach workers output: %s", output))
	LogDebug("Test environment deletion complete.")
	return nil
}
