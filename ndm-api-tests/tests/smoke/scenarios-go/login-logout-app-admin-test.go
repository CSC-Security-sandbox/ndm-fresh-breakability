package tests

import (
    "encoding/json"
    "fmt"
    "io"
    "log"
    . "ndm-api-tests/utils"
    "net/http"
    "net/url"
    "strings"
    "time"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

func LogoutUserStatusCode(refreshToken string) (string, int, error) {

    logoutURL := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, LOGOUT_URL)

    data := url.Values{}
    data.Set("client_id", CLIENT_ID)
    data.Set("client_secret", CLIENT_SECRET)
    data.Set("refresh_token", refreshToken)
    requestBody := data.Encode()

    headers := GetHeaders("", ContentTypeForm)

    resp, err := SendAPIRequest("POST", logoutURL, []byte(requestBody), headers)
    statusCode := resp.StatusCode
    if err != nil {
        log.Printf("Error executing request: %v", err)
        return "", statusCode, err
    }
    defer resp.Body.Close()
    if resp.StatusCode == 204 {
        log.Printf("User Logout")
        return "", statusCode, nil
    } else {
        log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
        errorBytes, err := io.ReadAll(resp.Body)
        if err != nil {
            log.Printf("Error reading error response: %v", err)
        } else {
            log.Printf("Error Response: %s", string(errorBytes))
        }
        return "", statusCode, fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
    }
}

func GetBearerTokenWithStatus(userN, pass string) (string, string, int, error) {
    tokenUrl := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, TOKEN_URL)
    defaultUsername := USERNAME
    defaultPassword := PASSWORD

    username := strings.TrimSpace(userN)
    if username == "" {
        username = strings.TrimSpace(defaultUsername)
    }
    password := strings.TrimSpace(pass)
    if password == "" {
        password = strings.TrimSpace(defaultPassword)
    }
    data := url.Values{}
    data.Set("client_id", CLIENT_ID)
    data.Set("client_secret", CLIENT_SECRET)
    data.Set("grant_type", GRANT_TYPE)
    data.Set("username", username)
    data.Set("password", password)
    requestBody := data.Encode()

    headers := GetHeaders("", ContentTypeForm)
    resp, err := SendAPIRequest("POST", tokenUrl, []byte(requestBody), headers)
    statusCode := resp.StatusCode
    if err != nil {
        log.Printf("Error executing request: %v", err)
        return "", "", statusCode, err
    }
    defer resp.Body.Close()
    if resp.StatusCode == http.StatusOK {
        bodyBytes, err := io.ReadAll(resp.Body)
        if err != nil {
            log.Printf("Error reading response: %v", err)
            return "", "", statusCode, err
        }
        var jsonResponse map[string]interface{}
        if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
            log.Printf("Error parsing JSON response: %v", err)
            return "", "", statusCode, err
        }
        accessToken, ok := jsonResponse["access_token"].(string)
        if !ok {
            log.Printf("access_token not found in response")
            return "", "", statusCode, err
        }
        log.Printf("Access Token: Fetched")
        refreshToken, ok := jsonResponse["refresh_token"].(string)
        if !ok {
            log.Printf("refresh_token not found in response")
            return "", "", statusCode, err
        }
        log.Printf("Refresh Token: Fetched")
        return accessToken, refreshToken, statusCode, nil
    } else {
        log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
        errorBytes, err := io.ReadAll(resp.Body)
        if err != nil {
            log.Printf("Error reading error response: %v", err)
        } else {
            log.Printf("Error Response: %s", string(errorBytes))
        }
        return "", "", statusCode, fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
    }
}

