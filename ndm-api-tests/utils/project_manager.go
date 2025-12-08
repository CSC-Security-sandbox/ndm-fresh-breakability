package utils

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

var ProjectID string

// createProject creates a project using the API and stores the project ID globally.
func CreateProject(authToken string, accountId string) (string, string, error) {
	fullURL := ADMIN_SERVICE_URL + "/api/v1/projects"
	projectName := AutoGenerateProjectName("test")
	data := map[string]string{
		"account_id":          accountId,
		"project_name":        projectName,
		"project_description": "Project For Automation testing",
		"start_date":          time.Now().UTC().Format(time.RFC3339),
	}

	jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	if err != nil {
		log.Printf("error while sending API request: %v", err)
		return "", "", err
	}

	dataMap, ok := jsonResponse["data"].(map[string]interface{})
	if !ok {
		return "", "", fmt.Errorf("data not found in response in createProject")
	}
	projectID, ok := dataMap["id"].(string)
	if !ok {
		return "", "", fmt.Errorf("id not found in response in createProject")
	}

	// Store the project ID globally.
	ProjectID = projectID

	return ProjectID, projectName, nil
}

// deleteProject deletes the project using the globally stored ProjectID.
func deleteProject(authToken string) error {
	fullURL := fmt.Sprintf("%s/api/v1/projects/%s", ADMIN_SERVICE_URL, ProjectID)

	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("DELETE", fullURL, nil, headers)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to delete project, status code: %d", resp.StatusCode)
	}

	return nil
}
