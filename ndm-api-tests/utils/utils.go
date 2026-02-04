package utils

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"ndm-api-tests/tests/smoke/parser"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/ssh"
)

var tr = &http.Transport{
	TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
}

// SSHConfig holds the configuration for the SSH connection.
type SSHConfig struct {
	Username string
	Host     string
	Port     int
	Password string
}

type KeycloakCredentials struct {
	AdminUser     string
	AdminPassword string
	ClientSecret  string
}

// =============================================================================
// GENERIC API RESPONSE TYPES
// =============================================================================

// Generic API response wrapper that handles both single objects and arrays in items
type ApiResponse[T any] struct {
	Data struct {
		Items FlexibleItems[T] `json:"items"`
	} `json:"data"`
}

// FlexibleItems can unmarshal either a single object or an array of objects
type FlexibleItems[T any] []T

// getBearerToken retrieves a bearer token using provided credentials or environment variables.
func GetBearerToken(userN, pass string) (string, string, error) {
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
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return "", "", err
		}
		var jsonResponse map[string]interface{}
		if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
			log.Printf("Error parsing JSON response: %v", err)
			return "", "", err
		}
		accessToken, ok := jsonResponse["access_token"].(string)
		if !ok {
			log.Printf("access_token not found in response")
			return "", "", err
		}
		log.Printf("Access Token: Fetched")
		refreshToken, ok := jsonResponse["refresh_token"].(string)
		if !ok {
			log.Printf("refresh_token not found in response")
			return "", "", err
		}
		log.Printf("Refresh Token: Fetched")
		return accessToken, refreshToken, nil
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", "", fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
	}
}

// LogoutUser log out the user by delete the tokens using provided refresh token.
func LogoutUser(refreshToken string) (string, error) {

	logoutURL := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, LOGOUT_URL)

	data := url.Values{}
	data.Set("client_id", CLIENT_ID)
	data.Set("client_secret", CLIENT_SECRET)
	data.Set("refresh_token", refreshToken)
	requestBody := data.Encode()

	headers := GetHeaders("", ContentTypeForm)
	resp, err := SendAPIRequest("POST", logoutURL, []byte(requestBody), headers)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 204 {
		log.Printf("User Logout")
		return "", nil
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
	}
}

func GetKeyCloakAccessToken(userN, pass string) (string, error) {
	if strings.TrimSpace(userN) == "" || strings.TrimSpace(pass) == "" {
		return "", fmt.Errorf("username and password must be provided")
	}

	if KEYCLOAK_IP == "" || CLIENT_ID == "" || GRANT_TYPE == "" {
		return "", fmt.Errorf("one or more required environment variables are not set (KEYCLOAK_IP, CLIENT_ID, GRANT_TYPE)")
	}

	tokenUrl := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, KEYCLOAK_TOKEN_URL)

	data := url.Values{}
	data.Set("client_id", KEYCLOAK_CLIENT_ID)
	data.Set("username", userN)
	data.Set("password", pass)
	data.Set("grant_type", GRANT_TYPE)
	requestBody := data.Encode()

	headers := GetHeaders("", ContentTypeForm)
	resp, err := SendAPIRequest("POST", tokenUrl, []byte(requestBody), headers)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return "", err
		}
		var jsonResponse map[string]interface{}
		if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
			log.Printf("Error parsing JSON response: %v", err)
			return "", err
		}
		accessToken, ok := jsonResponse["access_token"].(string)
		if !ok {
			log.Printf("access_token not found in response")
			return "", fmt.Errorf("access_token not found in response")
		}
		return accessToken, nil
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", fmt.Errorf("failed to get token, HTTP response code: %d", resp.StatusCode)
	}
}

// GetKeyCloakAdminToken gets admin token using admin-cli service account with client_credentials grant
// This is used for admin operations on the datamigrator realm (user management, etc.)
func GetKeyCloakAdminToken() (string, error) {
	if KEYCLOAK_IP == "" {
		return "", fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}
	if CLIENT_SECRET == "" {
		return "", fmt.Errorf("environment variable CLIENT_SECRET not set")
	}
	if TOKEN_URL == "" {
		return "", fmt.Errorf("environment variable TOKEN_URL not set")
	}

	tokenUrl := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, TOKEN_URL)
	data := url.Values{}
	data.Set("client_id", "admin-cli")
	data.Set("client_secret", CLIENT_SECRET)
	data.Set("grant_type", "client_credentials")

	headers := map[string]string{
		"Content-Type": "application/x-www-form-urlencoded",
	}

	resp, err := SendAPIRequest("POST", tokenUrl, []byte(data.Encode()), headers)
	if err != nil {
		return "", fmt.Errorf("error sending token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to get admin token, HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response: %w", err)
	}

	var jsonResponse map[string]interface{}
	if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
		return "", fmt.Errorf("error parsing JSON response: %w", err)
	}

	accessToken, ok := jsonResponse["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("access_token not found in response")
	}

	return accessToken, nil
}