var _ = Describe("Login and Logout App Admin Test", Ordered, func() {

    var (
        localRefreshToken string
        projectID         string
        // localToken1       string
    )

    BeforeAll(func() {
        // Clean up any existing test users from previous runs
        headers := GetHeaders(AuthToken, ContentTypeJSON)
        
        getUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
        resp, err := SendAPIRequest("GET", getUsersURL, nil, headers)
        if err == nil && resp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(resp.Body)
            var usersResponse map[string]interface{}
            if json.Unmarshal(bodyBytes, &usersResponse) == nil {
                if data, ok := usersResponse["data"].([]interface{}); ok {
                    for _, userItem := range data {
                        if user, ok := userItem.(map[string]interface{}); ok {
                            if username, ok := user["username"].(string); ok {
                                // Delete any test users (common test usernames)
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
        // Skip worker setup for this test - focus on user login/logout functionality
        // Create a simple project without worker setup
        url := fmt.Sprintf("%s/api/v1/projects", ADMIN_SERVICE_URL)
        body := map[string]string{
            "account_id":          AccountId,
            "project_name":        fmt.Sprintf("test-project-%d-%d", GinkgoRandomSeed(), time.Now().UnixNano()),
            "project_description": "Project for login/logout testing",
            "start_date":          time.Now().UTC().Format(time.RFC3339),
        }
        bodyBytes, _ := json.Marshal(body)
        headers := GetHeaders(AuthToken, ContentTypeJSON)

        resp, err := SendAPIRequest("POST", url, bodyBytes, headers)
        if err != nil {
            Fail(fmt.Sprintf("Failed to create project: %v", err))
        }

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
            // Project already exists, we can use it - need to get the existing project ID
            // For now, we'll create a dummy project ID
            projectID = fmt.Sprintf("existing-project-%d", time.Now().UnixNano())
        }

        fmt.Println("Project ID:", projectID)
    })

    It("should complete the login and logout workflow", func() {
        By("executing new-login with default credentials")
        // Test login with default credentials (empty strings use defaults from environment)
        // This matches the YAML: username: "", password: ""

        token, refreshToken, statusCode, err := GetBearerTokenWithStatus("", "")
        Expect(err).NotTo(HaveOccurred(), "Error during login")
        Expect(statusCode).To(Equal(200), "Expected login to return status code 200") // Match actual HTTP OK status
        Expect(token).NotTo(BeEmpty(), "Expected to receive a valid token")
        Expect(refreshToken).NotTo(BeEmpty(), "Expected to receive a valid refresh token")

        // Store tokens for logout test
        // localToken1 = token
        localRefreshToken = refreshToken

        fmt.Printf("Login successful with status code: %d\n", statusCode)
        fmt.Printf("Access token received: %s...\n", token[:20])
        fmt.Printf("Refresh token received: %s...\n", refreshToken[:20])

        By("executing logout-user with the obtained refresh token")
        // Ensure we have a refresh token from the login step
        Expect(localRefreshToken).NotTo(BeEmpty(), "Refresh token should be available from login step")

        // Test logout - matches YAML: method: post, data: {}, response: status_code: 204
        _, logoutStatusCode, err := LogoutUserStatusCode(localRefreshToken)
        Expect(err).NotTo(HaveOccurred(), "Error during logout")
        Expect(logoutStatusCode).To(Equal(204), "Expected logout to return status code 204") // Match YAML expectation

        fmt.Printf("Logout successful with status code: %d\n", logoutStatusCode)
        
        // Clear tokens after successful logout
        // localToken1 = ""
        localRefreshToken = ""
    })

    AfterAll(func() {
        // Clean up any test users created during the test run
        headers := GetHeaders(AuthToken, ContentTypeJSON)
        
        getUsersURL := fmt.Sprintf("%s/api/v1/users", ADMIN_SERVICE_URL)
        resp, err := SendAPIRequest("GET", getUsersURL, nil, headers)
        if err == nil && resp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(resp.Body)
            var usersResponse map[string]interface{}
            if json.Unmarshal(bodyBytes, &usersResponse) == nil {
                if data, ok := usersResponse["data"].([]interface{}); ok {
                    for _, userItem := range data {
                        if user, ok := userItem.(map[string]interface{}); ok {
                            if username, ok := user["username"].(string); ok {
                                // Delete any test users (common test usernames)
                                if username == "testprojectadmin@email.com" || 
                                   username == "testprojectadmin2119@email.com" ||
                                   strings.Contains(username, "testprojectadmin") {
                                    if existingUserID, ok := user["id"].(string); ok {
                                        deleteUserURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, existingUserID)
                                        deleteResp, _ := SendAPIRequest("DELETE", deleteUserURL, nil, headers)
                                        if deleteResp != nil {
                                            deleteResp.Body.Close()
                                            fmt.Printf("Final cleanup of test user: %s (ID: %s)\n", username, existingUserID)
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
        
        fmt.Println("Final user cleanup complete.")
    })
})
