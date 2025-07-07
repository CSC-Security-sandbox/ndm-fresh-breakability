package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type PathFileUploadStats struct {
	UploadId               string `json:"uploadId"`
	Message                string `json:"message"`
	NewPaths               int    `json:"newPaths"`
	AlreadyExistingPaths   int    `json:"alreadyExitingPaths"`
	NoLongerAvailablePaths int    `json:"noLongerAvailablePaths"`
}

type ConfirmPathFileUploadResponse struct {
	Message    string `json:"message"`
	WorkflowId string `json:"workflowId"`
}

type FileContent struct {
	FileName string `json:"fileName"`
	Contents string `json:"contents"`
	FileSize int    `json:"fileSize"`
}

// UploadFile uploads a file to the specified URL with the given headers.
func UploadPathFile(fileServerId string, fileContent FileContent, headers map[string]string) (*http.Response, PathFileUploadStats, error) {
	fullURL := fmt.Sprintf("%s/api/v1/paths-upload/%s", CONFIG_SERVICE_URL, fileServerId)

	payloadBytes, err := json.Marshal(fileContent)
	if err != nil {
		return nil, PathFileUploadStats{}, err
	}

	resp, err := SendAPIRequest(http.MethodPost, fullURL, payloadBytes, headers)

	if err != nil {
		return nil, PathFileUploadStats{}, fmt.Errorf("error sending API request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, PathFileUploadStats{}, fmt.Errorf("error reading response body: %w", err)
	}

	var response PathFileUploadStats
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return nil, PathFileUploadStats{}, fmt.Errorf("error un-marshalling response: %w", err)
	}
	return resp, response, nil
}

// Confirm PathFileUpload confirms the upload of a path file by checking the response status code and the upload statistics.
func ConfirmPathFileUpload(UploadId string, headers map[string]string) (*http.Response, ConfirmPathFileUploadResponse, error) {
	fullURL := fmt.Sprintf("%s/api/v1/paths-upload/confirm/%s", CONFIG_SERVICE_URL, UploadId)

	resp, err := SendAPIRequest(http.MethodPost, fullURL, nil, headers)
	if err != nil {
		return nil, ConfirmPathFileUploadResponse{}, fmt.Errorf("error sending confirm API request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, ConfirmPathFileUploadResponse{}, fmt.Errorf("error reading response body: %w", err)
	}

	var response ConfirmPathFileUploadResponse
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return nil, ConfirmPathFileUploadResponse{}, fmt.Errorf("error un-marshalling response: %w", err)
	}
	return resp, response, nil
}
