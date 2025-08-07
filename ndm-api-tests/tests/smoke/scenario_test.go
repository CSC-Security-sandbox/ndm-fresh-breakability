package tests

import (
	"fmt"
	"ndm-api-tests/tests/smoke/parser"
	. "ndm-api-tests/utils"
	"strconv"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// sharedVars holds the common variables used in scenario tests.
var sharedVars map[string]interface{}

// OrderedDescribe ensures that the specs run in order.
var _ = Describe("API Scenarios (Sequential from YAML Files)", func() {

	It("executes initialization", func() {
		projectId, attachedWorkersConfig, err := SetupTestEnv(1)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 0), "Expected at least one worker to be attached")
		workerIds := GetWorkerIds()
		workerId := workerIds[0]

		sharedVars = map[string]interface{}{
			"account_id":          AccountId,
			"project_id":          projectId,
			"workerId":            workerId,
			"app_admin_id":        AppAdminId,
			"project_admin_id":    ProjectAdminId,
			"project_viewer_id":   ProjectViewerId,
			"source_host_IP":      SOURCE_HOST_IP,
			"destination_host_IP": DESTINATION_HOST_IP,
		}
		fmt.Println("Initialization complete.")
	})

	It("executes scenario files", func() {
		for _, filePath := range ScenarioFiles {
			By(fmt.Sprintf("Processing scenario file: %s", filePath))
			fp := filePath // capture current value of filePath
			localAuthToken := AuthToken

			// Use the global sharedVars established during initialization.
			Expect(sharedVars).NotTo(BeNil(), "sharedVars should be initialized")

			// Parse the scenario definition from the YAML file.
			sd, err := parser.ParseScenarioDefinition(fp)
			Expect(err).To(BeNil(), fmt.Sprintf("Failed to parse scenario file: %s", fp))

			for _, scData := range sd.Scenarios {
				By(fmt.Sprintf("Executing API call: %s", scData.Name))
				if scData.Delay != "" {
					delay, err := strconv.Atoi(scData.Delay)
					Expect(err).To(BeNil(), fmt.Sprintf("Error converting delay for '%s'", scData.Name))
					Wait(delay)
				}

				switch scData.Name {
				case "new-login":
					var localToken, refreshToken string
					localToken, refreshToken, err = HandleNewLogin(scData, sharedVars)
					Expect(err).To(BeNil(), fmt.Sprintf("Error handling new-login for '%s'", scData.Name))
					localAuthToken = localToken
					RefreshToken = refreshToken
					continue
				case "keycloak-reset-password":
					err = HandleKeycloakResetPassword(scData, sharedVars, KeycloakUser, KeycloakPassword)
					Expect(err).To(BeNil(), fmt.Sprintf("Error handling keycloak-reset-password for '%s'", scData.Name))
					continue
				case "get-file-server-by-id":
					rawMap := scData.Data.(map[interface{}]interface{})
					volumeTypeStr := fmt.Sprintf("%v", rawMap["type"])
					volumeName := fmt.Sprintf("%v", rawMap["volume_name"])

					configId := sharedVars["configId"].(string)
					volumeID, err := GetExportPathID(volumeTypeStr, volumeName, configId, GetHeaders(AuthToken, ContentTypeJSON))
					if err != nil {
						fmt.Printf("Error handling volume for '%s': %v\n", scData.Name, err)
						continue
					}
					switch volumeTypeStr {
					case "source":
						sharedVars["sourcePathId"] = volumeID
					case "destination":
						sharedVars["destinationPathId"] = volumeID
					default:
						fmt.Printf("Unexpected scData.Type: %s\n", volumeTypeStr)
						continue
					}
					fmt.Printf("Successfully handled volume for '%s', found ID: %s\n", scData.Name, volumeID)
					continue

				case LOGOUT_USER:
					_, err = LogoutUser(RefreshToken)
					Expect(err).To(BeNil(), fmt.Sprintf("Error logging out user for '%s'", scData.Name))
					continue
				}

				fullURL := BuildFullURL(scData, sharedVars)
				var reqBody []byte
				lowerMethod := strings.ToLower(scData.Method)
				if lowerMethod == "post" || lowerMethod == "put" || lowerMethod == "patch" {
					reqBody, err = BuildRequestBody(scData, sharedVars)
					Expect(err).To(BeNil(), fmt.Sprintf("Error building request body for '%s'", scData.Name))
				} else {
					LogDebug("No request body for this HTTP method\n")
				}

				headers := GetExtraHeaders(localAuthToken, scData.Headers, sharedVars)
				resp, err := SendAPIRequest(scData.Method, fullURL, reqBody, headers)
				Expect(err).To(BeNil(), fmt.Sprintf("Error sending API request for '%s'", scData.Name))
				sharedVars, err = HandleResponse(resp, scData, scData.Name, sharedVars)
				Expect(err).To(BeNil(), fmt.Sprintf("Error handling response for '%s'", scData.Name))
			}

			// Retrieve Keycloak token and clean up users between scenarios.
			keycloakAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil(), "Error getting Keycloak Access Token")
			CleanupUsers(AuthToken, keycloakAuthToken)
		}
	})

	It("executes cleanup", func() {
		err := CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		fmt.Println("Cleanup complete.")
	})
})
