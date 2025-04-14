package tests

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"text/template"
	"time"

	"ndm-api-tests/internal/scenario"

	"testing"

	"github.com/joho/godotenv"
	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var (
	isDebug = true

	scenarioPath = filepath.Join("..", "resources", "scenarios")
	// scenarioFiles contains YAML files (each representing a scenario).
	// Each YAML file may have multiple API calls.
	scenarioFiles = []string{
		filepath.Join(scenarioPath, "accounts.yml"),
		// filepath.Join(scenarioPath, "auth.yml"),
		// filepath.Join(scenarioPath, "config-service-destination.yml"),
	}

	// Default baseURL and authToken for all API calls.
	// If a service name is provided within an API call, we try to pick the service's URL from the environment.
	defaultBaseURL = "http://localhost:3001"
	authToken      = getBearerToken("admin@datamigrator.local", "welcome")
	// sharedVars holds values parsed from responses within one scenario.
	sharedVars map[string]interface{}

	// varRe converts velocity-style variables (e.g. "$username") to Go template syntax.
	varRe = regexp.MustCompile(`\$([a-zA-Z0-9_]+)`)
)

// Logging helper functions using standard log package
func logDebug(msg string) {
	if isDebug {
		log.Print("[DEBUG] " + msg)
		GinkgoWriter.Write([]byte("[DEBUG] " + msg))
	}
}

func logError(msg string) {
	log.Print("[ERROR] " + msg)
	GinkgoWriter.Write([]byte("[ERROR] " + msg))
}

// extractJSONValue extracts a value from JSON data given a dotted field path (e.g., "user.id").
func extractJSONValue(data []byte, fieldPath string) (interface{}, error) {
	var jsonMap map[string]interface{}
	err := json.Unmarshal(data, &jsonMap)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(fieldPath, ".")
	cur := jsonMap
	for i, part := range parts {
		if i == len(parts)-1 {
			return cur[part], nil
		}
		if next, ok := cur[part].(map[string]interface{}); ok {
			cur = next
		} else {
			return nil, fmt.Errorf("field '%s' not found", fieldPath)
		}
	}
	return nil, fmt.Errorf("field '%s' not found", fieldPath)
}

// getExpectedStatusCode extracts the expected status code from the scenario's Response block.
func getExpectedStatusCode(response []interface{}) (int, bool) {
	for _, item := range response {
		if m, ok := item.(map[interface{}]interface{}); ok {
			for k, v := range m {
				if ks, ok := k.(string); ok && ks == "status_code" {
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
		}
	}
	return 0, false
}

// buildFullURL constructs the full API URL. It uses the service_name field from the scenario
// to determine the base URL. Specifically, if service_name is provided, it converts it to upper-case,
// replaces hyphens with underscores, appends "_URL", and then looks for this environment variable.
// If found, its value is used; otherwise the defaultBaseURL is used.
func buildFullURL(scData scenario.Scenario, sharedVars map[string]interface{}) string {
	// Replace any URL parameters:
	apiPath := scData.URL
	for paramKey, paramVal := range scData.Params {
		if v, exists := sharedVars[paramVal]; exists {
			apiPath = strings.ReplaceAll(apiPath, "{"+paramKey+"}", fmt.Sprintf("%v", v))
		} else {
			apiPath = strings.ReplaceAll(apiPath, "{"+paramKey+"}", paramVal)
		}
	}
	// Determine base URL based on service_name.
	baseURL := defaultBaseURL
	if scData.ServiceName != "" {
		// Convert service_name to environment variable name, e.g. "admin_service" -> "ADMIN_SERVICE_URL"
		envVar := strings.ToUpper(strings.ReplaceAll(scData.ServiceName, "-", "_")) + "_URL"
		if envVal := os.Getenv(envVar); envVal != "" {
			baseURL = envVal
			logDebug(fmt.Sprintf("Using base URL from env var %s: %s\n", envVar, baseURL))
		} else {
			logDebug(fmt.Sprintf("Environment variable %s not set. Using default base URL: %s\n", envVar, baseURL))
		}
	}
	return baseURL + apiPath
}

// processTemplate loads a template file using the API call key, converts velocity-style variables
// to Go template syntax, and executes it with merged data (sharedVars and scenario-specific Data).
func processTemplate(callKey string, scData scenario.Scenario, sharedVars map[string]interface{}) ([]byte, error) {
	templatePath := filepath.Join("..", "resources", "templates", callKey+"-template.vm")
	tmplBytes, err := ioutil.ReadFile(templatePath)
	if err != nil {
		return nil, fmt.Errorf("could not read template %s: %w", templatePath, err)
	}
	goTemplateString := varRe.ReplaceAllString(string(tmplBytes), "{{.$1}}")
	tmpl, err := template.New("req").Parse(goTemplateString)
	if err != nil {
		return nil, fmt.Errorf("error parsing template: %w", err)
	}
	fmt.Printf(" fbsndkldsm;dma; %s", sharedVars)
	// Merge sharedVars with scenario-specific Data.
	mergedData := make(map[string]interface{})
	for k, v := range sharedVars {
		fmt.Printf("sharedVars  key: %s, value: %v\n", k, v)
		mergedData[k] = v
	}
	for k, v := range scData.Data {
		fmt.Printf("Data  key: %s, value: %v\n", k, v)

		mergedData[k] = v
	}
	var buf bytes.Buffer
	err = tmpl.Execute(&buf, mergedData)
	if err != nil {
		return nil, fmt.Errorf("error executing template: %w", err)
	}
	return buf.Bytes(), nil
}

// sendAPIRequest creates and sends an HTTP request and returns its response.
func sendAPIRequest(method, url string, body []byte) (*http.Response, error) {
	req, err := http.NewRequest(strings.ToUpper(method), url, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+authToken)
	logDebug(fmt.Sprintf("Sending Request: %s %s\n", req.Method, url))
	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

// handleResponse logs the response, checks for expected status codes,
// and extracts any values as defined in the parse block.
func handleResponse(resp *http.Response, scData scenario.Scenario, callKey string) error {
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

	if len(scData.Response) > 0 {
		if expectedCode, found := getExpectedStatusCode(scData.Response); found {
			if resp.StatusCode != expectedCode {
				return fmt.Errorf("status code mismatch for '%s': expected %d, got %d", callKey, expectedCode, resp.StatusCode)
			}
		} else {
			if resp.StatusCode != 200 && resp.StatusCode != 201 {
				return fmt.Errorf("status code mismatch for '%s': got %d", callKey, resp.StatusCode)
			}
		}
	}

	// Extract and store values from the parse block.
	if scData.Parse != nil && len(scData.Parse) > 0 {
		for jsonField, varName := range scData.Parse {
			if jsonField == "" || varName == "" {
				continue
			}
			value, err := extractJSONValue(bodyBytes, varName)
			if err != nil {
				return fmt.Errorf("error extracting field '%s': %w", jsonField, err)
			}
			sharedVars[jsonField] = value
			logDebug(fmt.Sprintf("Parsed variable '%s' set to %v from JSON field '%s'\n", varName, value, jsonField))
		}
	}
	return nil
}

// delayBetweenCalls pauses execution between API calls.
func delayBetweenCalls(delay int) {
	time.Sleep(time.Duration(delay) * time.Second)
}

// getBearerToken retrieves an access token using the provided username and password.
// If userN or pass are empty, they are pulled from environment variables.
func getBearerToken(userN, pass string) string {
	// Load environment variables (optional, if you use a .env file)
	if err := godotenv.Load("../.env"); err != nil {
		log.Printf("Warning: no .env file found or error reading it: %v", err)
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

	// Use passed username/password if provided; otherwise use env variables.
	username := strings.TrimSpace(userN)
	if username == "" {
		username = strings.TrimSpace(defaultUsername)
	}
	password := strings.TrimSpace(pass)
	if password == "" {
		password = strings.TrimSpace(defaultPassword)
	}

	// Build a URL-encoded form data payload.
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

	// Execute the request.
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error executing request: %v", err)
		return ""
	}
	defer resp.Body.Close()

	// Check HTTP status code.
	if resp.StatusCode == http.StatusOK {
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading response: %v", err)
			return ""
		}

		// Parse JSON response.
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

		log.Printf("Access Token: Fetched.....")
		return accessToken
	} else {
		log.Printf("Failed to get token, HTTP response code: %d", resp.StatusCode)
		// Read error stream if available.
		errorBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Error reading error response: %v", err)
		} else {
			log.Printf("Error Response: %s", string(errorBytes))
		}
	}

	return ""
}

// TestAPIScenarios is the main entry point for Ginkgo tests.
func TestAPIScenarios(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "API Scenarios Suite")
}

