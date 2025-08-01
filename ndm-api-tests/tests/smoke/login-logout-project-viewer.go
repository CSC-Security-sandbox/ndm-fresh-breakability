package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Login Logout", func() {
	var userID interface{}
	var projectID string
	var body map[string]interface{}
	var url string
	var responseData map[string]interface{}
	var username string
	var password string
	var userRoleID string

	BeforeEach(func() {
		var err error
		projectID, err = CreateProject(AuthToken, AccountId)
		if err != nil {
			Fail(fmt.Sprintf("Failed to create project using utility: %v", err))
		}
	})

	AfterEach(func() {
		if userRoleID != "" {
			deleteUrl := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleID)
			headers := GetHeaders(AuthToken, ContentTypeJSON)
			SendAPIRequest("DELETE", deleteUrl, nil, headers)
		}

		if userID != nil {
			deleteUrl := fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userID)
			headers := GetHeaders(AuthToken, ContentTypeJSON)
			SendAPIRequest("DELETE", deleteUrl, nil, headers)
		}

		if projectID != "" {
			deleteUrl := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID)
			headers := GetHeaders(AuthToken, ContentTypeJSON)
			SendAPIRequest("DELETE", deleteUrl, nil, headers)
		}

		if username != "" {
			keycloakAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			if err == nil {
				userKeycloakID, err := FetchUserID(username, keycloakAuthToken)
				if err == nil {
					deleteURL := fmt.Sprintf("https://%s/%s/%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL, userKeycloakID)
					headers := GetHeaders(keycloakAuthToken, ContentTypeJSON)
					SendAPIRequest("DELETE", deleteURL, nil, headers)
				}
			}
		}
	})

	Context("login-logout-project-viewer", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("login-logout-project-viewer", func() {

			By("create-user")
			url = fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			username = fmt.Sprintf("testprojectviewer-%d@email.com", GinkgoRandomSeed())
			body = map[string]interface{}{
				"username":  username,
				"firstName": "test",
				"lastName":  "user",
			}
			bodyBytes, _ := json.Marshal(body)
			resp, err := SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Or(Equal(http.StatusOK), Equal(http.StatusCreated)))
			bodyData, _ := io.ReadAll(resp.Body)
			err = json.Unmarshal(bodyData, &responseData)
			Expect(err).To(BeNil())
			switch resp.StatusCode {
			case http.StatusOK:
				data := responseData["data"].(map[string]interface{})
				items := data["items"].(map[string]interface{})
				userInfo := items["user"].(map[string]interface{})
				userID = userInfo["id"]
				Expect(userInfo["first_name"]).To(Equal("test"))
				Expect(userID).ToNot(BeNil())
			case http.StatusCreated:
				Expect(responseData["user"]).ToNot(BeNil())
				userInfo := responseData["user"].(map[string]interface{})
				Expect(userInfo["first_name"]).To(Equal("test"))
				userID = userInfo["id"]
				Expect(userID).ToNot(BeNil())
			}

			By("create-user-role")
			url = fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
			body = map[string]interface{}{
				"project_id": projectID,
				"account_id": AccountId,
				"user_id":    userID,
				"role_id":    ProjectViewerId,
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Or(Equal(http.StatusOK), Equal(http.StatusCreated)))
			bodyData, _ = io.ReadAll(resp.Body)
			var responseData map[string]interface{}
			json.Unmarshal(bodyData, &responseData)
			if data, ok := responseData["data"].(map[string]interface{}); ok {
				if data["id"] != nil {
					userRoleID = fmt.Sprintf("%v", data["id"])
				}
			}
			Expect(userRoleID).ToNot(BeEmpty())

			By("keycloak-reset-password")
			password = "Root@123"
			keycloakAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			Expect(err).To(BeNil())
			userKeycloakID, err := FetchUserID(username, keycloakAuthToken)
			Expect(err).To(BeNil())
			err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
			Expect(err).To(BeNil())

			By("new-login")
			authToken, refreshToken, err := GetBearerToken(username, password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())
			RefreshToken = refreshToken

			By("logout-user")
			result, err := LogoutUser(RefreshToken)
			Expect(err).To(BeNil())
			Expect(result).To(BeEmpty())
		})

	})
})
