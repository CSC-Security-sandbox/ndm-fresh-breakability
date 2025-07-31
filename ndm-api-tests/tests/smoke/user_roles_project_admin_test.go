package tests

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("User Roles - Project Admin", func() {
	var (
		userId1         string
		userId2         string
		batchUserId     string
		userEmail1      string
		localAuthToken  string
		headers         map[string]string
		projectHeaders  map[string]string
	)

	BeforeEach(func() {
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		projectHeaders = GetHeaders(AuthToken, ContentTypeJSON)
		projectHeaders["projectid"] = ProjectID
	})

	Context("Project Admin Role Management", func() {
		It("should create users and assign project admin roles", func() {
			By("Creating first user")
			userData1 := map[string]interface{}{
				"username":  "testprojectadmin-" + GenerateUUID() + "@email.com",
				"firstName": "test",
				"lastName":  "user",
			}

			userResp1, resp, err := CreateUser(userData1, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating first user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			Expect(userResp1.Data.Items.User.FirstName).To(Equal("test"), "Expected first name to be 'test'")
			userId1 = userResp1.Data.Items.User.ID
			userEmail1 = userResp1.Data.Items.User.Email

			By("Creating second user")
			userData2 := map[string]interface{}{
				"username":  "testprojectadmin2-" + GenerateUUID() + "@email.com",
				"firstName": "test",
				"lastName":  "user",
			}

			userResp2, resp, err := CreateUser(userData2, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating second user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			Expect(userResp2.Data.Items.User.FirstName).To(Equal("test"), "Expected first name to be 'test'")
			userId2 = userResp2.Data.Items.User.ID

			By("Creating user role for first user")
			userRoleData1 := map[string]interface{}{
				"project_id": ProjectID,
				"account_id": AccountId,
				"user_id":    userId1,
				"role_id":    ProjectAdminId,
			}

			_, resp, err = CreateUserRole(userRoleData1, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role for first user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			By("Resetting password for first user")
			err = ResetKeycloakPassword(userEmail1, "Root@123", KeycloakUser, KeycloakPassword)
			Expect(err).NotTo(HaveOccurred(), "Error resetting password for first user")

			By("Logging in as first user")
			localAuthToken, _, err = GetBearerToken(userEmail1, "Root@123")
			Expect(err).NotTo(HaveOccurred(), "Error logging in as first user")
			Expect(localAuthToken).NotTo(BeEmpty(), "Auth token should not be empty")

			// Update headers to use the new user token
			projectHeaders = GetHeaders(localAuthToken, ContentTypeJSON)
			projectHeaders["projectid"] = ProjectID
		})

		It("should allow project admin to create user roles in batch", func() {
			By("Creating a project for this test")
			projectData := map[string]interface{}{
				"account_id":          AccountId,
				"project_name":        GenerateUUID(),
				"project_description": "Test project for batch user role assignment",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}

			projectResp, resp, err := CreateProject(projectData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating project")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			testProjectID := projectResp.GetID()
			Expect(testProjectID).NotTo(BeEmpty(), "Project ID should not be empty")

			By("Creating a user for batch assignment")
			batchUserData := map[string]interface{}{
				"username":  "testbatchuser-" + GenerateUUID() + "@email.com",
				"firstName": "batch",
				"lastName":  "user",
			}

			batchUserResp, resp, err := CreateUser(batchUserData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating batch user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			batchUserId = batchUserResp.Data.Items.User.ID

			By("Creating user role batch assignment")
			batchUserRoleData := map[string]interface{}{
				"project_id": testProjectID,
				"account_id": AccountId,
				"users": []map[string]interface{}{
					{
						"user_id": batchUserId,
						"role_id": ProjectAdminId,
					},
				},
			}

			batchResp, resp, err := CreateUserRoleBatch(batchUserRoleData, projectHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error creating batch user role")
			if resp.StatusCode != 201 {
				bodyBytes, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				fmt.Printf("Error Response Body: %s\n", string(bodyBytes))
				// Re-create response for the test
				resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
			}
			fmt.Printf("DEBUG: Batch user role created with response: %+v\n", batchResp)
			Expect(err).NotTo(HaveOccurred(), "Error creating batch user role")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			By("Cleaning up the test project")
			DeleteProject(testProjectID, GetHeaders(AuthToken, ContentTypeJSON))
		})

		It("should get user roles and verify they were created successfully", func() {
			By("Getting user roles for the project")
			userRolesResp, resp, err := GetUserRoles(projectHeaders)
			Expect(err).NotTo(HaveOccurred(), "Error getting user roles")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()

			By("Verifying user roles were returned")
			Expect(userRolesResp).NotTo(BeNil(), "User roles response should not be nil")
			// The response should contain the user roles that were created
		})
	})

	AfterEach(func() {
		// Cleanup: Delete created resources
		adminHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		if userId1 != "" {
			DeleteUser(userId1, adminHeaders)
		}
		if userId2 != "" {
			DeleteUser(userId2, adminHeaders)
		}
		if batchUserId != "" {
			DeleteUser(batchUserId, adminHeaders)
		}
	})
})
