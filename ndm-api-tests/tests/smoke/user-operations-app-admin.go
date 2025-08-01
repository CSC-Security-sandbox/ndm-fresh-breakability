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

var _ = Describe("User Operations", func() {
	var user map[string]interface{}
	var userid interface{}
	var bodyBytes []byte
	var body map[string]interface{}
	var url string
	var resp *http.Response
	var err error
	var responseData map[string]interface{}
	var username string
	var bodyData []byte
	var data map[string]interface{}
	var items map[string]interface{}
	var userInfo map[string]interface{}

	Context("user-operation-app-admin", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		AfterEach(func() {
			if userid != nil {
				deleteUrl := fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userid)
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
		It("user-operation-app-admin", func() {
			By("create-user")
			url = fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
			username = fmt.Sprintf("testadmin%d@email.com", GinkgoRandomSeed())

			body = map[string]interface{}{"username": username, "firstName": "test", "lastName": "user"}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			data = responseData["data"].(map[string]interface{})
			items = data["items"].(map[string]interface{})
			userInfo = items["user"].(map[string]interface{})
			user = userInfo
			userid = userInfo["id"]
			Expect(userInfo["first_name"]).To(Equal("test"))

			By("get-all-users")
			url = fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("get-user-by-id")
			url = fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userid)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("change-user-status")
			url = fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			body = map[string]interface{}{
				"email":  user["email"],
				"enable": false,
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("get-user-with-changed-status")
			url = fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userid)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			data = responseData["data"].(map[string]interface{})
			items = data["items"].(map[string]interface{})
			Expect(items["user_status"]).To(Equal("inactive"))
			userid = data["id"]

			By("change-user-status back to active")
			url = fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			body = map[string]interface{}{
				"email":  user["email"],
				"enable": true,
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("get-user-with-changed-status back to active")
			url = fmt.Sprintf("%s/api/v1/users/%v", ADMIN_SERVICE_URL, userid)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			bodyData, _ = io.ReadAll(resp.Body)
			var responseData map[string]interface{}
			json.Unmarshal(bodyData, &responseData)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			data = responseData["data"].(map[string]interface{})
			items = data["items"].(map[string]interface{})
			Expect(items["user_status"]).To(Equal("active"))
			userid = data["id"]
		})
	})
})
