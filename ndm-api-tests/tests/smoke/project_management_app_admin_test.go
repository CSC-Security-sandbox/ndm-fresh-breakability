package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Project Management - App Admin Tests", func() {
	var (
		headers            map[string]string
		sharedVars         map[string]interface{}
		user               map[string]interface{}
		userId             string
		projectId          string
		userRoleId         string
		autoGenProjectName string
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}

		// Setup headers for API requests FIRST
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		autoGenProjectName = fmt.Sprintf("AutoProject_%d", time.Now().Unix())

		// Initialize shared variables
		sharedVars = map[string]interface{}{
			"account_id":           AccountId,
			"app_admin_id":         AppAdminId,
			"project_admin_id":     ProjectAdminId,
			"project_viewer_id":    ProjectViewerId,
			"source_host_IP":       SOURCE_HOST_IP,
			"destination_host_IP":  DESTINATION_HOST_IP,
			"autogen_project_name": autoGenProjectName,
		}
	})

	Context("Project Management Operations Flow", func() {
		It("should perform project management operations successfully", func() {
			By("Creating a new project")
			// Prepare project creation payload
			createProjectPayload := map[string]interface{}{
				"account_id":          sharedVars["account_id"],
				"project_name":        sharedVars["autogen_project_name"],
				"project_description": "desc1",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}
			payloadBytes, err := json.Marshal(createProjectPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling project creation payload")
			createProjectURL := fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
			resp, err := SendAPIRequest("POST", createProjectURL, payloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create project API request")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for project creation")
			var createProjectResponse map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&createProjectResponse)
			createProjectResponse = createProjectResponse["data"].(map[string]interface{})
			Expect(err).NotTo(HaveOccurred(), "Error decoding create project response")
			projectId = createProjectResponse["id"].(string)
			sharedVars["project_id"] = projectId
			Expect(projectId).NotTo(BeEmpty(), "Project ID should be extracted successfully")
			By("Project created successfully with ID")

			By("Creating a new user")
			// Prepare user creation payload
			createUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojectadmin%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			userPayloadBytes, err := json.Marshal(createUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user creation payload")
			createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			newUserResp, err := SendAPIRequest("POST", createUserURL, userPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user API request")
			defer newUserResp.Body.Close()
			Expect(newUserResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for user creation")
			// Parse response to extract user data
			var createUserResponse map[string]interface{}
			err = json.NewDecoder(newUserResp.Body).Decode(&createUserResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding create user response")
			userData := createUserResponse["data"].(map[string]interface{})
			dataItems := userData["items"].(map[string]interface{})
			userObj, exists := dataItems["user"]
			Expect(exists).To(BeTrue(), "User object should exist in response")
			user = userObj.(map[string]interface{})
			Expect(user["first_name"]).To(Equal("test"), "User first name should match")
			userId = user["id"].(string)
			sharedVars["user"] = user
			sharedVars["userid"] = userId
			By("User created successfully with ID")

			By("Creating user role assignment for app admin")
			// Prepare user role assignment payload
			createRolePayload := map[string]interface{}{
				"project_id": sharedVars["project_id"],
				"account_id": sharedVars["account_id"],
				"user_id":    sharedVars["userid"],
				"role_id":    sharedVars["app_admin_id"],
			}
			userRolePayloadBytes, err := json.Marshal(createRolePayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user role payload")
			createRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			userRoleResp, err := SendAPIRequest("POST", createRoleURL, userRolePayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user role API request")
			defer userRoleResp.Body.Close()
			Expect(userRoleResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for role creation")
			// Parse response to extract role data
			var createRoleResponse map[string]interface{}
			err = json.NewDecoder(userRoleResp.Body).Decode(&createRoleResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding create role response")
			createRoleResponse = createRoleResponse["data"].(map[string]interface{})
			userRoleId = createRoleResponse["id"].(string)
			sharedVars["user_role_id"] = userRoleId
			By("User role created successfully with ID")

			By("Getting project list")
			// Ensure project ID exists from previous test
			getProjectListURL := fmt.Sprintf("%s/api/v1/projects?limit=1000", ADMIN_SERVICE_URL)
			projectListResp, err := SendAPIRequest("GET", getProjectListURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get project list API request")
			defer projectListResp.Body.Close()
			Expect(projectListResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get project list")
			var getProjectListResponse interface{}
			err = json.NewDecoder(projectListResp.Body).Decode(&getProjectListResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get project list response")
			By("Get project list completed successfully")

			By("Getting user permissions list")
			// Make API request to get user permissions
			getPermissionsURL := fmt.Sprintf("%s/api/v1/user-permissions", ADMIN_SERVICE_URL)
			userPermsResp, err := SendAPIRequest("GET", getPermissionsURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get permissions API request")
			defer userPermsResp.Body.Close()
			Expect(userPermsResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get permissions")
			var getPermissionsResponse interface{}
			err = json.NewDecoder(userPermsResp.Body).Decode(&getPermissionsResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get permissions response")
			By("Get permission list completed successfully")

			By("Getting project by project ID")
			// Make API request to get project by ID
			getProjectByIdURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectId)
			projectResp, err := SendAPIRequest("GET", getProjectByIdURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get project by ID API request")
			defer projectResp.Body.Close()
			Expect(projectResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get project by ID")
			var getProjectResponse map[string]interface{}
			err = json.NewDecoder(projectResp.Body).Decode(&getProjectResponse)
			getProjectResponse = getProjectResponse["data"].(map[string]interface{})
			Expect(err).NotTo(HaveOccurred(), "Error decoding get project response")
			// Verify the project ID in response matches what we requested
			responseProjectId := getProjectResponse["id"].(string)
			Expect(responseProjectId).To(Equal(projectId), "Response project ID should match requested ID")
			sharedVars["project_id"] = responseProjectId
			By("Get project by ID completed successfully for project")
		})
	})

	AfterEach(func() {
		By("Cleanup started")
		if userId != "" {
			DeleteUserRoleByID(userRoleId, headers)
			DeleteUserByID(userId, headers)
		}
		By("  Cleanup complete.")
	})
})