func FetchUserID(email, accessToken string) (string, error) {
	if KEYCLOAK_IP == "" {
		return "", fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}
	url := fmt.Sprintf("https://%s/%s?email=%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL, email)
	headers := GetHeaders(accessToken, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", url, nil, headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("non-200 response: %d", resp.StatusCode)
	}
	var users []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(bodyBytes, &users); err != nil {
		return "", err
	}
	if len(users) == 0 {
		return "", fmt.Errorf("no user found")
	}
	return users[0].ID, nil
}

func GenerateNewPassword(length int) (string, error) {
	const (
		lower    = "abcdefghijklmnopqrstuvwxyz"
		upper    = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		digits   = "0123456789"
		special  = "!@#$%^&*()-_=+[]{}|;:,.<>/?"
		allChars = lower + upper + digits + special
	)

	if length < 8 {
		return "", errors.New("password length must be at least 8 to include all character types")
	}

	// Ensure at least one character from each category
	categories := []string{lower, upper, digits, special}
	var password []byte

	for _, category := range categories {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(category))))
		if err != nil {
			return "", err
		}
		password = append(password, category[idx.Int64()])
	}

	// Fill the rest of the password length with random characters from allChars
	for i := 4; i < length; i++ {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(allChars))))
		if err != nil {
			return "", err
		}
		password = append(password, allChars[idx.Int64()])
	}

	// Shuffle the password to avoid predictable placement of category characters
	for i := range password {
		j, err := rand.Int(rand.Reader, big.NewInt(int64(len(password))))
		if err != nil {
			return "", err
		}
		password[i], password[j.Int64()] = password[j.Int64()], password[i]
	}

	// fmt.Println("Password is :", string(password))

	return string(password), nil
}

func ResetUserPassword(userID, accessToken, newPassword string) error {
	if KEYCLOAK_IP == "" {
		return fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}
	url := fmt.Sprintf("https://%s/%s/%s/reset-password", KEYCLOAK_IP, KEYCLOAK_BASE_URL, userID)

	var err error
	isResetPasswdDone := false

	for attempt := 1; attempt <= 10; attempt++ {
		PASSWORD, err = GenerateNewPassword(10)
		if err != nil {
			return fmt.Errorf("failed to generate new password: %w", err)
		}

		payload := map[string]interface{}{
			"type":      "password",
			"value":     PASSWORD,
			"temporary": false,
		}
		bodyBytes, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal payload: %w", err)
		}

		LogDebug(fmt.Sprintf("Resetting Password, attempt=%d", attempt))
		headers := GetHeaders(accessToken, ContentTypeJSON)
		resp, err := SendAPIRequest("PUT", url, bodyBytes, headers)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
			isResetPasswdDone = true
			// fmt.Printf("Password reset successful for user %s, new password: %s\n", userID, PASSWORD)
			// LogDebug(fmt.Sprintf("Password reset successful for user %s, new password: %s", userID, PASSWORD))
			break
		}

		Wait(DefaultPollInterval)
	}

	if !isResetPasswdDone {
		return errors.New("failed to reset-password even after 10 attempts")
	}

	// LogDebug(fmt.Sprintf("Password reset completed for user %s, password: %s", userID, PASSWORD))
	return nil
}

func UpdateUserProfile(userID, accessToken string) error {
	if KEYCLOAK_IP == "" {
		return fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}
	url := fmt.Sprintf("https://%s/%s/%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL, userID)
	profile := map[string]interface{}{
		"firstName":       "admin",
		"lastName":        "admin",
		"email":           USERNAME,
		"requiredActions": []string{},
	}
	bodyBytes, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}
	headers := GetHeaders(accessToken, ContentTypeJSON)
	resp, err := SendAPIRequest("PUT", url, bodyBytes, headers)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("unexpected response code: %d", resp.StatusCode)
	}
	return nil
}

// GetRoleId for each user.
func GetRoleId(authToken string) (string, string, string, error) {
	type Role struct {
		ID       string `json:"id"`
		RoleName string `json:"role_name"`
	}

	type Data struct {
		Items []Role `json:"items"`
	}

	type RoleResponse struct {
		Data Data `json:"data"`
	}
	var appAdminId, projectAdminId, projectViewerId string

	log.Println("Fetching Role IDs...")

	url := ADMIN_SERVICE_URL + "/api/v1/roles"
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", url, nil, headers)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()

	// Check for non-200 HTTP status codes.
	if resp.StatusCode != http.StatusOK {
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
		return "", "", "", fmt.Errorf("failed to get roles, HTTP response code: %d", resp.StatusCode)
	}

	// Read response body.
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response: %v", err)
		return "", "", "", err
	}

	var roleResp RoleResponse
	// Unmarshal JSON into the RoleResponse struct.
	if err = json.Unmarshal(bodyBytes, &roleResp); err != nil {
		log.Printf("Error parsing JSON response: %v", err)
		return "", "", "", err
	}

	for _, role := range roleResp.Data.Items {
		switch role.RoleName {
		case "App Admin":
			appAdminId = role.ID
		case "Project Admin":
			projectAdminId = role.ID
		case "Project Viewer":
			projectViewerId = role.ID
		}
	}

	log.Println("Role IDs fetched successfully.")
	return appAdminId, projectAdminId, projectViewerId, nil
}

func sendPostAPIRequest(url string, data map[string]string, authToken string) (map[string]interface{}, error) {
	// Marshal the data into JSON
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		return nil, err
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", url, reqBody, headers)
	if err != nil {
		log.Printf("Error sending API request: %v", err)
		return nil, err
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return nil, err
	}

	var jsonResponse map[string]interface{}
	if err = json.Unmarshal(respBody, &jsonResponse); err != nil {
		log.Printf("Error parsing JSON response: %v", err)
		return nil, err
	}
	return jsonResponse, nil
}

func createAccount(authToken string) (string, error) {
	// var fullURL = os.Getenv("ADMIN_SERVICE_URL") + "/api/v1/accounts"
	// data := map[string]string{
	//  "account_name": os.Getenv("BASE_ACCOUNT_NAME"),
	// }

	// jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	// if err != nil {
	//  log.Printf("Error sending API request: %v", err)
	//  return "", err
	// }
	// accountId, ok := jsonResponse["id"].(string)
	// if !ok {
	//  return "", errors.New("id not found in response in createAccount")
	// }

	// return accountId, nil
	return DEFAULT_ACCOUNT_ID, nil
}

