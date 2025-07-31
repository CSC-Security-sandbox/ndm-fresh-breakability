package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("User Operations for Project Admin", func() {
	var (
		projectId         string
		headers           map[string]string
		sharedVars        map[string]interface{}
		user              map[string]interface{}
		userId            string
		userRoleId        string
		localAuthToken    string
		localRefreshToken string
		err               error
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}

		// Setup headers for API requests FIRST
		headers = GetHeaders(AuthToken, ContentTypeJSON)

		// Create a new project for testing
		projectId, err = CreateProject(AuthToken, AccountId)
		Expect(err).NotTo(HaveOccurred(), "Error creating project for user operations test")

		// Initialize shared variables
		sharedVars = map[string]interface{}{
			"account_id":          AccountId,
			"project_id":          projectId,
			"app_admin_id":        AppAdminId,
			"project_admin_id":    ProjectAdminId,
			"project_viewer_id":   ProjectViewerId,
			"source_host_IP":      SOURCE_HOST_IP,
			"destination_host_IP": DESTINATION_HOST_IP,
		}

		// Initialize auth tokens
		localAuthToken = AuthToken
		localRefreshToken = RefreshToken
	})

	Context("Complete User Operations Flow", func() {
		It("should perform complete user operations flow", func() {
			// In this test, we will validate the operations that a project admin can perform
			// We will create a project admin user then login with that user to perform further operations
			// The operations will include both allowed and restricted actions

			By("Creating new user successfully")
			// create user data for project admin
			createUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojectadmin%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			payloadBytes, err := json.Marshal(createUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user creation payload")
			createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			resp, err := SendAPIRequest("POST", createUserURL, payloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user API request")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			// Parse response to extract user data
			var createUserResponse map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&createUserResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding create user response")
			data := createUserResponse["data"].(map[string]interface{})
			items := data["items"].(map[string]interface{})
			user = items["user"].(map[string]interface{})
			Expect(user["first_name"]).To(Equal("test"), "User first name should match")
			// Extract user ID for subsequent tests
			userId = user["id"].(string)
			sharedVars["user"] = user
			sharedVars["userid"] = userId
			By("User created successfully")

			By("Creating user role assignment")
			// create user data for project admin
			createRolePayload := map[string]interface{}{
				"project_id": projectId,
				"account_id": sharedVars["account_id"],
				"user_id":    userId,
				"role_id":    sharedVars["project_admin_id"],
			}
			rolePayloadBytes, err := json.Marshal(createRolePayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling role assignment payload")
			createRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			roleResp, err := SendAPIRequest("POST", createRoleURL, rolePayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user role API request")
			defer roleResp.Body.Close()
			Expect(roleResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			// Parse response to extract role data
			var createRoleResponse map[string]interface{}
			err = json.NewDecoder(roleResp.Body).Decode(&createRoleResponse)
			createRoleResponse = createRoleResponse["data"].(map[string]interface{})
			Expect(err).NotTo(HaveOccurred(), "Error decoding create role response")
			userRoleId = createRoleResponse["id"].(string)
			sharedVars["user_role_id"] = userRoleId
			By("User role created successfully")

			By("Resetting user password via Keycloak")
			// retrieve user email from the created user data
			userEmail, exists := user["email"].(string)
			Expect(exists).To(BeTrue(), "User email should exist")
			// Get Keycloak admin token first
			keycloakToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak admin token")
			// Use the utility functions directly for Keycloak password reset
			userID, err := FetchUserID(userEmail, keycloakToken)
			Expect(err).NotTo(HaveOccurred(), "Error fetching user ID from Keycloak")
			err = ResetUserPassword(userID, keycloakToken, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error resetting user password via Keycloak")
			By("User password reset successfully via Keycloak")

			By("Logging in with project admin user credentials")
			// Now login with the new user credentials
			newToken, newRefreshToken, err := GetBearerToken(userEmail, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error logging in with updated credentials")
			Expect(newToken).NotTo(BeEmpty(), "New auth token should not be empty")
			localAuthToken = newToken
			localRefreshToken = newRefreshToken
			By("Successfully logged in with updated credentials")

			By("Attempting to create user with project admin restricted to project scope")
			// Switch to project-scoped headers with new user token
			restrictedHeaders := GetHeaders(localAuthToken, ContentTypeJSON)
			restrictedHeaders["projectid"] = projectId
			// Create user data for restricted project admin
			restrictedUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojectadmin%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			restrictedPayloadBytes, err := json.Marshal(restrictedUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling restricted user creation payload")
			createdUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			restrictedResp, err := SendAPIRequest("POST", createdUserURL, restrictedPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending restricted user creation API request")
			defer restrictedResp.Body.Close()
			Expect(restrictedResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for restricted user creation")
			By("Restricted user creation correctly returned as expected")

			By("Getting all users")
			// Make API request to get all users
			getAllUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
			usersResp, err := SendAPIRequest("GET", getAllUsersURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get all users API request")
			defer usersResp.Body.Close()
			Expect(usersResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting all users")
			// Parse response to ensure users are returned
			var getAllUsersResponse interface{}
			err = json.NewDecoder(usersResp.Body).Decode(&getAllUsersResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get all users response")
			By("Successfully retrieved all users")

			By("Getting user by ID")
			// Ensure user ID exists from previous test
			Expect(userId).NotTo(BeEmpty(), "User ID should exist from previous test")
			getUserByIdURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userId)
			userIdResp, err := SendAPIRequest("GET", getUserByIdURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting user by ID")
			By("Successfully retrieved user by ID")

			By("Changing user status")
			// Ensure user email exists from previous test
			changeStatusPayload := map[string]interface{}{
				"email":  userEmail,
				"enable": false,
			}
			userStatusPayloadBytes, err := json.Marshal(changeStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user status change payload")
			changeStatusURL := fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			userStatusResp, err := SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusResp.Body.Close()
			Expect(userStatusResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for changing user status")
			By("Restricted user status change correctly returned as expected")
		})
	})

	AfterEach(func() {
		// Cleanup logic
		By("Performing cleanup operations")
		// Logout the new user if we have a refresh token
		if localRefreshToken != "" && localRefreshToken != RefreshToken {
			_, err := LogoutUser(localRefreshToken)
			if err != nil {
				By(fmt.Sprintf("Warning: Could not logout user: %v", err))
			}
		}
		if userId != "" {
			DeleteUserRoleByID(userRoleId, headers)
			DeleteUserByID(userId, headers)
		}
		By("  Completed cleanup operations for user tests")
	})
})
