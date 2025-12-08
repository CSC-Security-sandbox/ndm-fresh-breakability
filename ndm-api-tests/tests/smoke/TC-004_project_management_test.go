package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Project Management - User functionality Tests", func() {
	var (
		headers             map[string]string
		user                map[string]interface{}
		userId              string
		projectId           string
		projectId2          string
		adminRoleId         string
		projectAdminRoleId  string
		projectViewerRoleId string
		err                 error
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}

		// Setup headers for API requests FIRST
		headers = GetHeaders(AuthToken, ContentTypeJSON)
	})

	Context("Project Management Operations Flow", func() {
		It("should perform project management operations successfully", func() {
			By("########################## PROJECT-MANAGEMENT-OPERATIONS start ################################")

			By("Creating a new project")
			var projectName string
			projectId, projectName, err = CreateProject(AuthToken, AccountId)
			_ = projectName
			Expect(err).NotTo(HaveOccurred(), "Error creating project")
			Expect(projectId).NotTo(BeEmpty(), "Project ID should be extracted successfully")
			By("Project created successfully with ID")

			By("Creating a new user")
			// Prepare user creation payload
			username := fmt.Sprintf("testprojectadmin%d@email.com", GinkgoRandomSeed())
			firtName := "test"
			lastName := "user"
			user, err = CreateNewUser(username, firtName, lastName, headers)
			Expect(err).NotTo(HaveOccurred(), "Error while creating user")
			Expect(user["first_name"]).To(Equal("test"), "User first name should match")
			userId = user["id"].(string)
			userEmail := user["email"].(string)
			By("User created successfully with ID")

			By("########################## APP-ADMIN-MANAGEMENT-OPERATIONS start ################################")

			By("Creating user role assignment for app admin")
			roleData, err := CreateUserRole(
				projectId,
				AccountId,
				userId,
				AppAdminId,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role")
			adminRoleId = roleData["id"].(string)
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
			By("Get project by ID completed successfully for project")

			By("Creating a new project")
			var projectName2 string
			projectId2, projectName2, err = CreateProject(AuthToken, AccountId)
			_ = projectName2
			Expect(err).NotTo(HaveOccurred(), "Error creating second project")
			Expect(projectId2).NotTo(BeEmpty(), "Second project ID should be extracted successfully")
			By("Second project created successfully with ID")

			By("########################## APP-ADMIN-MANAGEMENT-OPERATIONS end ################################")

			By("Assiging user role for project admin")
			roleDataProjectAdmin, err := CreateUserRole(
				projectId,
				AccountId,
				userId,
				ProjectAdminId,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role for project admin")
			projectAdminRoleId = roleDataProjectAdmin["id"].(string)
			By("User role for project admin created successfully with ID")

			By("Resetting user password via Keycloak")
			keycloakToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak admin token")
			keycloakUserId, err := FetchUserID(userEmail, keycloakToken)
			Expect(err).NotTo(HaveOccurred(), "Error fetching user ID from Keycloak")
			err = ResetUserPassword(keycloakUserId, keycloakToken, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error resetting user password via Keycloak")
			By("Password reset successful for project admin")

			By("########################## PROJECT-ADMIN-MANAGEMENT-OPERATIONS start ################################")

			By("Logging in with project admin user credentials")
			projectAdminToken, _, err := GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in with project admin credentials")
			Expect(projectAdminToken).NotTo(BeEmpty(), "Project admin auth token should not be empty")
			restrictedHeaders := GetHeaders(projectAdminToken, ContentTypeJSON)
			By("Successfully logged in with project admin credentials")

			By("Getting user permissions list for project admin")
			permissionsURL := fmt.Sprintf("%s/api/v1/user-permissions", ADMIN_SERVICE_URL)
			permissionsResp, err := SendAPIRequest("GET", permissionsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user permissions API request")
			defer permissionsResp.Body.Close()
			Expect(permissionsResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get user permissions")
			By("Successfully retrieved user permissions as project admin")

			By("Attempting to create project as project admin (should fail)")
			createProjectPayload := map[string]interface{}{
				"account_id":          AccountId,
				"project_name":        fmt.Sprintf("TestProjectAaaasSSAdminFalingssss%d", GinkgoRandomSeed()),
				"project_description": "desc1",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}
			payloadBytes, err := json.Marshal(createProjectPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling create project payload")
			createProjectURL := fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
			createProjectForbiddenResp, err := SendAPIRequest("POST", createProjectURL, payloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending create project API request")
			defer createProjectForbiddenResp.Body.Close()
			Expect(createProjectForbiddenResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden for project creation")
			By("Project creation correctly forbidden for project admin")

			By("Getting project list as project admin")
			getProjectsURL := fmt.Sprintf("%s/api/v1/projects/accounts/%s/projects?limit=1000", ADMIN_SERVICE_URL, AccountId)
			projectListRespAsAdmin, err := SendAPIRequest("GET", getProjectsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get projects API request")
			defer projectListRespAsAdmin.Body.Close()
			Expect(projectListRespAsAdmin.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get projects")
			By("Successfully retrieved project list")

			By("Getting assigned project details (project_id)")
			restrictedHeaders["projectid"] = projectId
			getProjectDetailsURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectId)
			AssignedProjectDetailsResp, err := SendAPIRequest("GET", getProjectDetailsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get associated project id API request")
			defer AssignedProjectDetailsResp.Body.Close()
			Expect(AssignedProjectDetailsResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for assigned project access")
			By("Successfully accessed assigned project")

			By("Attempting to access non-assigned project (project_id_2) - should fail")
			restrictedHeaders["projectid"] = projectId2
			getProject2URL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectId2)
			NonAssignedProjectDetailsResp, err := SendAPIRequest("GET", getProject2URL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get non-associated project id API request")
			defer NonAssignedProjectDetailsResp.Body.Close()
			Expect(NonAssignedProjectDetailsResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden for non-assigned project")
			By("Access to non-assigned project correctly forbidden")

			By("########################## PROJECT-ADMIN-MANAGEMENT-OPERATIONS end ################################")

			By("Assiging user role for project viewer")
			roleDataProjectViewer, err := CreateUserRole(
				projectId,
				AccountId,
				userId,
				ProjectViewerId,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role for project viewer")
			projectViewerRoleId = roleDataProjectViewer["id"].(string)
			By("User role for project viewer created successfully with ID")

			By("########################## PROJECT-VIEWER-MANAGEMENT-OPERATIONS start ################################")

			By("Logging in with project viewer credentials")
			projectViewerToken, _, err := GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in with project viewer credentials")
			Expect(projectViewerToken).NotTo(BeEmpty(), "Project viewer auth token should not be empty")
			restrictedHeadersViewer := GetHeaders(projectViewerToken, ContentTypeJSON)
			By("Successfully logged in with project viewer credentials")

			By("Getting user permissions list as project viewer")
			permissionsProjectViewerResp, err := SendAPIRequest("GET", permissionsURL, nil, restrictedHeadersViewer)
			Expect(err).NotTo(HaveOccurred(), "Error sending get permissions API request")
			defer permissionsProjectViewerResp.Body.Close()
			Expect(permissionsProjectViewerResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get permissions")
			By("Successfully retrieved user permissions")

			By("Attempting to create project as project viewer (should fail)")
			createProjectForbiddenViewerResp, err := SendAPIRequest("POST", createProjectURL, payloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending create project API request")
			defer createProjectForbiddenViewerResp.Body.Close()
			Expect(createProjectForbiddenViewerResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden for project creation")
			By("Project creation correctly forbidden for project viewer")

			By("Getting project list as project viewer")
			projectsListViewerResp, err := SendAPIRequest("GET", getProjectsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get projects API request")
			defer projectsListViewerResp.Body.Close()
			Expect(projectsListViewerResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for get projects")
			By("Successfully retrieved project list")

			By("Getting assigned project details (project_id) - should fail")
			restrictedHeaders["project_id"] = projectId
			projectDetailsViewerResp, err := SendAPIRequest("GET", getProjectDetailsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get project viewer API request")
			defer projectDetailsViewerResp.Body.Close()
			Expect(projectDetailsViewerResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden for assigned project access")
			By("Access to assigned project correctly forbidden")

			By("Attempting to access non-assigned project (project_id_2) - should fail")
			restrictedHeaders["project_id"] = projectId2
			projectDetailsViewerForbiddenResp, err := SendAPIRequest("GET", getProjectDetailsURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get project 2 API request")
			defer projectDetailsViewerForbiddenResp.Body.Close()
			Expect(projectDetailsViewerForbiddenResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden for non-assigned project")
			By("Access to non-assigned project correctly forbidden")

			By("########################## PROJECT-VIEWER-MANAGEMENT-OPERATIONS end ################################")

			By("########################## PROJECT-MANAGEMENT-OPERATIONS end ################################")
		})
	})

	AfterEach(func() {
		By("Cleanup started")
		if userId != "" {
			DeleteUserRolesByIDs([]string{adminRoleId, projectAdminRoleId, projectViewerRoleId})
			DeleteUserByID(userId)
			DeleteProjectsByIDs([]string{projectId, projectId2})
		}
		By("Cleanup complete.")
	})
})