// buildRequestBody builds the JSON payload directly from the YAML "data" field.
// Only keys defined in the YAML data are included; values that start with "$" are replaced
// using sharedVars.
func BuildRequestBody(s parser.Scenario, sharedVars map[string]interface{}) ([]byte, error) {
	// Convert s.Data into a map[string]interface{}.
	converted, ok := ConvertToStringMap(s.Data)
	if !ok {
		return nil, fmt.Errorf("failed to convert scenario Data to map[string]interface{}")
	}
	// Do NOT merge all of sharedVars here. We only need to resolve any variable references within the YAML data.
	resolved := ResolveDataRecursive(converted, sharedVars)
	resolvedMap, ok := resolved.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("error resolving merged data")
	}
	return json.MarshalIndent(resolvedMap, "", "  ")
}

// buildFullURL constructs the full API URL by substituting any URL placeholders (from s.Params)
// with values from sharedVars. Also uses service_name to compute the base URL.
func BuildFullURL(s parser.Scenario, sharedVars map[string]interface{}) string {
	apiPath := s.URL
	for paramKey, paramVal := range s.Params {
		if v, exists := sharedVars[paramVal]; exists {
			apiPath = strings.ReplaceAll(apiPath, "{"+paramKey+"}", fmt.Sprintf("%v", v))
		} else {
			apiPath = strings.ReplaceAll(apiPath, "{"+paramKey+"}", paramVal)
		}
	}
	baseURL := ""

	if s.ServiceName != "" {
		envVar := strings.ToUpper(strings.ReplaceAll(s.ServiceName, "-", "_")) + "_URL"
		if envVal := os.Getenv(envVar); envVal != "" {
			baseURL = envVal
			LogDebug(fmt.Sprintf("Using base URL from env var %s: %s\n", envVar, baseURL))
		} else {
			LogDebug(fmt.Sprintf("Environment variable %s not set. Using default base URL: %s\n", envVar, baseURL))
		}
	}
	return baseURL + apiPath
}

func GetHeaders(authToken, contentType string) map[string]string {
	headers := make(map[string]string)

	headers["Content-Type"] = contentType

	if authToken != "" {
		headers[AuthHeader] = BearerPrefix + authToken
	}

	return headers
}

func GetProjectIdHeader(authToken string, projectId string) map[string]string {
	headers := make(map[string]string)

	headers["Content-Type"] = ContentTypeJSON

	if authToken != "" {
		headers[AuthHeader] = BearerPrefix + authToken
	}

	headers["projectid"] = projectId

	return headers
}

func getOpenbaoHeaders(token string) map[string]string {

	return map[string]string{
		"Content-Type":  ContentTypeForm,
		"X-Vault-Token": token,
	}
}

func GetExtraHeaders(authToken string, extraHeaders map[string]string, sharedVars map[string]interface{}) map[string]string {
	headers := make(map[string]string)

	headers["Content-Type"] = ContentTypeJSON

	if authToken != "" {
		headers[AuthHeader] = BearerPrefix + authToken
	}

	for key, value := range extraHeaders {
		if strings.HasPrefix(value, "$") {
			headers[key] = fmt.Sprintf("%v", ResolveDataRecursive(value, sharedVars))
		} else {
			headers[key] = value
		}
	}

	return headers
}

// sendAPIRequest sends an HTTP request with the JSON payload.
func SendAPIRequest(method, url string, body []byte, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(strings.ToUpper(method), url, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	client := &http.Client{
		Transport: tr,
		Timeout:   60 * time.Second,
	}

	return client.Do(req)
}

// handleResponse validates the response by checking the status code, verifying expected fields,
// and extracting any parsed fields into sharedVars.
func HandleResponse(resp *http.Response, s parser.Scenario, callKey string, sharedVars map[string]interface{}) (map[string]interface{}, error) {
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return sharedVars, err
	}
	responseLog := fmt.Sprintf("Response for '%s' -- Status Code: %d\nResponse Body: %s\n", callKey, resp.StatusCode, string(bodyBytes))
	LogDebug(responseLog)
	if resp.StatusCode == 200 || resp.StatusCode == 201 {
		LogDebug(fmt.Sprintf(">>> API call '%s' succeeded\n", callKey))
	} else {
		LogError(fmt.Sprintf(">>> API call '%s' failed (unexpected status code)\n", callKey), fmt.Errorf("unexpected status code: %d", resp.StatusCode))
	}
	if len(s.Response) > 0 {
		if expectedCode, found := getExpectedStatusCode(s.Response); found {
			if resp.StatusCode != expectedCode {
				return sharedVars, fmt.Errorf("status code mismatch for '%s': expected %d, got %d", callKey, expectedCode, resp.StatusCode)
			}
		} else {
			if resp.StatusCode != 200 && resp.StatusCode != 201 {
				return sharedVars, fmt.Errorf("status code mismatch for '%s': got %d", callKey, resp.StatusCode)
			}
		}
	}
	// Verify additional expected fields in the response.
	var responseMap map[string]interface{}
	if err = json.Unmarshal(bodyBytes, &responseMap); err != nil {
		LogDebug("Response is not valid JSON, skipping field verification.\n")
	} else {
		for _, expected := range s.Response {
			for key, expVal := range expected {
				if key == "status_code" {
					continue
				}
				actualVal, err := extractJSONValue(bodyBytes, key)
				if err != nil {
					return sharedVars, fmt.Errorf("expected field '%s' not found in response for '%s'", key, callKey)
				}
				if fmt.Sprintf("%v", actualVal) != fmt.Sprintf("%v", expVal) {
					return sharedVars, fmt.Errorf("value mismatch for field '%s' in '%s': expected %v, got %v", key, callKey, expVal, actualVal)
				}
			}
		}
	}
	// Extract fields defined in the parse block.
	if s.Parse != nil && len(s.Parse) > 0 {
		for jsonField, targetVar := range s.Parse {
			if jsonField == "" || targetVar == "" {
				continue
			}
			value, err := extractJSONValue(bodyBytes, targetVar)
			if err != nil {
				return sharedVars, fmt.Errorf("error extracting field '%s': %w", jsonField, err)
			}
			sharedVars[jsonField] = value
			LogDebug(fmt.Sprintf("Parsed variable '%s' set to %v from JSON field '%s'\n", targetVar, value, jsonField))
		}
	}
	return sharedVars, nil
}

