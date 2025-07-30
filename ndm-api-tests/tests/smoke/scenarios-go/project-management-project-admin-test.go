
package tests

import (
    "encoding/json"
    "fmt"
    "io"
    . "ndm-api-tests/utils"
    "strings"
    "time"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

// userResponse represents the structure of user data returned from API responses
type userResponse struct {
    ID        string `json:"id"`        // Unique identifier for the user
    FirstName string `json:"first_name"` // User's first name
    LastName  string `json:"last_name"`  // User's last name
    // Username  string `json:"username"` // Commented out as not currently used
    Email     string `json:"email"`      // User's email address
}

// createUserRequest represents the payload structure for creating a new user
type createUserRequest struct {
    Username  string `json:"username"`   // Username for the new user
    FirstName string `json:"firstName"`  // First name of the user
    LastName  string `json:"lastName"`   // Last name of the user
}

// createProjectRequest represents the payload structure for creating a new project
type createProjectRequest struct {
    AccountID string `json:"account_id"`           // Account ID that owns the project
    ProjectName string `json:"project_name"`       // Name of the project
    ProjectDescription string `json:"project_description"` // Description of the project
    StartDate string `json:"start_date"`           // Project start date in RFC3339 format
}

// type createProjectResponse struct {
//     ID string `json:"id"`
// }

// userRoleRequest represents the payload structure for assigning roles to users
type userRoleRequest struct {
    ProjectID string `json:"project_id"` // ID of the project where the role is assigned
    AccountID string `json:"account_id"` // Account ID that owns the project
    UserID    string `json:"user_id"`    // ID of the user being assigned the role
    RoleID    string `json:"role_id"`    // Role ID being assigned to the user
}

// type userRoleResponse struct {
//     ID        string `json:"id"`
// }

// keyClockCred represents the credentials structure for Keycloak authentication
type keyClockCred struct {
    Username string `json:"username"` // Username for Keycloak authentication
    Password string `json:"password"` // Password for Keycloak authentication
}

// Project Management Project Admin Test
// This test suite validates the complete workflow of project admin functionality including:
// 1. User creation and role assignment
// 2. Project creation and management  
// 3. Permission-based access control
// 4. Authentication and authorization flows
// OrderedDescribe ensures that the specs run in order.
var _ = Describe("Project Management Project Admin Test", Ordered, func() {

    // Test variables to store state across test steps
    var (
        headers             map[string]string // HTTP headers for API requests
        accountID           string           // Account ID for the test
        projectAdminRoleID  string           // Role ID for project admin permissions
        // projectViewerRoleID string        // Role ID for project viewer permissions (not used)
        userID              string           // ID of the created test user
        userRoleID          string           // ID of the user role assignment  
        users               userResponse     // User details from API response
        projectID_1         string           // ID of the first test project
        projectID_2         string           // ID of the second test project
        refreshToken        string           // JWT refresh token for logout
        projectAdminToken   string           // JWT access token for project admin user
    )

    BeforeAll(func() {
        // Pre-test cleanup: Remove any existing test users from previous test runs
        // This ensures a clean state before running the test suite
        headers := GetHeaders(AuthToken, ContentTypeJSON)
        
        // Fetch all existing users to identify test users for cleanup
        getUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
        resp, err := SendAPIRequest("GET", getUsersURL, nil, headers)
        if err == nil && resp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(resp.Body)
            var usersResponse map[string]interface{}
            if json.Unmarshal(bodyBytes, &usersResponse) == nil {
                if data, ok := usersResponse["data"].([]interface{}); ok {
                    // Iterate through users and delete any that match test user patterns
                    for _, userItem := range data {
                        if user, ok := userItem.(map[string]interface{}); ok {
                            if username, ok := user["username"].(string); ok {
                                // Delete test users based on username patterns
                                if username == "testprojectadmin@email.com" || 
                                   username == "testprojectadmin2119@email.com" ||
                                   strings.Contains(username, "testprojectadmin") {
                                    if existingUserID, ok := user["id"].(string); ok {
                                        deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, existingUserID)
                                        deleteResp, _ := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
                                        if deleteResp != nil {
                                            deleteResp.Body.Close()
                                            fmt.Printf("Cleaned up existing test user: %s (ID: %s)\n", username, existingUserID)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            resp.Body.Close()
        }
        
        fmt.Println("Initial user cleanup complete.")
    })

    BeforeEach(func() {
        // Initialize test environment variables before each test execution
        headers = GetHeaders(AuthToken, ContentTypeJSON)
        accountID = AccountId
        projectAdminRoleID = ProjectAdminId
        // projectViewerRoleID = ProjectViewerId
    })

    It("should complete the full project admin workflow", func() {
        By("creating a test user")
        // Step 1: Create a new test user that will be assigned project admin role
        createURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)

        createUserRequest := createUserRequest{
            Username:  fmt.Sprintf("testprojectadmin-%d@email.com", time.Now().UnixNano()), // Unique username using timestamp
            FirstName: "test",
            LastName:  "user",
        }

        // Marshal request payload and send API request
        reqBody, err := json.Marshal(createUserRequest)
        Expect(err).NotTo(HaveOccurred())

        resp, err := SendAPIRequest("POST", createURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        // Parse response to extract user details
        bodyBytes, err := io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())

        fmt.Printf("Raw response body: %s\n", string(bodyBytes))

        var genericResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse)
        Expect(err).NotTo(HaveOccurred())

        // Extract user ID and details from nested response structure
        if data, ok := genericResponse["data"].(map[string]interface{}); ok {
            if items, ok := data["items"].(map[string]interface{}); ok {
                if user, ok := items["user"].(map[string]interface{}); ok {
                    if id, ok := user["id"].(string); ok {
                        userID = id
                        users.FirstName = user["first_name"].(string)
                        users.LastName = user["last_name"].(string)
                        users.Email = user["email"].(string)
                        users.ID = id

                        fmt.Printf("User created with ID: %s\n", userID)
                        fmt.Printf("User first name: %s\n", users.FirstName)
                    }
                }
            }
        }

        fmt.Printf("User details: %+v\n", users)

        // Validate user creation was successful
        Expect(err).NotTo(HaveOccurred())
        Expect(users.FirstName).To(Equal("test"))
        Expect(userID).NotTo(BeEmpty())

        By("creating project 1")
        // Step 2: Create the first project that the project admin will have access to
        createProjectURL := fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
        createProject := createProjectRequest{
            AccountID: AccountId,
            ProjectName: AutoGenerateProjectName(""), // Generate unique project name
            ProjectDescription: "desc1",
            StartDate: "2025-03-05T07:08:02.742Z",
        }

        reqBody, err = json.Marshal(createProject)
        Expect(err).NotTo(HaveOccurred())

        resp, err = SendAPIRequest("POST", createProjectURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200)) 
        
        // Extract project ID from response
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())

        var genericResponse1 map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse1)
        Expect(err).NotTo(HaveOccurred())

        if data, ok := genericResponse1["data"].(map[string]interface{}); ok {
            if id, ok := data["id"].(string); ok {
                projectID_1 = id
            }
        }

        Expect(projectID_1).NotTo(BeEmpty())
        fmt.Printf("Project 1 created with ID: %s\n", projectID_1)

        By("creating project 2")
        // Step 3: Create a second project that the project admin should NOT have access to
        // This is used to test permission boundaries
        createProjectRequest2 := createProjectRequest{
            AccountID: AccountId,
            ProjectName: AutoGenerateProjectName(""),
            ProjectDescription: "desc1",
            StartDate: "2025-03-05T07:08:02.742Z",
        }

        reqBody, err = json.Marshal(createProjectRequest2)
        Expect(err).NotTo(HaveOccurred())

        resp, err = SendAPIRequest("POST", createProjectURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))  

        // Extract second project ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())

        var genericResponse2 map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse2)
        Expect(err).NotTo(HaveOccurred())

        if data, ok := genericResponse2["data"].(map[string]interface{}); ok {
            if id, ok := data["id"].(string); ok {
                projectID_2 = id
            }
        }

        Expect(projectID_2).NotTo(BeEmpty())
        fmt.Printf("Project 2 created with ID: %s\n", projectID_2)

        By("creating user role assignment")
        // Step 4: Assign project admin role to the test user for project 1 only
        // This establishes the permission boundary for the test
        createUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
        createUserRoleReq := userRoleRequest{
            ProjectID: projectID_1,     // Only assign access to project 1
            AccountID: accountID,
            UserID:    userID,
            RoleID:    projectAdminRoleID,
        }   

        reqBody, err = json.Marshal(createUserRoleReq)
        Expect(err).NotTo(HaveOccurred())

        resp, err = SendAPIRequest("POST", createUserRoleURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        // Extract user role assignment ID for cleanup
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())
        
        var genericResponse3 map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse3)
        Expect(err).NotTo(HaveOccurred())

        if data, ok := genericResponse3["data"].(map[string]interface{}); ok {
            if id, ok := data["id"].(string); ok {
                userRoleID = id
            }
        }

        Expect(userRoleID).NotTo(BeEmpty())
        fmt.Printf("Successfully got user role ID: %s\n", userRoleID)

        By("resetting Keycloak password")
        // Step 5: Reset the user's password in Keycloak to enable login
        // This is necessary for newly created users to authenticate
        var keycloakCred = keyClockCred{
            Username: users.Email,
            Password: "Root@123",
        }

        fmt.Println("Keycloak credentials:", keycloakCred)

        // Get Keycloak admin access token
        localAuthToken, err := GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
        Expect(err).NotTo(HaveOccurred(), "Error getting Keycloak Access Token")
        fmt.Println("Keycloak Access Token retrieved successfully.")

        // Fetch the Keycloak user ID using email
        keycloakUserId, err := FetchUserID(users.Email, localAuthToken)
        Expect(err).NotTo(HaveOccurred(), "Error fetching Keycloak User ID")
        fmt.Printf("Keycloak User ID retrieved successfully: %s\n", keycloakUserId)

        // Reset password via Keycloak Admin API
        url := fmt.Sprintf("https://%s/%s/%s/reset-password", KEYCLOAK_IP, KEYCLOAK_BASE_URL, keycloakUserId)
        payload := map[string]interface{}{
            "type":      "password",
            "value":     "Root@123",
            "temporary": false, // Set to false so user doesn't need to change password on first login
        }
        bodyBytes, err = json.Marshal(payload)
        Expect(err).NotTo(HaveOccurred())
        
        keycloakHeaders := GetHeaders(localAuthToken, ContentTypeJSON)
        resp, err = SendAPIRequest("PUT", url, bodyBytes, keycloakHeaders)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        
        Expect(resp.StatusCode).To(Equal(204)) // 204 indicates successful password reset
        fmt.Printf("Keycloak password reset with status: %d\n", resp.StatusCode)

        By("logging in with new user credentials")
        // Step 6: Authenticate as the project admin user to get access tokens
        userCred := map[string]interface{}{
            "username": users.Email,
            "password": "Root@123",
        }

        // Obtain JWT tokens for the project admin user
        localToken, localRefreshToken, statusCode, err := GetBearerTokenWithStatus(userCred["username"].(string), userCred["password"].(string))
        Expect(err).NotTo(HaveOccurred())
        Expect(statusCode).To(Equal(200), "Expected login to return status code 200")
        Expect(localToken).NotTo(BeEmpty(), "Expected to receive a valid token")
        Expect(localRefreshToken).NotTo(BeEmpty(), "Expected to receive a valid refresh token")
        
        // Store tokens for use in subsequent steps
        refreshToken = localRefreshToken
        projectAdminToken = localToken

        fmt.Printf("Project Admin Token: %s\n", projectAdminToken)
        fmt.Printf("Refresh Token: %s\n", refreshToken)

        By("getting permission list")
        // Step 7: Verify that the user permissions endpoint is accessible
        // This validates that the authentication is working correctly
        getPermissionListURL := fmt.Sprintf("%s/api/v1/user-permissions", ADMIN_SERVICE_URL)
        resp, err = SendAPIRequest("GET", getPermissionListURL, nil, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        By("attempting to create project as project admin (should fail with 403)")
        // Step 8: Test permission boundary - project admins should NOT be able to create new projects
        // This validates that role-based access control is working correctly
        createProjectURL = fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
        createProjectRequest3 := createProjectRequest{
            AccountID: AccountId,
            ProjectName: AutoGenerateProjectName(""),
            ProjectDescription: "desc1",
            StartDate: "2025-03-05T07:08:02.742Z",
        }

        reqBody, err = json.Marshal(createProjectRequest3)
        Expect(err).NotTo(HaveOccurred())

        // Use project admin token instead of system admin token
        projectAdminHeaders := GetHeaders(projectAdminToken, ContentTypeJSON)

        resp, err = SendAPIRequest("POST", createProjectURL, reqBody, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(403)) // 403 Forbidden is expected
        fmt.Println("Project creation failed as expected", resp.StatusCode)

        By("getting project list as project admin")
        // Step 9: Verify that project admin can list projects they have access to
        projectAdminHeaders = GetHeaders(projectAdminToken, ContentTypeJSON)
        getProjectListURL := fmt.Sprintf("%s/api/v1/projects/accounts/%s/projects?limit=1000", ADMIN_SERVICE_URL, AccountId)
        resp, err = SendAPIRequest("GET", getProjectListURL, nil, projectAdminHeaders)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))
        fmt.Println("Project list retrieved successfully", resp.StatusCode)

        By("getting project by project ID 1 (should succeed)")
        // Step 10: Test that project admin can access project 1 (which they have admin rights to)
        user_headers := GetHeaders(AuthToken, ContentTypeJSON)
        user_headers["projectid"] = projectID_1 // Add project ID to headers for authorization
        getProjectByIdURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID_1)
        resp, err = SendAPIRequest("GET", getProjectByIdURL, nil, user_headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))
        fmt.Println("Project 1 retrieved successfully", resp.StatusCode)

        By("getting project by project ID 2 as project admin (should fail with 403)")
        // Step 11: Test permission boundary - project admin should NOT have access to project 2
        // This validates that the role assignment is project-specific
        user_headers = GetHeaders(projectAdminToken, ContentTypeJSON)
        user_headers["projectid"] = projectID_2
        getProjectByIdURL = fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID_2)
        resp, err = SendAPIRequest("GET", getProjectByIdURL, nil, user_headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(403)) // 403 Forbidden is expected
        fmt.Println("Project 2 retrieval failed as expected", resp.StatusCode)
    })

    AfterAll(func() {
        // Comprehensive cleanup after all tests complete
        // This ensures no test artifacts remain in the system
        
        // Logout user if logged in to invalidate tokens
        if refreshToken != "" {
            _, _, err := LogoutUserStatusCode(refreshToken)
            if err != nil {
                fmt.Printf("Warning: Failed to logout user: %v\n", err)
            }
        }

        // Clean up created user role assignment
        if userRoleID != "" {
            deleteUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleID)
            resp, err := SendAPIRequest("DELETE", deleteUserRoleURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up user role: %s\n", userRoleID)
        }
        
        // Clean up created projects
        if projectID_1 != "" {
            deleteProjectURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID_1)
            resp, err := SendAPIRequest("DELETE", deleteProjectURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up project 1: %s\n", projectID_1)
        }
        
        if projectID_2 != "" {
            deleteProjectURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID_2)
            resp, err := SendAPIRequest("DELETE", deleteProjectURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up project 2: %s\n", projectID_2)
        }
        
        // Clean up created test user
        if userID != "" {
            deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userID)
            resp, err := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up test user: %s\n", userID)
        }
        
        fmt.Println("All cleanup operations completed.")
    })
})

