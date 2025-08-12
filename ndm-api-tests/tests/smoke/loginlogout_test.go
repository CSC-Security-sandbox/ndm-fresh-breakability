package tests

import (
	"fmt"

	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Login Logout Smoke", func() {
	var userID interface{}
	var projectID string
	var username string
	var password string
	var userRoleID string
	var err error
	var userRoleID1 string
	var userInfo map[string]interface{}
	var result string
	var authToken string
	var refreshToken string
	var keycloakAuthToken string
	var userKeycloakID string
	var roleData map[string]interface{}

	BeforeEach(func() {
		var err error
		projectID, err = CreateProject(AuthToken, AccountId)
		if err != nil {
			Fail(fmt.Sprintf("Failed to create project using utility: %v", err))
		}
	})

	Context("Login Logout", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("Login Logout Scenarios", func() {

			By("#############APP ADMIN LOGIN LOGOUT SCENARIO START#############")
			By("Create user")
			username = fmt.Sprintf("testproject-%d@email.com", GinkgoRandomSeed())
			userInfo, err = CreateNewUser(username, "test", "user", headers)
			Expect(err).To(BeNil())
			userID = userInfo["id"]
			Expect(userInfo["first_name"]).To(Equal("test"))
			Expect(userID).ToNot(BeNil())

			By("Reset user password")
			password = "Root@123"
			keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err = FetchUserID(username, keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			password = PASSWORD
			Expect(err).To(BeNil())

			By("Login as app admin")
			authToken, refreshToken, err = GetBearerToken(username, password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())
			RefreshToken = refreshToken

			By("Logout as app admin")
			result, err = LogoutUser(RefreshToken)
			Expect(err).To(BeNil())
			Expect(result).To(BeEmpty())
			By("#############APP ADMIN LOGIN LOGOUT SCENARIO END#############")

			By("#############PROJECT ADMIN LOGIN LOGOUT SCENARIO START#############")

			By("Make user project admin")
			roleData, err = CreateUserRole(projectID, AccountId, userID.(string), ProjectAdminId, headers)
			Expect(err).To(BeNil())
			userRoleID1 = fmt.Sprintf("%v", roleData["id"])
			Expect(userRoleID1).ToNot(BeEmpty())

			By("Reset user password")
			password = "Root@123"
			keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err = FetchUserID(username, keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			password = PASSWORD
			Expect(err).To(BeNil())

			By("Login as project admin")
			authToken, refreshToken, err = GetBearerToken(username, password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())
			RefreshToken = refreshToken

			By("Logout as project admin")
			result, err = LogoutUser(RefreshToken)
			Expect(err).To(BeNil())
			Expect(result).To(BeEmpty())
			By("#############PROJECT ADMIN LOGIN LOGOUT SCENARIO END#############")

			By("#############PROJECT VIEWER LOGIN LOGOUT SCENARIO START#############")

			By("Create user role as project viewer")
			roleData, err = CreateUserRole(projectID, AccountId, userID.(string), ProjectViewerId, headers)
			Expect(err).To(BeNil())
			userRoleID = fmt.Sprintf("%v", roleData["id"])
			Expect(userRoleID).ToNot(BeEmpty())

			By("Reset user password")
			password = "Root@123"
			keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err = FetchUserID(username, keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			password = PASSWORD
			Expect(err).To(BeNil())

			By("Login as project viewer")
			authToken, refreshToken, err = GetBearerToken(username, password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())
			RefreshToken = refreshToken

			By("Logout as project viewer")
			result, err = LogoutUser(RefreshToken)
			Expect(err).To(BeNil())
			Expect(result).To(BeEmpty())
			By("#############PROJECT VIEWER LOGIN LOGOUT SCENARIO END#############")
		})

	})
	AfterEach(func() {
		DeleteUserRolesByIDs([]string{userRoleID, userRoleID1})
		DeleteUserByID(userID.(string))
		DeleteProjectsByIDs([]string{projectID})
		DeleteKeycloakUser(username)

	})
})