// extractJSONValue extracts a value from JSON data using a dotted field path.
// It first unmarshals into an empty interface and then walks the path by type asserting maps.
func extractJSONValue(data []byte, fieldPath string) (interface{}, error) {
	var result interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}

	// Regular expression to match a field name and optional indices.
	// For example, it will match "configs", "0" in "configs[0]"
	re := regexp.MustCompile(`([^\[\]]+)|\[(\d+)\]`)

	// Split the field path by dot.
	parts := strings.Split(fieldPath, ".")
	current := result

	for _, part := range parts {
		// Find all field names and indices in the part (e.g., "configs[0]" will become [ "configs", "0" ])
		tokens := re.FindAllStringSubmatch(part, -1)

		for _, token := range tokens {
			// token[1] is non-empty for a field name, token[2] is non-empty for an index.
			if token[1] != "" {
				// Access a field in a map.
				m, ok := current.(map[string]interface{})
				if !ok {
					return nil, fmt.Errorf("expected JSON object when accessing field '%s'", token[1])
				}
				val, exists := m[token[1]]
				if !exists {
					return nil, fmt.Errorf("field '%s' not found in path '%s'", token[1], fieldPath)
				}
				current = val
			} else if token[2] != "" {
				// Access an array index.
				arr, ok := current.([]interface{})
				if !ok {
					return nil, fmt.Errorf("expected JSON array but found different type when accessing index [%s]", token[2])
				}
				index, err := strconv.Atoi(token[2])
				if err != nil {
					return nil, fmt.Errorf("invalid array index '%s': %v", token[2], err)
				}
				if index < 0 || index >= len(arr) {
					return nil, fmt.Errorf("index [%d] out of bounds", index)
				}
				current = arr[index]
			}
		}
	}
	return current, nil
}

// getExpectedStatusCode extracts the expected status code from the response block.
func getExpectedStatusCode(response []map[string]interface{}) (int, bool) {
	for _, m := range response {
		if v, exists := m["status_code"]; exists {
			switch val := v.(type) {
			case int:
				return val, true
			case string:
				if code, err := strconv.Atoi(val); err == nil {
					return code, true
				}
			}
		}
	}
	return 0, false
}

// GetKeycloakAdminCredentials returns KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD.
func GetKeyCloakAdminCredentials() (KeycloakCredentials, error) {
	token, err := getOpenBaoRootToken()
	if err != nil {
		return KeycloakCredentials{}, fmt.Errorf("failed to get OpenBao root token: %w", err)
	}

	if KEYCLOAK_IP == "" {
		return KeycloakCredentials{}, fmt.Errorf("environment variable KEYCLOAK_IP not set")
	}

	url := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, KEYCLOAK_CREDENTIALS_URL)
	headers := getOpenbaoHeaders(token)
	resp, err := SendAPIRequest("GET", url, nil, headers)
	if err != nil {
		return KeycloakCredentials{}, fmt.Errorf("failed to execute HTTP request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return KeycloakCredentials{}, fmt.Errorf("failed to read response body: %w", err)
	}

	type KeycloakResponse struct {
		Data struct {
			AdminUser     string `json:"KEYCLOAK_ADMIN_USER"`
			AdminPassword string `json:"KEYCLOAK_ADMIN_PASSWORD"`
			ClientSecret  string `json:"KEYCLOAK_CLIENT_SECRET"`
		} `json:"data"`
	}

	var kcResp KeycloakResponse
	err = json.Unmarshal(bodyBytes, &kcResp)
	if err != nil {
		return KeycloakCredentials{}, fmt.Errorf("failed to parse JSON response: %w", err)
	}

	if kcResp.Data.AdminUser == "" && kcResp.Data.AdminPassword == "" && kcResp.Data.ClientSecret == "" {
		return KeycloakCredentials{}, fmt.Errorf("keycloak credentials not found in response: %s", string(bodyBytes))
	}

	creds := KeycloakCredentials{
		AdminUser:     kcResp.Data.AdminUser,
		AdminPassword: kcResp.Data.AdminPassword,
		ClientSecret:  kcResp.Data.ClientSecret,
	}

	return creds, nil
}

