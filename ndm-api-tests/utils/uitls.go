package utils

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"ndm-api-tests/internal/scenario"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/joho/godotenv"
)

var isDebug = true
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
func GetBearerToken(userN, pass string) (string, error) {
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
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Transport: tr}
	resp, err := client.Do(req)
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
			return "", err
		}
		log.Printf("Access Token: Fetched")
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

// SSHRunScript connects to a VM via SSH and runs the given script.
func SSHRunScript(config SSHConfig, script string) (string, error) {

	// Create the SSH client configuration
	sshConfig := &ssh.ClientConfig{
		User: config.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(config.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // NOTE: Use a proper host key callback in production
	}

	// Connect to the SSH server
	address := fmt.Sprintf("%s:%d", config.Host, config.Port)
	client, err := ssh.Dial("tcp", address, sshConfig)
	if err != nil {
		return "", fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	defer client.Close()

	// Create a session
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Run the script
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	err = session.Run(script)
	if err != nil {
		return "", fmt.Errorf("failed to run script: %w\nstderr: %s", err, stderr.String())
	}

	return stdout.String(), nil
}

// Example function to create the script
func CreateWorkerScript(resp *http.Response) (string, string, error) {
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return "", "", err
	}
	// Define a struct to parse the response
	type WorkerResponse struct {
		WorkerId       string `json:"workerId"`
		WorkerSecret   string `json:"workerSecret"`
		ControlPlaneIp string `json:"controlPlaneIp"`
	}

	// Parse the JSON response
	var workerResp WorkerResponse
	err = json.Unmarshal(respBody, &workerResp)
	if err != nil {
		return "", "", fmt.Errorf("error parsing response: %w", err)
	}

	// Construct the script
	script := fmt.Sprintf(`
	sudo su -c '
    export WORKER_ID=%s
    export WORKER_SECRET=%s
    export CONTROL_PLANE_IP=%s
    sh /opt/datamigrator/bin/worker_register.sh
	'
    `, workerResp.WorkerId, workerResp.WorkerSecret, workerResp.ControlPlaneIp)

	return script, workerResp.WorkerId, nil
}

func sendPostAPIRequest(url string, data map[string]string, authToken string) (map[string]interface{}, error) {
	// Marshal the data into JSON
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		return nil, err
	}
	resp, err := SendAPIRequest("post", url, reqBody, authToken)
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
	// 	"account_name": os.Getenv("BASE_ACCOUNT_NAME"),
	// }

	// jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	// if err != nil {
	// 	log.Printf("Error sending API request: %v", err)
	// 	return "", err
	// }
	// accountId, ok := jsonResponse["id"].(string)
	// if !ok {
	// 	return "", errors.New("id not found in response in createAccount")
	// }

	// return accountId, nil
	return os.Getenv("DEFFAULT_ACCOUNT_ID"), nil
}

func createProject(authToken string, account_id string) (string, error) {
	var fullURL = os.Getenv("ADMIN_SERVICE_URL") + "/api/v1/projects"
	data := map[string]string{
		"account_id":          account_id,
		"project_name":        os.Getenv("BASE_PROJECT_NAME"),
		"project_description": os.Getenv("BASE_PROJECT_DESCRIPTION"),
		"start_date":          os.Getenv("BASE_PROJECT_START_DATE"),
	}

	jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	if err != nil {
		log.Printf("error while sending API request: %v", err)
		return "", err
	}
	projectId, ok := jsonResponse["id"].(string)
	if !ok {
		return "", errors.New("id not found in response in createProject")
	}

	return projectId, nil
}

func AttachWorker(authToken string) (string, string, string, error) {
	port, err := strconv.Atoi(os.Getenv("NDM_VM_PORT"))
	if err != nil {
		log.Printf("Invalid port value: %v", err)
		return "", "", "", err
	}
	config := SSHConfig{
		Username: os.Getenv("NDM_VM_USER_NAME"),
		Host:     os.Getenv("NDM_VM_HOST"),
		Port:     port,
		Password: os.Getenv("NDM_VM_PASSWORD"),
	}
	accountId, err := createAccount(authToken)
	if err != nil {
		log.Printf("Error creating account: %v", err)
		return accountId, "", "", err
	}
	projectId, err := createProject(authToken, accountId)
	if err != nil {
		log.Printf("Error creating Project: %v", err)
		return accountId, projectId, "", err
	}
	var fullURL = os.Getenv("CONFIG_SERVICE_URL") + "/api/v1/worker-registration"
	data := map[string]string{
		"projectId": projectId,
	}

	// Marshal the data into JSON
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		return accountId, projectId, "", err

	}
	resp, err := SendAPIRequest("post", fullURL, reqBody, authToken)
	if err != nil {
		log.Printf("Error sending API request: %v", err)
		return accountId, projectId, "", err
	}

	script, workerId, err := CreateWorkerScript(resp)
	if err != nil {
		log.Printf("Error creating the script: %v", err)
		return accountId, projectId, workerId, err
	}
	fmt.Printf("Running scripts: %s ", script)

	// Run the script
	output, err := SSHRunScript(config, script)
	if err != nil {
		log.Printf("Error running script: %v", err)
		return accountId, projectId, workerId, err
	}

	// Print the output
	fmt.Println("Script Output:")
	fmt.Println(output)
	return accountId, projectId, workerId, nil
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
	client := &http.Client{
		Transport: tr,
		Timeout:   10 * time.Second,
	}
	return client.Do(req)
}

// handleResponse validates the response by checking the status code, verifying expected fields,
// and extracting any parsed fields into sharedVars.
func HandleResponse(resp *http.Response, s scenario.Scenario, callKey string, sharedVars map[string]interface{}) (map[string]interface{}, error) {
	defer resp.Body.Close()
	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return sharedVars, err
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
		logDebug("Response is not valid JSON, skipping field verification.\n")
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
			logDebug(fmt.Sprintf("Parsed variable '%s' set to %v from JSON field '%s'\n", targetVar, value, jsonField))
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
