package tests

import (
	"fmt"
	"net/http"
	"time"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Project Management - Project Viewer", func() {
	var (
		project_id_1    string
		project_id_2    string
		userid          string
		userEmail       string
		username        string
		user_role_id    string
		localAuthToken  string
		headers         map[string]string
	)

	BeforeEach(func() {
		headers = GetHeaders(AuthToken, ContentTypeJSON)
	})

	Context("Project Viewer Role Tests", func() {
		It("should create user and assign project viewer role", func() {
			By("Creating a new user")
			timestamp := fmt.Sprintf("%d", time.Now().Unix())
			userData := map[string]interface{}{
				"username":  "testprojectviewer" + timestamp + "@email.com",
				"firstName": "test",
				"lastName":  "user",
			}

			userResp, resp, err := CreateUser(userData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating user")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK - API returns 200 not 201")
			defer resp.Body.Close()

			Expect(userResp.Data.Items.User.FirstName).To(Equal("test"), "Expected first name to be 'test'")
			userid = userResp.Data.Items.User.ID
			userEmail = userResp.Data.Items.User.Email
			username = userResp.Data.Items.User.Username
			Expect(userid).NotTo(BeEmpty(), "User ID should not be empty")

			By("Creating first project")
			projectData1 := map[string]interface{}{
				"account_id":          AccountId,
				"project_name":        GenerateUUID(),
				"project_description": "desc1",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}

			fmt.Printf("=== DEBUG: CREATING FIRST PROJECT ===\n")
			fmt.Printf("Project data: %+v\n", projectData1)
			project1Resp, resp, err := CreateProject(projectData1, headers)
			fmt.Printf("CreateProject Response Status: %d\n", resp.StatusCode)
			fmt.Printf("Project creation error: %v\n", err)
			fmt.Printf("Project response: %+v\n", project1Resp)
			Expect(err).NotTo(HaveOccurred(), "Error creating first project")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 201")
			defer resp.Body.Close()
			project_id_1 = project1Resp.GetID()
			fmt.Printf("First Project ID: %s\n", project_id_1)

			By("Creating second project")
			projectData2 := map[string]interface{}{
				"account_id":          AccountId,
				"project_name":        GenerateUUID(),
				"project_description": "desc1",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}

			fmt.Printf("=== DEBUG: CREATING SECOND PROJECT ===\n")
			fmt.Printf("Project data: %+v\n", projectData2)
			project2Resp, resp, err := CreateProject(projectData2, headers)
			fmt.Printf("CreateProject Response Status: %d\n", resp.StatusCode)
			fmt.Printf("Project creation error: %v\n", err)
			fmt.Printf("Project response: %+v\n", project2Resp)
			Expect(err).NotTo(HaveOccurred(), "Error creating second project")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 201")
			defer resp.Body.Close()
			project_id_2 = project2Resp.GetID()
			fmt.Printf("Second Project ID: %s\n", project_id_2)

			By("Creating user role assignment")
			
			
			userRoleData := map[string]interface{}{
				"project_id": project_id_1,
				"account_id": AccountId,
				"user_id":    userid,
				"role_id":    ProjectViewerId,
			}

			userRoleResp, resp, err := CreateUserRole(userRoleData, headers)
			Expect(err).NotTo(HaveOccurred(), "Error creating user role")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 201")
			defer resp.Body.Close()
			user_role_id = userRoleResp.ID
			GinkgoWriter.Printf("DEBUG: User role created with ID = %s\n", user_role_id)

			By("Resetting user password")
			fmt.Printf("=== DEBUG: RESETTING PASSWORD ===\n")
			fmt.Printf("User Email: %s\n", userEmail)
			fmt.Printf("New Password: Root@123\n")
			fmt.Printf("Keycloak User: %s\n", KeycloakUser)
			fmt.Printf("Attempting password reset...\n")
			err = ResetKeycloakPassword(userEmail, "Root@123", KeycloakUser, KeycloakPassword)
			if err != nil {
				fmt.Printf("PASSWORD RESET FAILED: %v\n", err)
			} else {
				fmt.Printf("PASSWORD RESET SUCCESSFUL\n")
			}
			fmt.Printf("=====================================\n")
			Expect(err).NotTo(HaveOccurred(), "Error resetting password")

			By("Logging in as the new user")
			localAuthToken, _, err = GetBearerToken(userEmail, "Root@123")
			if err != nil {
				fmt.Printf("LOGIN FAILED: %v\n", err)
			} else {
				fmt.Printf("LOGIN SUCCESSFUL\n")
				if len(localAuthToken) > 50 {
					fmt.Printf("Auth Token: %s...\n", localAuthToken[:50])
				} else {
					fmt.Printf("Auth Token: %s\n", localAuthToken)
				}
			}
			Expect(err).NotTo(HaveOccurred(), "Error logging in as new user")
			Expect(localAuthToken).NotTo(BeEmpty(), "Auth token should not be empty")

			headers = GetHeaders(localAuthToken, ContentTypeJSON)
			
			By("Verifying assigned role")
			permissionsResp, resp, err := GetUserPermissions(headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting user permissions")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			GinkgoWriter.Printf("DEBUG: User permissions response: %+v\n", permissionsResp)

			By("Getting user permissions as Project Viewer")
			permissionsResp, resp, err = GetUserPermissions(headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting user permissions")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			Expect(len(permissionsResp.Permissions)).To(BeNumerically(">=", 0), "Should have permissions list")

			By("Attempting to create project (should fail)")
			fmt.Printf("User Email: %s\n", userEmail)
			fmt.Printf("User ID: %s\n", userid)
			fmt.Printf("Username: %s\n", username)
			fmt.Printf("Role ID assigned: %s (ProjectViewerId)\n", ProjectViewerId)
			if len(localAuthToken) > 50 {
				fmt.Printf("Auth Token: %s...\n", localAuthToken[:50])
			} else {
				fmt.Printf("Auth Token: %s\n", localAuthToken)
			}
			fmt.Printf("This user should NOT be able to create projects!\n")
			fmt.Printf("=========================================================\n")
			
			projectData := map[string]interface{}{
				"account_id":          AccountId,
				"project_name":        GenerateUUID(),
				"project_description": "desc1",
				"start_date":          "2025-03-05T07:08:02.742Z",
			}

			fmt.Printf("=== CALLING CreateProject API ===\n")
			fmt.Printf("User making the request: %s (Email: %s, ID: %s)\n", userEmail, userEmail, userid)
			fmt.Printf("Role assigned: Project Viewer (ID: %s)\n", ProjectViewerId)
			fmt.Printf("Making API call with Project Viewer credentials...\n")
			_, resp, err = CreateProject(projectData, headers)
			fmt.Printf("=== API RESPONSE ===\n")
			fmt.Printf("Response Status Code: %d\n", resp.StatusCode)
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
				fmt.Printf("ERROR:User %s with Project Viewer role was able to create project!\n", userEmail)
			} else if resp.StatusCode == http.StatusForbidden {
				fmt.Printf("User %s with Project Viewer role was blocked from creating project (403 Forbidden)\n", userEmail)
			} else {
				fmt.Printf("UNEXPECTED: User %s got status code %d\n", userEmail, resp.StatusCode)
			}
			Expect(err).NotTo(HaveOccurred(), "No network error should occur")
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
			defer resp.Body.Close()

			By("Getting project list")
			projectsResp, resp, err := GetProjectList(AccountId, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting project list")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			defer resp.Body.Close()
			Expect(len(projectsResp.Projects)).To(BeNumerically(">=", 0), "Should have projects list")
		})

		It("should restrict access to projects not assigned to user", func() {
			By("Attempting to get project by ID for first project (should fail)")
			_, resp, err := GetProjectById(project_id_1, map[string]string{
				"Authorization": "Bearer " + localAuthToken,
				"Content-Type":  ContentTypeJSON,
				"projectid":     project_id_1,
			})
			Expect(err).NotTo(HaveOccurred(), "No network error should occur")
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
			defer resp.Body.Close()

			By("Attempting to get project by ID for second project (should fail)")
			_, resp, err = GetProjectById(project_id_2, map[string]string{
				"Authorization": "Bearer " + localAuthToken,
				"Content-Type":  ContentTypeJSON,
				"projectid":     project_id_2,
			})
			Expect(err).NotTo(HaveOccurred(), "No network error should occur")
			Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
			defer resp.Body.Close()
		})
	})

	AfterEach(func() {
		/*
		if user_role_id != "" {
			DeleteUserRole(user_role_id, GetHeaders(AuthToken, ContentTypeJSON))
		}
		if project_id_1 != "" {
			DeleteProject(project_id_1, GetHeaders(AuthToken, ContentTypeJSON))
		}
		if project_id_2 != "" {
			DeleteProject(project_id_2, GetHeaders(AuthToken, ContentTypeJSON))
		}
		if userid != "" {
			DeleteUser(userid, GetHeaders(AuthToken, ContentTypeJSON))
		}
		*/
	})
})