// UpdateKeycloakTokenLifespan updates the accessTokenLifespan for the datamigrator realm in Keycloak
// lifespanSeconds: token lifespan in seconds (e.g., 1200 for 20 minutes, 86400 for 24 hours)
func UpdateKeycloakTokenLifespan(lifespanSeconds int) error {
    // Validate environment variables
    if NDM_VM_USER_NAME == "" || NDM_VM_HOST == "" || NDM_VM_PORT == "" || NDM_VM_PASSWORD == "" {
        return fmt.Errorf("required CP SSH environment variables are not set")
    }

    // Convert port string to int
    port, err := strconv.Atoi(NDM_VM_PORT)
    if err != nil {
        return fmt.Errorf("invalid NDM_VM_PORT value: %w", err)
    }

    // Create SSH config
    sshConfig := &ssh.ClientConfig{
        User: NDM_VM_USER_NAME,
        Auth: []ssh.AuthMethod{
            ssh.Password(NDM_VM_PASSWORD),
        },
        HostKeyCallback: ssh.InsecureIgnoreHostKey(),
    }

    // Establish SSH connection
    address := fmt.Sprintf("%s:%d", NDM_VM_HOST, port)
    client, err := ssh.Dial("tcp", address, sshConfig)
    if err != nil {
        return fmt.Errorf("failed to dial SSH: %w", err)
    }
    defer client.Close()

    // Create SSH session
    session, err := client.NewSession()
    if err != nil {
        return fmt.Errorf("failed to create SSH session: %w", err)
    }
    defer session.Close()

    // Build the command based on your shell script
    script := fmt.Sprintf(`
KEYCLOAK_POD="keycloak-0"
KEYCLOAK_NS="keycloak"
REALM_NAME="datamigrator"

ADMIN_PASS=$(kubectl get secret -n $KEYCLOAK_NS keycloak-credentials -o jsonpath='{.data.keycloak-admin-password}' | base64 -d)

kubectl exec -n $KEYCLOAK_NS $KEYCLOAK_POD -- bash -c "
TOKEN=\$(curl -sk http://localhost:8080/keycloak/realms/master/protocol/openid-connect/token \
  -d 'username=kcadmin' -d 'password=$ADMIN_PASS' -d 'grant_type=password' -d 'client_id=admin-cli')
ACCESS=\$(echo \"\$TOKEN\" | sed -n 's/.*\"access_token\":\"\([^\"]*\)\".*/\1/p')
CONFIG=\$(curl -sk http://localhost:8080/keycloak/admin/realms/$REALM_NAME -H \"Authorization: Bearer \$ACCESS\")
UPDATED=\$(echo \"\$CONFIG\" | sed 's/\"accessTokenLifespan\":[0-9]*/\"accessTokenLifespan\":%d/')
curl -sk -X PUT http://localhost:8080/keycloak/admin/realms/$REALM_NAME \
  -H \"Authorization: Bearer \$ACCESS\" -H 'Content-Type: application/json' -d \"\$UPDATED\"
"
`, lifespanSeconds)

    // Execute the command
    output, err := session.Output(script)
    if err != nil {
        return fmt.Errorf("failed to update Keycloak token lifespan: %w\nOutput: %s", err, string(output))
    }

    LogDebug(fmt.Sprintf("Keycloak accessTokenLifespan updated to %d seconds. Output: %s", lifespanSeconds, string(output)))
    return nil
}

// getOpenBaoRootToken reads the JSON file from the remote host, parses it, and returns the root token.
func getOpenBaoRootToken() (string, error) {
	type ClusterKeys struct {
		RootToken string `json:"root_token"`
	}

	if NDM_VM_USER_NAME == "" || NDM_VM_HOST == "" || NDM_VM_PORT == "" || NDM_VM_PASSWORD == "" {
		return "", fmt.Errorf("one or more SSH connection environment variables are missing")
	}

	port, err := strconv.Atoi(NDM_VM_PORT)
	if err != nil {
		return "", fmt.Errorf("invalid port value: %w", err)
	}

	sshConfig := &ssh.ClientConfig{
		User: NDM_VM_USER_NAME,
		Auth: []ssh.AuthMethod{
			ssh.Password(NDM_VM_PASSWORD),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	address := fmt.Sprintf("%s:%d", NDM_VM_HOST, port)
	client, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		return "", fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	output, err := session.Output("cat /opt/datamigrator/openbao/cluster-keys.json")
	if err != nil {
		return "", fmt.Errorf("failed to read cluster keys file remotely: %w", err)
	}

	var keys ClusterKeys
	if err := json.Unmarshal(output, &keys); err != nil {
		return "", fmt.Errorf("failed to parse JSON: %w", err)
	}

	if keys.RootToken == "" {
		return "", fmt.Errorf("root token not found in JSON")
	}

	return keys.RootToken, nil
}

func DeleteAllUsers(token string) error {
	listURL := fmt.Sprintf("%s/api/v1/users?limit=1000", ADMIN_SERVICE_URL)
	headers := GetHeaders(token, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", listURL, nil, headers)
	if err != nil {
		return fmt.Errorf("error executing GET request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch users: %s", bodyBytes)
	}

	type User struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	var users []User
	if err := json.Unmarshal(bodyBytes, &users); err != nil {
		return err
	}

	for _, user := range users {
		if user.Email == USERNAME {
			continue
		}
		deleteURL := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, user.ID)
		delResp, err := SendAPIRequest("DELETE", deleteURL, nil, headers)
		if err != nil {
			return fmt.Errorf("error executing DELETE for user %s: %w", user.Email, err)
		}
		delResp.Body.Close()
		if delResp.StatusCode != http.StatusNoContent && delResp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to delete user %s: status %d", user.Email, delResp.StatusCode)
		}
	}

	return nil
}

func DeleteAllUserRoles(token string) error {
	listURL := fmt.Sprintf("%s/api/v1/user-roles?limit=1000", ADMIN_SERVICE_URL)
	headers := GetHeaders(token, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", listURL, nil, headers)
	if err != nil {
		return fmt.Errorf("error executing GET request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading response body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch user roles: status %d, body: %s", resp.StatusCode, bodyBytes)
	}

	type UserRole struct {
		ID   string `json:"id"`
		User struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	var roles []UserRole
	if err := json.Unmarshal(bodyBytes, &roles); err != nil {
		return fmt.Errorf("error unmarshalling response: %w", err)
	}

	for _, role := range roles {
		if role.User.Email == USERNAME {
			continue
		}
		deleteURL := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, role.ID)
		delResp, err := SendAPIRequest("DELETE", deleteURL, nil, headers)
		if err != nil {
			return fmt.Errorf("error executing DELETE for role id %s: %w", role.ID, err)
		}
		delResp.Body.Close()
		if delResp.StatusCode != http.StatusNoContent && delResp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to delete role with id %s: status %d", role.ID, delResp.StatusCode)
		}
	}

	return nil
}

func DeleteAllKeycloakUsers(token string) error {
	listURL := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL)
	headers := GetHeaders(token, ContentTypeJSON)
	resp, err := SendAPIRequest("GET", listURL, nil, headers)
	if err != nil {
		return fmt.Errorf("error executing GET request on Keycloak users: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading response body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch Keycloak users: status %d, body: %s", resp.StatusCode, bodyBytes)
	}

	type User struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	var users []User
	if err := json.Unmarshal(bodyBytes, &users); err != nil {
		return fmt.Errorf("error unmarshalling response: %w", err)
	}

	for _, user := range users {
		if user.Email == USERNAME {
			continue
		}
		deleteURL := fmt.Sprintf("https://%s/%s/%s", KEYCLOAK_IP, KEYCLOAK_BASE_URL, user.ID)
		delResp, err := SendAPIRequest("DELETE", deleteURL, nil, headers)
		if err != nil {
			return fmt.Errorf("error executing DELETE for user %s: %w", user.Email, err)
		}
		delResp.Body.Close()
		if delResp.StatusCode != http.StatusNoContent && delResp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to delete Keycloak user %s: status %d", user.Email, delResp.StatusCode)
		}
	}

	return nil
}

