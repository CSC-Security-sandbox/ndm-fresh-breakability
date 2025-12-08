package tests

import (
	"encoding/json"
	"fmt"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	. "ndm-api-tests/utils"
)

var _ = Describe("User Roles Smoke", func() {
	var userIDs []interface{}
	var usernames []string
	var userRoleIDs []string
	var projectID []string
	var body map[string]interface{}
	var url string
	var bodyBytes []byte
	var responseData map[string]interface{}
	var resp *http.Response
	var err error
	var password string
	var authToken string
	var refreshToken string
	var keycloakAuthToken string
	var userKeycloakID string
	var projectHeaders map[string]string

	BeforeEach(func() {
		projectID = make([]string, 3)
		userIDs = make([]interface{}, 5)
		usernames = make([]string, 5)
		userRoleIDs = make([]string, 5)
		for i := range 3 {
			var projectName string
			projectID[i], projectName, _ = CreateProject(AuthToken, AccountId)
			_ = projectName
		}
	})
	Context("User Roles", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("User Roles Scenarios", func() {

			By("#############APP ADMIN USER ROLES SCENARIO START#############")

			By("Create User (for App Admin operations)")
			usernames[0] = fmt.Sprintf("appadmin-%d@email.com", GinkgoRandomSeed())
			responseData, err = CreateNewUser(usernames[0], "app", "admin", headers)
			Expect(err).To(BeNil())
			userIDs[0] = responseData["id"]
			Expect(responseData["first_name"]).To(Equal("app"))
			Expect(userIDs[0]).ToNot(BeNil())

			By("Assign Project Admin Role to User 1")
			roleData1, err := CreateUserRole(projectID[0], AccountId, userIDs[0].(string), ProjectAdminId, headers)
			Expect(err).To(BeNil())
			userRoleIDs[0] = fmt.Sprintf("%v", roleData1["id"])
			Expect(userRoleIDs[0]).ToNot(BeEmpty())

			By("Get User Roles")
			url = fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			resp, err = SendAPIRequest(http.MethodGet, url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("Update User Role (change from Project Admin to Project Viewer)")
			url = fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleIDs[0])
			body = map[string]interface{}{
				"project_id": projectID[0],
				"account_id": AccountId,
				"user_id":    userIDs[0],
				"role_id":    ProjectViewerId,
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest(http.MethodPatch, url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("#############APP ADMIN USER ROLES SCENARIO END#############")

			By("#############PROJECT ADMIN USER ROLES SCENARIO START#############")

			By("Create User 1 (for Project Admin operations)")
			usernames[1] = fmt.Sprintf("projectadmin1-%d@email.com", GinkgoRandomSeed())
			responseData, err = CreateNewUser(usernames[1], "project", "admin", headers)
			Expect(err).To(BeNil())
			userIDs[1] = responseData["id"]
			Expect(responseData["first_name"]).To(Equal("project"))
			Expect(userIDs[1]).ToNot(BeNil())

			By("Create User 2 (for Project Viewer operations)")
			usernames[2] = fmt.Sprintf("projectadmin2-%d@email.com", GinkgoRandomSeed())
			responseData, err = CreateNewUser(usernames[2], "project", "viewer", headers)
			Expect(err).To(BeNil())
			userIDs[2] = responseData["id"]
			Expect(responseData["first_name"]).To(Equal("project"))
			Expect(userIDs[2]).ToNot(BeNil())

			By("Assign Project Admin Role to User 1")
			roleData2, err := CreateUserRole(projectID[1], AccountId, userIDs[1].(string), ProjectAdminId, headers)
			Expect(err).To(BeNil())
			userRoleIDs[1] = fmt.Sprintf("%v", roleData2["id"])
			Expect(userRoleIDs[1]).ToNot(BeEmpty())

			By("Keycloak Reset Password for User 1")
			password = "Root@123"
			keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err = FetchUserID(usernames[1], keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			password = PASSWORD
			Expect(err).To(BeNil())

			By("Login as Project Admin User 1")
			authToken, refreshToken, err = GetBearerToken(usernames[1], password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())

			By("Create User Role Batch as Project Admin")
			url = fmt.Sprintf("%s/api/v1/user-roles/batch", ADMIN_SERVICE_URL)
			projectHeaders = GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["projectid"] = projectID[1]
			body = map[string]interface{}{
				"project_id": projectID[1],
				"account_id": AccountId,
				"users": []map[string]interface{}{
					{
						"user_id": userIDs[2],
						"role_id": ProjectAdminId,
					},
				},
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest(http.MethodPost, url, bodyBytes, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("Get User Roles as Project Admin ")
			url = fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			projectHeaders = GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["projectid"] = projectID[1]
			resp, err = SendAPIRequest("GET", url, nil, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("#############PROJECT ADMIN USER ROLES SCENARIO END#############")
			By("#############PROJECT VIEWER USER ROLES SCENARIO START#############")

			By("Create User 1 (for role assignments)")
			usernames[3] = fmt.Sprintf("projectviewer1-%d@email.com", GinkgoRandomSeed())
			responseData, err = CreateNewUser(usernames[3], "target", "user1", headers)
			Expect(err).To(BeNil())
			userIDs[3] = responseData["id"]
			Expect(responseData["first_name"]).To(Equal("target"))
			Expect(userIDs[3]).ToNot(BeNil())

			By("Create User 2 (for role assignments)")
			usernames[4] = fmt.Sprintf("projectviewer2-%d@email.com", GinkgoRandomSeed())
			responseData, err = CreateNewUser(usernames[4], "target", "user2", headers)
			Expect(err).To(BeNil())
			userIDs[4] = responseData["id"]
			Expect(responseData["first_name"]).To(Equal("target"))
			Expect(userIDs[4]).ToNot(BeNil())

			By("Assign Project Viewer Role to User 1")
			roleData3, err := CreateUserRole(projectID[2], AccountId, userIDs[2].(string), ProjectViewerId, headers)
			Expect(err).To(BeNil())
			userRoleIDs[2] = fmt.Sprintf("%v", roleData3["id"])
			Expect(userRoleIDs[2]).ToNot(BeEmpty())

			By("Keycloak Reset Password for User 1")
			password = "Root@123"
			keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err = FetchUserID(usernames[2], keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			password = PASSWORD
			Expect(err).To(BeNil())

			By("Login as Project Viewer User 1")
			authToken, refreshToken, err = GetBearerToken(usernames[2], password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())

			By("Create User Role Batch as Project Viewer ")
			url = fmt.Sprintf("%s/api/v1/user-roles/batch", ADMIN_SERVICE_URL)
			projectHeaders = GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["project_id"] = projectID[2]
			body = map[string]interface{}{
				"project_id": projectID[2],
				"account_id": AccountId,
				"users": []map[string]interface{}{
					{
						"user_id": userIDs[4],
						"role_id": ProjectAdminId,
					},
				},
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest(http.MethodPost, url, bodyBytes, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden))

			By("Get User Roles as Project Viewer")
			url = fmt.Sprintf("%s/api/v1/user-roles?project_id=%s", ADMIN_SERVICE_URL, projectID[2])
			projectHeaders = GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["project_id"] = projectID[2]
			resp, err = SendAPIRequest(http.MethodGet, url, nil, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden))

			By("#############PROJECT VIEWER USER ROLES SCENARIO END#############")
		})

		AfterEach(func() {
			var roleIDs []string
			for _, roleID := range userRoleIDs {
				if roleID != "" {
					roleIDs = append(roleIDs, roleID)
				}
			}
			if len(roleIDs) > 0 {
				DeleteUserRolesByIDs(roleIDs)
			}
			for _, userID := range userIDs {
				if userID != nil {
					DeleteUserByID(userID.(string))
				}
			}
			for _, pid := range projectID {
				if pid != "" {
					DeleteProjectsByIDs([]string{pid})
				}
			}
			for _, username := range usernames {
				if username != "" {
					DeleteKeycloakUser(username)
				}
			}
		})
	})
})
