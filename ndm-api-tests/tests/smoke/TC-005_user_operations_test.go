package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("User Operations - User functionality test", func() {
	var (
		projectId           string
		headers             map[string]string
		user                map[string]interface{}
		userId              string
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

		// Create a new project for testing
		projectId, err = CreateProject(AuthToken, AccountId)
		Expect(err).NotTo(HaveOccurred(), "Error creating project for user operations test")
	})

	Context("Complete User Operations Flow", func() {
		It("should perform complete user operations flow", func() {
			// In this test, we will validate the operations that all users can perform
			By("########################## USER-OPERATIONS start ################################")
			By("########################## APP-ADMIN-USER-OPERATIONS start ################################")

			By("Creating new user successfully")
			// create user data for project admin
			username := fmt.Sprintf("useroperationsteeeesssstprojectadmin%d@email.com", GinkgoRandomSeed())
			firstName := "test"
			lastName := "user"
			user, err = CreateNewUser(username, firstName, lastName, headers)
			Expect(err).NotTo(HaveOccurred(), "Error while creating user")
			Expect(user["first_name"]).To(Equal("test"), "User first name should match")
			userId = user["id"].(string)
			userEmail := user["email"].(string)
			By("User created successfully")

			By("Getting all users")
			// Make API request to get all users
			getAllUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
			usersResp, err := SendAPIRequest("GET", getAllUsersURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get all users API request")
			defer usersResp.Body.Close()
			Expect(usersResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting all users")
			By("Successfully retrieved all users")

			By("Getting user by ID")
			// Ensure user ID exists from previous test
			Expect(userId).NotTo(BeEmpty(), "User ID should exist from previous test")
			getUserByIdURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userId)
			userIdResp, err := SendAPIRequest("GET", getUserByIdURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting user by ID")
			By("Successfully retrieved user by ID")

			By("Changing user status")
			changeStatusPayload := map[string]interface{}{
				"email":  userEmail,
				"enable": false,
			}
			userStatusPayloadBytes, err := json.Marshal(changeStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user status change payload")
			changeStatusURL := fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			userStatusResp, err := SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusResp.Body.Close()
			Expect(userStatusResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for changing user status")
			By("User status change correctly updated")

			By("Getting user by ID after status change")
			userIdResp, err = SendAPIRequest("GET", getUserByIdURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request after status change")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting user by ID after status change")
			var responseData map[string]interface{}
			err = json.NewDecoder(userIdResp.Body).Decode(&responseData)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get user by ID response after status change")
			userData := responseData["data"].(map[string]interface{})
			userItems := userData["items"].(map[string]interface{})
			Expect(userItems["user_status"]).To(Equal("inactive"), "User status should be 'inactive' after change")
			By("Successfully retrieved user by ID after status change")

			By("Chanding user status back to active")
			changeStatusPayload = map[string]interface{}{
				"email":  userEmail,
				"enable": true,
			}
			userStatusPayloadBytes, err = json.Marshal(changeStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user status change payload")
			userStatusResp, err = SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusResp.Body.Close()
			Expect(userStatusResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for changing user status")
			By("User status change correctly updated")

			By("Getting user by ID after status change")
			userIdResp, err = SendAPIRequest("GET", getUserByIdURL, nil, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request after status change")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting user by ID after status change")
			err = json.NewDecoder(userIdResp.Body).Decode(&responseData)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get user by ID response after status change")
			userData = responseData["data"].(map[string]interface{})
			userItems = userData["items"].(map[string]interface{})
			Expect(userItems["user_status"]).To(Equal("active"), "User status should be 'active' after change")
			By("Successfully retrieved user by ID after status change")

			By("########################## APP-ADMIN-USER-OPERATIONS end ################################")

			By("Creating user role assignment for project admin")
			roleData, err := CreateUserRole(
				projectId,
				AccountId,
				userId,
				ProjectAdminId,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role")
			projectAdminRoleId = roleData["id"].(string)
			By("User role created successfully")

			By("Resetting user password via Keycloak")
			keycloakToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak admin token")
			keycloakUserID, err := FetchUserID(userEmail, keycloakToken)
			Expect(err).NotTo(HaveOccurred(), "Error fetching user ID from Keycloak")
			err = ResetUserPassword(keycloakUserID, keycloakToken, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error resetting user password via Keycloak")
			By("User password reset successfully via Keycloak")

			By("########################## PROJECT-ADMIN-USER-OPERATIONS start ################################")

			By("Logging in with project admin user credentials")
			newToken, _, err := GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in with updated credentials")
			Expect(newToken).NotTo(BeEmpty(), "New auth token should not be empty")
			restrictedHeaders := GetHeaders(newToken, ContentTypeJSON)
			restrictedHeaders["projectid"] = projectId
			By("Successfully logged in with updated credentials")

			By("Attempting to create user with project admin restricted to project scope")
			restrictedUserPayload := map[string]interface{}{
				"username":  fmt.Sprintf("testprojeccccttttadmin%d@email.com", GinkgoRandomSeed()),
				"firstName": "test",
				"lastName":  "user",
			}
			restrictedPayloadBytes, err := json.Marshal(restrictedUserPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling restricted user creation payload")
			createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			restrictedResp, err := SendAPIRequest("POST", createUserURL, restrictedPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending restricted user creation API request")
			defer restrictedResp.Body.Close()
			Expect(restrictedResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for restricted user creation")
			By("Restricted user creation correctly returned as expected")

			By("Getting all users")
			usersResp, err = SendAPIRequest("GET", getAllUsersURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get all users API request")
			defer usersResp.Body.Close()
			Expect(usersResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting all users")
			var getAllUsersResponse interface{}
			err = json.NewDecoder(usersResp.Body).Decode(&getAllUsersResponse)
			Expect(err).NotTo(HaveOccurred(), "Error decoding get all users response")
			By("Successfully retrieved all users")

			By("Getting user by ID")
			userIdResp, err = SendAPIRequest("GET", getUserByIdURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for getting user by ID")
			By("Successfully retrieved user by ID")

			By("Changing user status")
			changeStatusPayload = map[string]interface{}{
				"email":  userEmail,
				"enable": false,
			}
			userStatusPayloadBytes, err = json.Marshal(changeStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user status change payload")
			userStatusResp, err = SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusResp.Body.Close()
			Expect(userStatusResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for changing user status")
			By("Restricted user status change correctly returned as expected")

			By("########################## PROJECT-ADMIN-USER-OPERATIONS end ################################")
			By("Creating user role assignment for project viewer")
			roleData, err = CreateUserRole(
				projectId,
				AccountId,
				userId,
				ProjectViewerId,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role")
			projectViewerRoleId = roleData["id"].(string)
			By("User role assignment created successfully")

			By("########################## PROJECT-VIEWER-USER-OPERATIONS start ################################")

			By("Logging in with project viewer credentials")
			// Login with the new project viewer user credentials
			newToken, _, err = GetBearerToken(userEmail, PASSWORD)
			Expect(err).NotTo(HaveOccurred(), "Error logging in with project viewer credentials")
			Expect(newToken).NotTo(BeEmpty(), "New auth token should not be empty")
			restrictedHeaders = GetHeaders(newToken, ContentTypeJSON)
			restrictedHeaders["project_id"] = projectId
			By("Project viewer login successful")

			By("Testing restricted operation: Creating new user (should fail)")
			restrictedResp, err = SendAPIRequest("POST", createUserURL, restrictedPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending create user API request")
			defer restrictedResp.Body.Close()
			Expect(restrictedResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for user creation")
			By("Project viewer correctly restricted from creating new user")

			By("Testing restricted operation: Getting all users (should fail)")
			// Attempt to get all users
			usersResp, err = SendAPIRequest("GET", getAllUsersURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get all users API request")
			defer usersResp.Body.Close()
			Expect(usersResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for getting all users")
			By("Project viewer correctly restricted from getting all users")

			By("Testing restricted operation: Getting user by ID (should fail)")
			// Attempt to get user by ID
			userIdResp, err = SendAPIRequest("GET", getUserByIdURL, nil, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending get user by ID API request")
			defer userIdResp.Body.Close()
			Expect(userIdResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for getting user by ID")
			By("Project viewer correctly restricted from getting user by ID")

			By("Testing restricted operation: Changing user status (should fail)")
			userStatusResp, err = SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, restrictedHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusResp.Body.Close()
			Expect(userStatusResp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 FORBIDDEN for changing user status")
			By("Project viewer correctly restricted from changing user status")

			By("########################## PROJECT-VIEWER-USER-OPERATIONS end ################################")
			By("########################## USER-OPERATIONS end ################################")
		})
	})

	AfterEach(func() {
		// Cleanup logic
		By("Performing cleanup operations")
		if userId != "" {
			DeleteUserRolesByIDs([]string{projectAdminRoleId, projectViewerRoleId})
			DeleteUserByID(userId)
			DeleteProjectsByIDs([]string{projectId})
		}
		By("Completed cleanup operations for user tests")
	})
})
