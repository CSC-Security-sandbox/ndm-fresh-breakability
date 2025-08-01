package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	. "ndm-api-tests/utils"
)

var _ = Describe("User Roles", func() {
	var userID interface{}
	var userID2 interface{}
	var projectID string
	var userRoleID string
	var body map[string]interface{}
	var url string
	var bodyBytes []byte
	var responseData map[string]interface{}
	var resp *http.Response
	var err error
	var bodyData []byte
	var username string
	var username2 string
	var password string
	var authToken string
	var refreshToken string
	var data map[string]interface{}
	var userInfo map[string]interface{}
	var items map[string]interface{}

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

		if userID2 != nil {
			deleteUrl := fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userID2)
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

		if username2 != "" {
			keycloakAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
			if err == nil {
				userKeycloakID, err := FetchUserID(username2, keycloakAuthToken)
				if err == nil {
					deleteURL := fmt.Sprintf("https://%s/%s/%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL, userKeycloakID)
					headers := GetHeaders(keycloakAuthToken, ContentTypeJSON)
					SendAPIRequest("DELETE", deleteURL, nil, headers)
				}
			}
		}
	})

	Context("user-roles-project-viewer", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("user-roles-project-viewer", func() {
			By("create-user")
			url = fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			username = fmt.Sprintf("testprojectviewer-%d@email.com", GinkgoRandomSeed())
			body = map[string]interface{}{
				"username":  username,
				"firstName": "test",
				"lastName":  "user",
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)

			data = responseData["data"].(map[string]interface{})
			items = data["items"].(map[string]interface{})
			userInfo = items["user"].(map[string]interface{})

			userID = userInfo["id"]
			Expect(userInfo["first_name"]).To(Equal("test"))
			Expect(userID).ToNot(BeNil())

			By("create-user-2")
			username2 = fmt.Sprintf("testprojectviewer2-%d@email.com", GinkgoRandomSeed())
			body = map[string]interface{}{
				"username":  username2,
				"firstName": "test",
				"lastName":  "user",
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Or(Equal(http.StatusOK), Equal(http.StatusCreated)))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)

			switch resp.StatusCode {
			case http.StatusOK:
				data = responseData["data"].(map[string]interface{})
				items = data["items"].(map[string]interface{})
				userInfo2 := items["user"].(map[string]interface{})
				userID2 = userInfo2["id"]
				Expect(userInfo2["first_name"]).To(Equal("test"))
			case http.StatusCreated:
				userInfo2 := responseData["user"].(map[string]interface{})
				userID2 = userInfo2["id"]
				Expect(userInfo2["first_name"]).To(Equal("test"))
			}
			Expect(userID2).ToNot(BeNil())

			By("create-new-user-role")
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
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
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
			authToken, refreshToken, err = GetBearerToken(username, password)
			Expect(err).To(BeNil())
			Expect(authToken).ToNot(BeEmpty())
			Expect(refreshToken).ToNot(BeEmpty())

			By("create-new-user-role-batch")
			url = fmt.Sprintf("%s/api/v1/user-roles/batch", ADMIN_SERVICE_URL)
			projectHeaders := GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["project_id"] = projectID
			body = map[string]interface{}{
				"project_id": projectID,
				"account_id": AccountId,
				"users": []map[string]interface{}{
					{
						"user_id": userID2,
						"role_id": ProjectAdminId,
					},
				},
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden))

			By("get-user-role")
			url = fmt.Sprintf("%s/api/v1/user-roles?project_id=%s", ADMIN_SERVICE_URL, projectID)
			projectHeaders = GetHeaders(authToken, ContentTypeJSON)
			projectHeaders["project_id"] = projectID
			resp, err = SendAPIRequest("GET", url, nil, projectHeaders)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden))
		})
	})
})
