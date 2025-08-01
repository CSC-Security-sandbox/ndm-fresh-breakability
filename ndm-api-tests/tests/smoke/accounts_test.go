package tests

import (
	"encoding/json"
	"fmt"
	"io"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Account Management", func() {

	var headers map[string]string
	var url string
	var bodyBytes []byte
	var body map[string]string
	var resp *http.Response
	var err error
	var bodyData []byte
	var responseData map[string]interface{}

	var accountID string

	Context("Accounts test", func() {

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		AfterEach(func() {
			if accountID != "" {
				deleteUrl := fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
				SendAPIRequest("DELETE", deleteUrl, nil, headers)
			}
		})
		It("account-test", func() {
			By("create-account")
			url = fmt.Sprintf("%s/api/v1/accounts", ADMIN_SERVICE_URL)
			body = map[string]string{"account_name": "account1"}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			data := responseData["data"].(map[string]interface{})
			items := data["items"].(map[string]interface{})
			Expect(items["account_name"]).To(Equal("account1"))
			accountID = fmt.Sprintf("%v", data["id"])
			Expect(accountID).ToNot(BeEmpty())

			By("get-list-of-accounts")
			url = fmt.Sprintf("%s/api/v1/accounts", ADMIN_SERVICE_URL)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("get-account-by-account_id")
			url = fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			resp, err = SendAPIRequest("GET", url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("update-account")
			url = fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			body = map[string]string{"account_name": "account2"}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("PATCH", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			Expect(responseData["message"]).To(Equal("Request processed successfully."))

			By("delete-account")
			url := fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			resp, err := SendAPIRequest("DELETE", url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
		})
	})
})