func DeleteUserByID(userID string) error {
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	url := fmt.Sprintf("%s/api/v1/users/%s", ADMIN_SERVICE_URL, userID)
	resp, err := SendAPIRequest("DELETE", url, nil, headers)
	if err != nil {
		return fmt.Errorf("failed to delete user %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
		log.Printf("Successfully deleted user")
		return nil
	}
	return fmt.Errorf("failed to delete user, status: %d", resp.StatusCode)
}

func DeleteUserRolesByIDs(roleIDs []string) error {
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	if len(roleIDs) == 0 {
		return nil // Nothing to delete
	}

	var errors []string
	successCount := 0

	for _, roleID := range roleIDs {
		if roleID == "" {
			continue // Skip empty role IDs
		}

		url := fmt.Sprintf("%s/api/v1/user-roles/%s", ADMIN_SERVICE_URL, roleID)
		resp, err := SendAPIRequest("DELETE", url, nil, headers)
		if err != nil {
			errors = append(errors, fmt.Sprintf("failed to delete user role %s: %v", roleID, err))
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
			log.Print("Successfully deleted user role")
			successCount++
		} else {
			errors = append(errors, fmt.Sprintf("failed to delete user role, status: %d", resp.StatusCode))
		}
	}

	log.Printf("Successfully deleted %d out of %d user roles", successCount, len(roleIDs))

	if len(errors) > 0 {
		return fmt.Errorf("some deletions failed: %s", strings.Join(errors, "; "))
	}

	return nil
}

func DeleteProjectsByIDs(projectIDs []string) error {
	headers := GetHeaders(AuthToken, ContentTypeJSON)
	if len(projectIDs) == 0 {
		return nil // Nothing to delete
	}

	var errors []string
	successCount := 0

	for _, projectID := range projectIDs {
		if projectID == "" {
			continue // Skip empty project IDs
		}

		url := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, projectID)
		resp, err := SendAPIRequest("DELETE", url, nil, headers)
		if err != nil {
			errors = append(errors, fmt.Sprintf("failed to delete project %v", err))
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
			log.Printf("Successfully deleted project")
			successCount++
		} else {
			errors = append(errors, fmt.Sprintf("failed to delete project, status: %d", resp.StatusCode))
		}
	}

	log.Printf("Successfully deleted %d out of %d projects", successCount, len(projectIDs))

	if len(errors) > 0 {
		return fmt.Errorf("some deletions failed: %s", strings.Join(errors, "; "))
	}

	return nil
}

func DeleteKeycloakUser(username string) {
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
}

func CleanupUsers(authToken, keycloakToken string) error {
	if err := DeleteAllKeycloakUsers(keycloakToken); err != nil {
		return fmt.Errorf("failed to delete all Keycloak users: %w", err)
	}
	if err := DeleteAllUserRoles(authToken); err != nil {
		return fmt.Errorf("failed to delete all user roles: %w", err)
	}
	if err := DeleteAllUsers(authToken); err != nil {
		return fmt.Errorf("failed to delete all users: %w", err)
	}
	LogDebug("Cleanup completed successfully.")
	return nil
}

// AutoGenerateProjectName generates a unique project name using a UUID.
func AutoGenerateProjectName(prefix string) string {
	return fmt.Sprintf("%s_project_%s", prefix, uuid.New().String())
}

func Wait(delay int) {
	time.Sleep(time.Duration(delay) * time.Second)
}

