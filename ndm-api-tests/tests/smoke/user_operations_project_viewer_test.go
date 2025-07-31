package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("User Operations for Project Viewer", func() {
	var (
		projectId         string
		headers           map[string]string
		user              map[string]interface{}
		userId            string
		localAuthToken    string
		localRefreshToken string
		userEmail         string
		err               error
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}

		// Set up headers for API requests and create a new project
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		projectId, err = CreateProject(AuthToken, AccountId)
		Expect(err).To(BeNil(), "Error creating project")
	})

	Context("Project Viewer Operations", func() {
		It("should complete project viewer operations with proper restrictions", func() {
			// App Admin will create a project viewer user and verify restrictions
			By("Creating a project viewer user")
			// Create user data for project viewer
			createUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojectviewer%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			payloadBytes, err := json.Marshal(createUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user creation payload")
			createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			resp, err := SendAPIRequest("POST", createUserURL, payloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user API request")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for user creation")
			// Parse response to extract user data
			var responseData map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&responseData)
			Expect(err).NotTo(HaveOccurred(), "Error decoding user creation response")
			data := responseData["data"].(map[string]interface{})
			items := data["items"].(map[string]interface{})
			user = items["user"].(map[string]interface{})
			Expect(user["first_name"]).To(Equal("test"), "User first name should match")
			// Parse user data for subsequent tests
			userId = user["id"].(string)
			userEmail = user["email"].(string)
			By("Project viewer user created successfully")

			By("Creating user role assignment for project viewer")
			// Create user role assignment for project viewer
			createUserRolePayload := map[string]interface{}{
				"project_id": projectId,
				"account_id": AccountId,
				"user_id":    userId,
				"role_id":    ProjectViewerId,
			}
			userRolePayloadBytes, err := json.Marshal(createUserRolePayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user role payload")
			createUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			userRoleResp, err := SendAPIRequest("POST", createUserRoleURL, userRolePayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user role API request")
			defer userRoleResp.Body.Close()
			Expect(userRoleResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for user role creation")
			By("User role assignment created successfully")

			By("Resetting password for project viewer user via Keycloak")
			// Get Keycloak admin token first
			keycloakToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak admin token")
			// Fetch user ID from Keycloak and reset password
			keycloakUserId, err := FetchUserID(userEmail, keycloakToken)
			Expect(err).NotTo(HaveOccurred(), "Error fetching user ID from Keycloak")
			err = ResetUserPassword(keycloakUserId, keycloakToken, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error resetting user password via Keycloak")
			By("Password reset successful for project viewer")

			By("Logging in with project viewer credentials")
			// Login with the new project viewer user credentials
			newToken, newRefreshToken, err := GetBearerToken(userEmail, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error logging in with project viewer credentials")
			Expect(newToken).NotTo(BeEmpty(), "New auth token should not be empty")
			localAuthToken = newToken
			localRefreshToken = newRefreshToken
			restrictedHeaders := GetHeaders(localAuthToken, ContentTypeJSON)
			restrictedHeaders["project_id"] = projectId
			By("Project viewer login successful")

			By("Testing restricted operation: Creating new user (should fail)")
			// Create user data for project viewer
			createNewUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojectviewer%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			payloadBytes, err = json.Marshal(createNewUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user creation payload")
			forbiddenUserResp, err := SendAPIRequest("POST", createUserURL, payloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user API request")
			defer forbiddenUserResp.Body.Close()
			Expect(forbiddenUserResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for user creation")
			By("Project viewer correctly restricted from creating new user")

			By("Testing restricted operation: Getting all users (should fail)")
			// Attempt to get all users
			getAllUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
			allUsersResp, err := SendAPIRequest("GET", getAllUsersURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get all users API request")
			defer allUsersResp.Body.Close()
			Expect(allUsersResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for getting all users")
			By("Project viewer correctly restricted from getting all users")

			By("Testing restricted operation: Getting user by ID (should fail)")
			// Attempt to get user by ID
			getUserByIDURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userId)
			userByIDResp, err := SendAPIRequest("GET", getUserByIDURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request")
			defer userByIDResp.Body.Close()
			Expect(userByIDResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for getting user by ID")
			By("Project viewer correctly restricted from getting user by ID")

			By("Testing restricted operation: Changing user status (should fail)")
			// Attempt to change user status
			changeUserStatusPayload := map[string]interface{}{
				"email":  userEmail,
				"enable": false,
			}
			changeStatusPayloadBytes, err := json.Marshal(changeUserStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling change user status payload")
			changeUserStatusURL := fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			changeUserStatusResp, err := SendAPIRequest("POST", changeUserStatusURL, changeStatusPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer changeUserStatusResp.Body.Close()
			Expect(changeUserStatusResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for changing user status")
			By("Project viewer correctly restricted from changing user status")

		})
	})

	AfterEach(func() {
		By("Starting cleanup operations for project viewer test")
		// Logout the project viewer user if we have a refresh token
		if localRefreshToken != "" && localRefreshToken != RefreshToken {
			_, err := LogoutUser(localRefreshToken)
			if err != nil {
				By(fmt.Sprintf("Warning: Could not logout project viewer user: %v", err))
			} else {
				By("Project viewer user logged out successfully")
			}
		}
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		if userId != "" {
			DeleteUserByID(userId, headers)
		}
		By("Cleanup operations completed for project viewer test")
	})
})
