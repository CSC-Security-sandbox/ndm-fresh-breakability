package tests

import (
	"fmt"
	"io/ioutil"
	"log"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ndm-api-tests/internal/scenario"
	"ndm-api-tests/utils"

	"testing"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	"gopkg.in/yaml.v2"
)

// Global variables and settings.
var (
	isDebug = true

	scenariosDir      = filepath.Join("..", "resources", "scenarios")
	scenarioFileNames []string
	scenarioFiles     []string

	authToken string
	// sharedVars holds default values and any values parsed from prior API responses.
	sharedVars map[string]interface{}
)

// Logging helper functions.
func logDebug(msg string) {
	if isDebug {
		log.Print("[DEBUG] " + msg)
	}
}

func init() {
	var tokenErr error
	authToken, tokenErr = utils.GetBearerToken("", "")
	if tokenErr != nil {
		log.Fatalf("Error getting bearer token: %v", tokenErr)
	}
	scenarioConfigPath := filepath.Join("..", "scenario_config.yml")

	// Load the scenario config file.
	configBytes, err := ioutil.ReadFile(scenarioConfigPath)
	if err != nil {
		log.Fatalf("Error reading scenario configuration file: %v", err)
	}
	var scConfig scenario.ScenarioConfig
	if err = yaml.Unmarshal(configBytes, &scConfig); err != nil {
		log.Fatalf("Error parsing scenario configuration file: %v", err)
	}
	if len(scConfig.Files) == 0 {
		log.Fatal("Scenario configuration file does not list any files")
	}
	scenarioFileNames = scConfig.Files
	log.Printf("Using scenario files: %+v\n", scenarioFileNames)

	// Build full file paths.
	scenarioFiles = make([]string, len(scenarioFileNames))
	for i, name := range scenarioFileNames {
		scenarioFiles[i] = filepath.Join(scenariosDir, name)
	}
}

// delayBetweenCalls pauses execution for the given number of seconds.
func delayBetweenCalls(delay int) {
	time.Sleep(time.Duration(delay) * time.Second)
}

// TestAPIScenarios is the main entry point for Ginkgo tests.
func TestAPIScenarios(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "API Scenarios Suite")
}

// Main Describe block: iterate over each YAML file and execute its scenarios sequentially.
var _ = Describe("API Scenarios (Sequential from YAML Files)", func() {
	var projectId, accountId, workerId string
	It("Should Attach a worker successfully", func() {
		var err error
		accountId, projectId, workerId, err = utils.AttachWorker(authToken)
		Expect(err).To(BeNil(), "Failed to Attach a worker")
	})
	for _, filePath := range scenarioFiles {
		fp := filePath
		It(fmt.Sprintf("should execute scenario from file: %s", filepath.Base(fp)), func() {
			// Initialize sharedVars with default values.
			sharedVars = map[string]interface{}{
				"account_id": accountId,
				"project_id": projectId,
				"workerId":   workerId,
			}
			sd, err := scenario.ParseScenarioDefinition(fp)
			Expect(err).To(BeNil(), "Failed to parse scenario file: %s", fp)
			// Iterate over scenarios in order.
			for _, scData := range sd.Scenarios {
				By(fmt.Sprintf("Executing API call: %s", scData.Name))
				if scData.Delay != "" {
					delay, err := strconv.Atoi(scData.Delay)
					Expect(err).To(BeNil(), "Error converting delay for '%s'", scData.Name)
					delayBetweenCalls(delay)
				}
				if scData.Name == "new-login" {
					converted, ok := utils.ConvertToStringMap(scData.Data)
					if !ok {
						fmt.Errorf("failed to convert scenario Data to map[string]interface{}")
					}
					username, usernameOk := converted["username"].(string)
					password, passwordOk := converted["password"].(string)
					if !usernameOk || !passwordOk {
						fmt.Errorf("username or password is not a string")
					}
					authToken, err = utils.GetBearerToken(username, password)
					Expect(err).To(BeNil(), "Error Getting Bearer Token '%s'", scData.Name)

					continue
				}
				fullURL := utils.BuildFullURL(scData, sharedVars)
				logDebug(fmt.Sprintf("Request URL: %s\nHTTP Method: %s\n", fullURL, strings.ToUpper(scData.Method)))
				var reqBody []byte
				if strings.ToLower(scData.Method) == "post" ||
					strings.ToLower(scData.Method) == "put" ||
					strings.ToLower(scData.Method) == "patch" {
					// Build the JSON payload from the YAML "data" field.
					reqBody, err = utils.BuildRequestBody(scData, sharedVars)
					Expect(err).To(BeNil(), "Error building request body for '%s'", scData.Name)
					logDebug(fmt.Sprintf("Constructed Request Body: %s\n", string(reqBody)))
				} else {
					logDebug("No request body for this HTTP method\n")
				}
				resp, err := utils.SendAPIRequest(scData.Method, fullURL, reqBody, authToken)
				Expect(err).To(BeNil(), "Error sending API request for '%s'", scData.Name)
				sharedVars, err = utils.HandleResponse(resp, scData, scData.Name, sharedVars)
				Expect(err).To(BeNil(), "Error handling response for '%s'", scData.Name)
			}
		})
	}
})
