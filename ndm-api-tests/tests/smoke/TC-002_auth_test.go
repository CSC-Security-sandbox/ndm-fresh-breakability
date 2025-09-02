package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Authentication API Tests", func() {
	var (
		projectId string
		headers   map[string]string
		user      map[string]interface{}
		userId    string
		err       error
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		projectId, err = CreateProject(AuthToken, AccountId)
		Expect(err).To(BeNil(), "Error creating project")
	})

	Context("Authentication operations", func() {
		It("should complete auth operations", func() {
			By("########################## AUTH-OPERATIONS start ################################")

			By("Creating a new user")
			// Prepare user creation payload
			username := fmt.Sprintf("testprojectTester%d0@email.com", GinkgoRandomSeed())
			firstName := "Tester"
			lastName := "Test"
			user, err = CreateNewUser(username, firstName, lastName, headers)
			Expect(err).NotTo(HaveOccurred(), "Error in creating new user")
			Expect(user["first_name"]).To(Equal("Tester"), "User first name should match")
			userId = user["id"].(string)
			By("User created successfully with ID")

			By("Resetting user password")
			userEmail, exists := user["email"]
			Expect(exists).To(BeTrue(), "User email should exist")
			// Prepare password reset payload
			resetPasswordPayload := map[string]interface{}{
				"email": userEmail,
			}
			userPwdPayloadBytes, err := json.Marshal(resetPasswordPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling password reset payload")
			resetPasswordURL := fmt.Sprintf("%s/api/v1/reset-password", ADMIN_SERVICE_URL)
			resetPwdResp, err := SendAPIRequest("POST", resetPasswordURL, userPwdPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending reset password API request")
			defer resetPwdResp.Body.Close()
			Expect(resetPwdResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			// Parse response to verify email
			var resetPwdResponseData map[string]interface{}
			err = json.NewDecoder(resetPwdResp.Body).Decode(&resetPwdResponseData)
			Expect(err).NotTo(HaveOccurred(), "Error decoding response")
			resetPwdData := resetPwdResponseData["data"].(map[string]interface{})
			resetPwdItems := resetPwdData["items"].(map[string]interface{})
			Expect(resetPwdItems["email"]).To(Equal(user["email"]), "Email should match expected value")
			By("Password reset completed successfully")

			By("Changing user status")
			// Prepare user status change payload
			changeStatusPayload := map[string]interface{}{
				"email":  userEmail,
				"enable": false,
			}
			userStatusPayloadBytes, err := json.Marshal(changeStatusPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling user status change payload")
			changeStatusURL := fmt.Sprintf("%s/api/v1/user-status", ADMIN_SERVICE_URL)
			userStatusresp, err := SendAPIRequest("POST", changeStatusURL, userStatusPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending change user status API request")
			defer userStatusresp.Body.Close()
			Expect(userStatusresp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By("User status changed successfully")

			By("Performing worker registration")
			// Prepare worker registration payload
			registrationPayload := map[string]interface{}{
				"projectId": projectId,
			}
			workerRegPayloadBytes, err := json.Marshal(registrationPayload)
			Expect(err).NotTo(HaveOccurred(), "Error marshalling worker registration payload")
			registrationURL := fmt.Sprintf("%s/api/v1/worker-registration", ADMIN_SERVICE_URL)
			workerRegResp, err := SendAPIRequest("POST", registrationURL, workerRegPayloadBytes, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending worker registration API request")
			defer workerRegResp.Body.Close()
			Expect(workerRegResp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			By("Worker registration completed successfully")

			By("########################## AUTH-OPERATIONS end ################################")
		})
	})

	AfterEach(func() {
		By("Cleanup started")
		if userId != "" {
			DeleteUserByID(userId)
			DeleteProjectsByIDs([]string{projectId})
		}
		By("  Cleanup complete.")
	})
})
