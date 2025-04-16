package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"ndm-api-tests/internal/scenario"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

var isDebug = true

const (
	ContentTypeJSON = "application/json"
	AuthHeader      = "Authorization"
	BearerPrefix    = "Bearer "
)

// Logging helper functions.
func logDebug(msg string) {
	if isDebug {
		log.Print("[DEBUG] " + msg)
	}
}

func logError(msg string) {
	log.Print("[ERROR] " + msg)
}

// getBearerToken retrieves a bearer token using provided credentials or environment variables.
func GetBearerToken(userN, pass string) string {
	if err := godotenv.Load("../.env"); err != nil {
		log.Printf("Warning: could not load .env file: %v", err)
	} else {
		log.Println("Successfully loaded .env file")
	}
	log.Println("Fetching bearer token...")
	tokenUrl := os.Getenv("TOKEN_URL")
	clientId := os.Getenv("CLIENT_ID")
	clientSecret := os.Getenv("CLIENT_SECRET")
	defaultUsername := os.Getenv("USERNAME")
	defaultPassword := os.Getenv("PASSWORD")
	grantType := os.Getenv("GRANT_TYPE")
	username := strings.TrimSpace(userN)
	if username == "" {
		username = strings.TrimSpace(defaultUsername)
	}
	password := strings.TrimSpace(pass)
	if password == "" {
		password = strings.TrimSpace(defaultPassword)
	}
	data := url.Values{}
	data.Set("client_id", clientId)
	data.Set("client_secret", clientSecret)
	data.Set("grant_type", grantType)
	data.Set("username", username)
	data.Set("password", password)
	requestBody := data.Encode()
	req, err := http.NewRequest("POST", tokenUrl, bytes.NewBufferString(requestBody))
	if err != nil {
		log.Printf("Error creating request: %v", err)
		return ""
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return ""
		}
		var jsonResponse map[string]interface{}
		if err = json.Unmarshal(bodyBytes, &jsonResponse); err != nil {
			log.Printf("Error parsing JSON response: %v", err)
			return ""
		}
		accessToken, ok := jsonResponse["access_token"].(string)
		if !ok {
			log.Printf("access_token not found in response")
			return ""
		}
		log.Printf("Access Token: Fetched")
		return accessToken
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
	}
	return ""
}

// buildRequestBody builds the JSON payload directly from the YAML "data" field.
// Only keys defined in the YAML data are included; values that start with "$" are replaced
// using sharedVars.
func BuildRequestBody(s scenario.Scenario, sharedVars map[string]interface{}) ([]byte, error) {
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
func BuildFullURL(s scenario.Scenario, sharedVars map[string]interface{}) string {
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
			logDebug(fmt.Sprintf("Using base URL from env var %s: %s\n", envVar, baseURL))
		} else {
			logDebug(fmt.Sprintf("Environment variable %s not set. Using default base URL: %s\n", envVar, baseURL))
		}
	}
	return baseURL + apiPath
}

// sendAPIRequest sends an HTTP request with the JSON payload.
func SendAPIRequest(method, url string, body []byte, authToken string) (*http.Response, error) {
	req, err := http.NewRequest(strings.ToUpper(method), url, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", ContentTypeJSON)
	req.Header.Set(AuthHeader, BearerPrefix+authToken)

	logDebug(fmt.Sprintf("Sending Request: %s %s\nPayload:\n%s\n", req.Method, url, string(body)))
	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

// handleResponse validates the response by checking the status code, verifying expected fields,
// and extracting any parsed fields into sharedVars.
func HandleResponse(resp *http.Response, s scenario.Scenario, callKey string, sharedVars map[string]interface{}) error {
	defer resp.Body.Close()
	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	responseLog := fmt.Sprintf("Response for '%s' -- Status Code: %d\nResponse Body: %s\n", callKey, resp.StatusCode, string(bodyBytes))
	logDebug(responseLog)
	if resp.StatusCode == 200 || resp.StatusCode == 201 {
		logDebug(fmt.Sprintf(">>> API call '%s' succeeded\n", callKey))
	} else {
		logError(fmt.Sprintf(">>> API call '%s' failed (unexpected status code)\n", callKey))
	}
	if len(s.Response) > 0 {
		if expectedCode, found := getExpectedStatusCode(s.Response); found {
			if resp.StatusCode != expectedCode {
				return fmt.Errorf("status code mismatch for '%s': expected %d, got %d", callKey, expectedCode, resp.StatusCode)
			}
		} else {
			if resp.StatusCode != 200 && resp.StatusCode != 201 {
				return fmt.Errorf("status code mismatch for '%s': got %d", callKey, resp.StatusCode)
			}
		}
	}
	// Verify additional expected fields in the response.
	var responseMap map[string]interface{}
	if err = json.Unmarshal(bodyBytes, &responseMap); err != nil {
		logDebug("Response is not valid JSON, skipping field verification.\n")
	} else {
		for _, expected := range s.Response {
			for key, expVal := range expected {
				if key == "status_code" {
					continue
				}
				actualVal, err := extractJSONValue(bodyBytes, key)
				if err != nil {
					return fmt.Errorf("expected field '%s' not found in response for '%s'", key, callKey)
				}
				if fmt.Sprintf("%v", actualVal) != fmt.Sprintf("%v", expVal) {
					return fmt.Errorf("value mismatch for field '%s' in '%s': expected %v, got %v", key, callKey, expVal, actualVal)
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
				return fmt.Errorf("error extracting field '%s': %w", jsonField, err)
			}
			sharedVars[targetVar] = value
			logDebug(fmt.Sprintf("Parsed variable '%s' set to %v from JSON field '%s'\n", targetVar, value, jsonField))
		}
	}
	return nil
}

// extractJSONValue extracts a value from JSON data using a dotted field path.
// It first unmarshals into an empty interface and then walks the path by type asserting maps.
func extractJSONValue(data []byte, fieldPath string) (interface{}, error) {
	var result interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	// Split the field path by dot.
	parts := strings.Split(fieldPath, ".")
	current := result
	for _, part := range parts {
		// Assert that the current value is a map.
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("cannot access field '%s'; unexpected type", part)
		}
		// Lookup the next part.
		val, exists := m[part]
		if !exists {
			return nil, fmt.Errorf("field '%s' not found", fieldPath)
		}
		current = val
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
