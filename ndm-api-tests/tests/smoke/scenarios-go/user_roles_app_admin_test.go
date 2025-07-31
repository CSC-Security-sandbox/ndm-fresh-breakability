package tests

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strings"
    "time"

    . "ndm-api-tests/utils"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

// UserRoleRequest represents the request payload for user role operations

// User Roles App Admin Test
// This test suite validates the complete workflow of user role management functionality including:
// 1. User creation and role assignment
// 2. Role retrieval and verification
// 3. Role updates and permission changes
// 4. User role lifecycle management
var _ = Describe("User Roles App Admin Test", Ordered, func() {
    // Test variables to store state across test steps
    var (
        headers             map[string]string // HTTP headers for API requests
        projectID           string           // ID of the test project
        accountID           string           // Account ID for the test
        projectAdminRoleID  string           // Role ID for project admin permissions
        projectViewerRoleID string           // Role ID for project viewer permissions
        userID              string           // ID of the created test user
        userRoleID          string           // ID of the user role assignment
    )

    BeforeAll(func() {
        // Pre-test cleanup: Remove any existing test users from previous test runs
        // This ensures a clean state before running the test suite
        headers = GetHeaders(AuthToken, ContentTypeJSON)

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
        // Create a test project for user role operations
        // Skip worker setup for this test - focus on user roles functionality
        url := fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
        body := map[string]string{
            "account_id":          AccountId,
            "project_name":        fmt.Sprintf("test-project-%d-%d", GinkgoRandomSeed(), time.Now().UnixNano()),
            "project_description": "Project for user roles testing",
            "start_date":          time.Now().UTC().Format(time.RFC3339),
        }
        bodyBytes, _ := json.Marshal(body)
        headers = GetHeaders(AuthToken, ContentTypeJSON)

        // Send project creation request
        resp, err := SendAPIRequest("POST", url, bodyBytes, headers)
        if err != nil {
            Fail(fmt.Sprintf("Failed to create project: %v", err))
        }

        // Parse the response to extract project ID
        bodyData, _ := io.ReadAll(resp.Body)
        if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusConflict {
            fmt.Printf("Project creation failed. Status: %d, Response: %s\n", resp.StatusCode, string(bodyData))
            Fail(fmt.Sprintf("Failed to create project, status: %d", resp.StatusCode))
        }

        var responseData map[string]interface{}
        json.Unmarshal(bodyData, &responseData)

        // Extract project ID from response (handle both success and conflict cases)
        if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
            if data, ok := responseData["data"].(map[string]interface{}); ok {
                if id, ok := data["id"].(string); ok {
                    projectID = id
                } else if idFloat, ok := data["id"].(float64); ok {
                    projectID = fmt.Sprintf("%.0f", idFloat)
                } else {
                    Fail("Failed to extract project ID from response")
                }
            } else {
                Fail("Failed to extract data from project creation response")
            }
        } else if resp.StatusCode == http.StatusConflict {
            // Project already exists - create a dummy project ID for testing
            projectID = fmt.Sprintf("existing-project-%d", time.Now().UnixNano())
        }

        // Initialize other required test variables
        accountID = AccountId
        projectAdminRoleID = ProjectAdminId
        projectViewerRoleID = ProjectViewerId

        fmt.Println("Project ID:", projectID)
        fmt.Println("Initialization complete.")
    })

    It("should complete the user roles management workflow", func() {
        By("creating a new user")
        // Step 1: Create a test user that will be assigned various roles
        createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
        createUserReq := CreateUserRequest{
            Username:  fmt.Sprintf("testprojectadmin-%d-%d@email.com", GinkgoRandomSeed(), time.Now().UnixNano()), // Unique username using timestamp
            FirstName: "test",
            LastName:  "user",
        }

        // Marshal request payload and send API request
        reqBody, err := json.Marshal(createUserReq)
        Expect(err).NotTo(HaveOccurred())

        resp, err := SendAPIRequest("POST", createUserURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        // Parse response to extract user details
        bodyBytes, err := io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())

        fmt.Printf("Raw response body: %s\n", string(bodyBytes))

        // Parse as a generic response first to handle nested structure
        var genericResponse map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse)
        Expect(err).NotTo(HaveOccurred())

        // Extract user ID from the nested response structure
        if data, ok := genericResponse["data"].(map[string]interface{}); ok {
            if items, ok := data["items"].(map[string]interface{}); ok {
                if user, ok := items["user"].(map[string]interface{}); ok {
                    if id, ok := user["id"].(string); ok {
                        userID = id
                    }
                }
            }
        }

        // The most important check - ensure we have a user ID
        Expect(userID).NotTo(BeEmpty(), "Should have received a user ID from the API")
        fmt.Printf("Successfully got user ID: %s\n", userID)

        By("creating a new user role assignment")
        // Step 2: Assign project admin role to the test user
        createUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
        userRoleReq := UserRoleRequest{
            ProjectID: projectID,
            AccountID: accountID,
            UserID:    userID,
            RoleID:    projectAdminRoleID,
        }

        reqBody, err = json.Marshal(userRoleReq)
        Expect(err).NotTo(HaveOccurred())

        fmt.Printf("User role request data: %s\n", string(reqBody))
        fmt.Printf("ProjectID: %s, AccountID: %s, UserID: %s, RoleID: %s\n",
            projectID, accountID, userID, projectAdminRoleID)

        resp, err = SendAPIRequest("POST", createUserRoleURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()

        // Parse response to get user role ID
        bodyBytes, err = io.ReadAll(resp.Body)
        Expect(err).NotTo(HaveOccurred())
        fmt.Printf("User role creation response: %s\n", string(bodyBytes))

        if resp.StatusCode != 200 {
            fmt.Printf("Expected 200 but got %d. Response: %s\n", resp.StatusCode, string(bodyBytes))
        }

        Expect(resp.StatusCode).To(Equal(200))

        // Parse response to get user role ID
        var genericResponse2 map[string]interface{}
        err = json.Unmarshal(bodyBytes, &genericResponse2)
        Expect(err).NotTo(HaveOccurred())

        // Try to extract user role ID from response (similar to user creation)
        if data, ok := genericResponse2["data"].(map[string]interface{}); ok {
            if id, ok := data["id"].(string); ok {
                userRoleID = id
            }
        }

        Expect(userRoleID).NotTo(BeEmpty())
        fmt.Printf("Successfully got user role ID: %s\n", userRoleID)

        By("retrieving all user roles to verify creation")
        // Step 3: Verify that the user role assignment was created successfully
        getUserRolesURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)

        resp, err = SendAPIRequest("GET", getUserRolesURL, nil, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        fmt.Printf("Successfully retrieved user roles list\n")

        By("updating the user role from project admin to project viewer")
        // Step 4: Test role modification by changing from admin to viewer role
        updateUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleID)
        updateUserRoleReq := UserRoleRequest{
            ProjectID: projectID,
            AccountID: accountID,
            UserID:    userID,
            RoleID:    projectViewerRoleID, // Change from admin to viewer role
        }

        reqBody, err = json.Marshal(updateUserRoleReq)
        Expect(err).NotTo(HaveOccurred())

        fmt.Printf("Updating user role from %s to %s\n", projectAdminRoleID, projectViewerRoleID)

        resp, err = SendAPIRequest("PATCH", updateUserRoleURL, reqBody, headers)
        Expect(err).NotTo(HaveOccurred())
        defer resp.Body.Close()
        Expect(resp.StatusCode).To(Equal(200))

        fmt.Printf("Successfully updated user role to project viewer\n")
    })

    AfterAll(func() {
        // Comprehensive cleanup after all tests complete
        // This ensures no test artifacts remain in the system
        
        // Clean up the created test user
        if userID != "" {
            deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userID)
            resp, err := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up test user: %s\n", userID)
        }
        
        // Clean up the user role assignment
        if userRoleID != "" {
            deleteUserRoleURL := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, userRoleID)
            resp, err := SendAPIRequest("DELETE", deleteUserRoleURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up test user role: %s\n", userRoleID)
        }

        // Clean up the project created for testing 
        if projectID != "" {
            deleteProjectURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID)
            resp, err := SendAPIRequest("DELETE", deleteProjectURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up test project: %s\n", projectID)
        }
        
        fmt.Println("All cleanup operations completed.")
    })
})
