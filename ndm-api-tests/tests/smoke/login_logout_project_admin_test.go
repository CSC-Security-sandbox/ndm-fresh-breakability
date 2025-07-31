package tests

import (
	"net/http"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Login Logout - Project Admin", func() {
	var (
		userId          string
		userEmail       string
		userRoleId      string
		localAuthToken  string
		refreshToken    string
		headers         map[string]string
	)

	BeforeEach(func() {
		headers = GetHeaders(AuthToken, ContentTypeJSON)
	})

	Context("Project Admin Login/Logout Flow", func() {
		It("should create user, assign project admin role, and test login/logout", func() {
			By("Creating a new user")
			userData := map[string]interface{}{
				"username":  "testprojectadmin-" + GenerateUUID() + "@email.com",
				"firstName": "test",
				"lastName":  "user",
			}

			userResp, resp, err := CreateUser(userData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			Expect(userResp.Data.Items.User.FirstName).To(Equal("test"), "Expected first name to be 'test'")
			userId = userResp.Data.Items.User.ID
			userEmail = userResp.Data.Items.User.Email
			Expect(userId).NotTo(BeEmpty(), "User ID should not be empty")

			By("Creating user role assignment")
			userRoleData := map[string]interface{}{
				"project_id": ProjectID,
				"account_id": AccountId,
				"user_id":    userId,
				"role_id":    ProjectAdminId,
			}

			userRoleResp, resp, err := CreateUserRole(userRoleData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			userRoleId = userRoleResp.ID

			By("Resetting user password in Keycloak")
			err = ResetKeycloakPassword(userEmail, "Root@123", KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error resetting password")

			By("Logging in as the new user")
			localAuthToken, refreshToken, err = GetBearerToken(userEmail, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error logging in as new user")
			Expect(localAuthToken).NotTo(BeEmpty(), "Auth token should not be empty")
			Expect(refreshToken).NotTo(BeEmpty(), "Refresh token should not be empty")

			By("Logging out the user")
			resp, err = LogoutUserViaToken(refreshToken)
			Expect(err).NotTo(HaveOccurred(), "Error logging out user")
			Expect(resp.StatusCode).To(Equal(http.StatusNoContent), "Expected HTTP 204 No Content")
			defer resp.Body.Close()
		})
	})

	AfterEach(func() {
		// Cleanup: Delete created resources using admin token
		adminHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		if userRoleId != "" {
			DeleteUserRole(userRoleId, adminHeaders)
		}
		if userId != "" {
			DeleteUser(userId, adminHeaders)
		}
	})
})