// loadEnvFromEnvFile loads environment variables from the .env file.
func loadEnvFromEnvFile() error {
	currentPath, err := os.Getwd()
	if err != nil {
		log.Printf("Error getting current working directory: %v", err)
		return err
	}
	LogDebug(fmt.Sprintf("Current working directory: %s", currentPath))
	envFilePath := "../.env"
	if _, err := os.Stat(envFilePath); os.IsNotExist(err) {
		envFilePath = "../../.env"

		if _, err := os.Stat(envFilePath); os.IsNotExist(err) {
			log.Printf("No .env file found at path: %s", envFilePath)
			return fmt.Errorf("no .env file found at path: %s", envFilePath)
		}

	}
	if err := godotenv.Load(envFilePath); err != nil {
		log.Printf("Error loading .env file: %v", err)
		return err
	}
	return nil
}

func HandleNewLogin(scData parser.Scenario, sharedVars map[string]interface{}) (string, string, error) {
	converted, ok := ConvertToStringMap(scData.Data)
	if !ok {
		return "", "", fmt.Errorf("failed to convert scenario Data to map[string]interface{}")
	}

	resolved := ResolveDataRecursive(converted, sharedVars)
	resolvedMap, ok := resolved.(map[string]interface{})
	if !ok {
		return "", "", fmt.Errorf("failed resolving scenario Data")
	}

	username, usernameOk := resolvedMap["username"].(string)
	password, passwordOk := resolvedMap["password"].(string)
	if !usernameOk || !passwordOk {
		return "", "", fmt.Errorf("username or password is not a string")
	}

	if !strings.HasPrefix(username, "$") {
		sharedVars["username"] = username
	}
	if !strings.HasPrefix(password, "$") {
		sharedVars["password"] = password
	}

	return GetBearerToken(username, password)
}

// handleKeycloakResetPassword processes keycloak-reset-password scenarios by converting data,
// resolving required fields, and resetting user password.
func HandleKeycloakResetPassword(scData parser.Scenario, sharedVars map[string]interface{}, kcUser, kcPassword string) error {
	converted, ok := ConvertToStringMap(scData.Data)
	if !ok {
		return fmt.Errorf("failed to convert scenario Data to map[string]interface{}")
	}

	resolved := ResolveDataRecursive(converted, sharedVars)
	resolvedMap, ok := resolved.(map[string]interface{})
	if !ok {
		return fmt.Errorf("failed resolving scenario Data")
	}

	newPassword, passwordOk := resolvedMap["password"].(string)
	if !passwordOk {
		return fmt.Errorf("new password is not a string")
	}

	userName, usernameOk := resolvedMap["username"].(string)
	if !usernameOk {
		return fmt.Errorf("username is not a string")
	}

	keycloakAuthToken, err := GetKeyCloakAccessToken(kcUser, kcPassword)
	if err != nil {
		return fmt.Errorf("error getting Keycloak Access Token for '%s': %v", scData.Name, err)
	}

	userID, err := FetchUserID(userName, keycloakAuthToken)
	if err != nil {
		return fmt.Errorf("error fetching user ID for '%s': %v", scData.Name, err)
	}

	return ResetUserPassword(userID, keycloakAuthToken, newPassword)
}

func UpdateAppAdmin(keycloakUser, keycloakPassword string) error {
	// Use client credentials grant for admin-cli service account in datamigrator realm
	// This service account has manage-users role configured by post-install job
	tokenUrl := fmt.Sprintf("https://%s/%s", KEYCLOAK_IP, TOKEN_URL)

	data := url.Values{}
	data.Set("client_id", "admin-cli")
	data.Set("client_secret", CLIENT_SECRET)
	data.Set("grant_type", "client_credentials")
	requestBody := data.Encode()

	headers := GetHeaders("", ContentTypeForm)
	resp, err := SendAPIRequest("POST", tokenUrl, []byte(requestBody), headers)
	if err != nil {
		return fmt.Errorf("error getting admin-cli service account token: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to get service account token: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("error reading token response: %v", err)
	}

	var jsonResponse map[string]interface{}
	if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
		return fmt.Errorf("error parsing token response: %v", err)
	}

	keycloakAuthToken, ok := jsonResponse["access_token"].(string)
	if !ok {
		return fmt.Errorf("access_token not found in response")
	}

	userID, err := FetchUserID(USERNAME, keycloakAuthToken)
	if err != nil {
		return fmt.Errorf("error fetching user ID for '%s': %v", USERNAME, err)
	}

	err = ResetUserPassword(userID, keycloakAuthToken, PASSWORD)
	if err != nil {
		return fmt.Errorf("error resetting password for '%s': %v", USERNAME, err)
	}

	err = UpdateUserProfile(userID, keycloakAuthToken)
	if err != nil {
		return fmt.Errorf("error updating profile for '%s': %v", USERNAME, err)
	}

	log.Printf("Successfully updated app admin for '%s'", USERNAME)
	return nil
}