// Main Describe block: for each YAML file, we execute all API calls sequentially.
var _ = Describe("API Scenarios (Sequential from YAML Files)", func() {

	for _, filePath := range scenarioFiles {
		fp := filePath // capture file path variable
		It(fmt.Sprintf("should execute scenario from file: %s", filepath.Base(fp)), func() {
			// Initialize sharedVars with default values.
			sharedVars = map[string]interface{}{
				"account_id": "048e2ea8-d751-48a1-8deb-727d30f0be5d",
				"projectId":  "15bcd258-23c7-4773-a8e3-92694fe50729",
				"workerId":   "7c8877e6-df9b-414b-bf1d-e8d8c3d78cad",
			}

			scenarios, err := scenario.ParseScenarios(fp)
			Expect(err).To(BeNil(), "Failed to parse scenario file: %s", fp)

			for callKey, scData := range scenarios {
				By(fmt.Sprintf("Executing API call: %s", callKey))
				delayStr := scData.Delay
				if delayStr != "" {
					delay, err := strconv.Atoi(delayStr)
					Expect(err).To(BeNil(), "Error converting delay to integer for '%s'", callKey)
					delayBetweenCalls(delay)
				}

				fullURL := buildFullURL(scData, sharedVars)
				logDebug(fmt.Sprintf("Request URL: %s\nHTTP Method: %s\n", fullURL, strings.ToUpper(scData.Method)))

				var reqBody []byte
				if strings.ToLower(scData.Method) == "post" || strings.ToLower(scData.Method) == "put" || strings.ToLower(scData.Method) == "patch" {
					reqBody, err = processTemplate(callKey, scData, sharedVars)
					Expect(err).To(BeNil(), "Error processing template for '%s'", callKey)
					logDebug(fmt.Sprintf("Constructed Request Body: %s\n", string(reqBody)))
				} else {
					logDebug("No request body for this HTTP method\n")
				}

				resp, err := sendAPIRequest(scData.Method, fullURL, reqBody)
				Expect(err).To(BeNil(), "Error sending API request for '%s'", callKey)
				err = handleResponse(resp, scData, callKey)
				Expect(err).To(BeNil(), "Error handling response for '%s'", callKey)

			}
		})
	}
})
