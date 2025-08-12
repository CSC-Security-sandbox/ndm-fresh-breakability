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

var _ = Describe("Account Management Smoke", func() {

	var headers map[string]string
	var url string
	var bodyBytes []byte
	var body map[string]string
	var resp *http.Response
	var err error
	var bodyData []byte
	var responseData map[string]interface{}

	var accountID string

	Context("Accounts Management", func() {

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("Accounts Management Scenarios", func() {

			By("#############ACCOUNT MANAGEMENT SCENARIO START#############")
			By("Creating a new account with account_name 'account1'")
			url = fmt.Sprintf("%s/api/v1/accounts", ADMIN_SERVICE_URL)
			body = map[string]string{"account_name": "account1"}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest(http.MethodPost, url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			data := responseData["data"].(map[string]interface{})
			items := data["items"].(map[string]interface{})
			Expect(items["account_name"]).To(Equal("account1"))
			accountID = fmt.Sprintf("%v", data["id"])
			Expect(accountID).ToNot(BeEmpty())

			By("Retrieving the list of all accounts")
			url = fmt.Sprintf("%s/api/v1/accounts", ADMIN_SERVICE_URL)
			resp, err = SendAPIRequest(http.MethodGet, url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("Getting account details by account ID")
			url = fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			resp, err = SendAPIRequest(http.MethodGet, url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			By("Updating account name from 'account1' to 'account2'")
			url = fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			body = map[string]string{"account_name": "account2"}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest(http.MethodPatch, url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			bodyData, _ = io.ReadAll(resp.Body)
			json.Unmarshal(bodyData, &responseData)
			Expect(responseData["message"]).To(Equal("Request processed successfully."))

			By("Deleting the created account")
			url := fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
			resp, err := SendAPIRequest(http.MethodDelete, url, nil, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			By("#############ACCOUNT MANAGEMENT SCENARIO END#############")
		})

		AfterEach(func() {
			if accountID != "" {
				deleteUrl := fmt.Sprintf("%s/api/v1/accounts/%s", ADMIN_SERVICE_URL, accountID)
				SendAPIRequest(http.MethodDelete, deleteUrl, nil, headers)
			}
		})
	})
})