// sshRunScript connects via SSH to a worker and runs the provided script.
func sshRunScript(config SSHConfig, script string) (string, error) {
	sshConfig := &ssh.ClientConfig{
		User: config.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(config.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	address := fmt.Sprintf("%s:%d", config.Host, config.Port)
	client, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		return "", fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	err = session.Run(script)
	if err != nil {
		return "", fmt.Errorf("failed to run script: %w\nstderr: %s", err, stderr.String())
	}

	return stdout.String(), nil
}

func GetCurrentUTCTimestamp() string {
	return time.Now().UTC().Format(TIME_FORMAT)
}

func GetFutureUTCTimestamp(timeInterval int) string {
	return time.Now().UTC().
		Add(time.Duration(timeInterval) * time.Second).
		Format(TIME_FORMAT)
}

func GetVolumesFromArgs(volumes string) []string {
	split := strings.Split(volumes, ",")
	if len(split) == 0 {
		return []string{}
	}

	res := []string{}

	for _, s := range split {
		if PROTOCOL_TYPE == ProtocolNFS {
			res = append(res, fmt.Sprintf("/%s", strings.TrimSpace(s)))
			continue
		}
		res = append(res, strings.TrimSpace(s))
	}

	return res
}

func CreateNewUser(username string, firstname string, lastname string, headers map[string]string) (map[string]interface{}, error) {
	// Prepare user creation payload
	createUserPayload := map[string]interface{}{
		"username":  username,
		"firstName": firstname,
		"lastName":  lastname,
	}
	payloadBytes, err := json.Marshal(createUserPayload)
	if err != nil {
		return nil, fmt.Errorf("error marshalling user creation payload: %w", err)
	}
	createUserURL := fmt.Sprintf("%s/api/v1/create-user", ADMIN_SERVICE_URL)
	resp, err := SendAPIRequest("POST", createUserURL, payloadBytes, headers)
	if err != nil {
		return nil, fmt.Errorf("error sending create user API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("expected HTTP 200 OK, got %d", resp.StatusCode)
	}

	// Parse response to extract user data
	var responseData map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&responseData)
	if err != nil {
		return nil, fmt.Errorf("error while decoding user response: %w", err)
	}

	data := responseData["data"].(map[string]interface{})
	items := data["items"].(map[string]interface{})
	user := items["user"].(map[string]interface{})
	return user, nil
}

func CreateUserRole(projectId, accountId, userId, roleId string, headers map[string]string) (map[string]interface{}, error) {
	// Prepare user role assignment payload
	createRolePayload := map[string]interface{}{
		"project_id": projectId,
		"account_id": accountId,
		"user_id":    userId,
		"role_id":    roleId,
	}

	payloadBytes, err := json.Marshal(createRolePayload)
	if err != nil {
		return nil, fmt.Errorf("error marshalling user role payload: %w", err)
	}

	createRoleURL := fmt.Sprintf("%s/api/v1/user-roles", ADMIN_SERVICE_URL)
	resp, err := SendAPIRequest("POST", createRoleURL, payloadBytes, headers)
	if err != nil {
		return nil, fmt.Errorf("error sending create user role API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("expected HTTP 200 OK, got %d", resp.StatusCode)
	}

	// Parse response to extract role data
	var responseData map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&responseData)
	if err != nil {
		return nil, fmt.Errorf("error decoding response: %w", err)
	}

	data := responseData["data"].(map[string]interface{})
	return data, nil
}

// Helper function to unmarshal any API response with data.items structure
func UnmarshalApiResponse[T any](data []byte) (*ApiResponse[T], error) {
	var resp ApiResponse[T]
	err := json.Unmarshal(data, &resp)
	return &resp, err
}

// UnmarshalJSON implements custom unmarshaling for FlexibleItems
// It can handle both single objects and arrays
func (f *FlexibleItems[T]) UnmarshalJSON(data []byte) error {
	// Try to unmarshal as an array first
	var items []T
	if err := json.Unmarshal(data, &items); err == nil {
		*f = FlexibleItems[T](items)
		return nil
	}

	// If that fails, try to unmarshal as a single object
	var item T
	if err := json.Unmarshal(data, &item); err == nil {
		*f = FlexibleItems[T]([]T{item})
		return nil
	}

	// If both fail, return the array unmarshaling error
	return json.Unmarshal(data, &items)
}

func GetCPVersion() (string, error) {
	script := "grep '^current_version=' /opt/datamigrator/conf/versions.conf | cut -d'=' -f2 | xargs echo -n "
	port, err := strconv.Atoi(NDM_VM_PORT)
	if err != nil {
		LogFatalf("Invalid port number in NDM_VM_PORT: %v", err)
	}
	sshConfig := SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     NDM_VM_HOST,
		Port:     port,
		Password: NDM_VM_PASSWORD,
	}
	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return "", fmt.Errorf("get cp version failed: %v\noutput: %s", err, output)
	}

	return output, nil
}

func GetWorkerVersion() (string, error) {
	config := GetAttachedWorkerDetails()

	var script string
	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = `powershell -Command "(Get-Content 'C:\datamigrator\conf\versions.conf' | Where-Object { $_ -match '^current_version=' }) -replace '^current_version=' | Write-Host -NoNewline"`
	case ProtocolNFS:
		script = "grep '^current_version=' /opt/datamigrator/conf/versions.conf | cut -d'=' -f2 | xargs echo -n "
	}

	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return "", fmt.Errorf("get worker version failed: %v\noutput: %s", err, output)
	}

	return output, nil
}

// get versions from NDM app
func GetVersions(headers map[string]string) (abouNDMResp AboutNDMResponse, err error) {
	var gotWorkerVersion string
	aboutNDMURL := CONFIG_SERVICE_URL + ABOUT_NDM_URL
	for i := 0; i < MaxPollRetries; i++ {
		Wait(1)
		resp, err := SendAPIRequest(http.MethodGet, aboutNDMURL, nil, headers)
		if err != nil {
			return abouNDMResp, fmt.Errorf("get worker version failed: %v", err)
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return abouNDMResp, fmt.Errorf("unable to read body %v", err)
		}

		err = json.Unmarshal(bodyBytes, &abouNDMResp)
		if err != nil {
			return abouNDMResp, fmt.Errorf("unable unmarshal resp %v", err)
		}

		gotWorkerVersion = abouNDMResp.Data.Items.Build.WorkerVersion.Version
		resp.Body.Close()

		if gotWorkerVersion != "N/A" && gotWorkerVersion != "" {
			break
		}
	}

	return abouNDMResp, nil
}
