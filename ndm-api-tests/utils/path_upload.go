package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type UploadFileResponse struct {
	UploadId               string `json:"uploadId"`
	Message                string `json:"message"`
	NewPaths               int    `json:"newPaths"`
	AlreadyExitingPaths    int    `json:"alreadyExitingPaths"`
	NoLongerAvailablePaths int    `json:"noLongerAvailablePaths"`
}

// UploadFile uploads a file to the specified URL with the given headers.
func UploadPathFile(fileServerId string, fileContent FileContent, headers map[string]string) (*http.Response, UploadFileResponse, error) {
	fullURL := fmt.Sprintf("%s/api/v1/paths-upload/%s", CONFIG_SERVICE_URL, fileServerId)

	payloadBytes, err := json.Marshal(fileContent)
	if err != nil {
		return nil, UploadFileResponse{}, err
	}

	resp, err := SendAPIRequest(http.MethodPost, fullURL, payloadBytes, headers)

	if err != nil {
		return nil, UploadFileResponse{}, fmt.Errorf("error sending API request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, UploadFileResponse{}, fmt.Errorf("error reading response body: %w", err)
	}

	var response PathFileUploadStats
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return nil, UploadFileResponse{}, fmt.Errorf("error un-marshalling response: %w", err)
	}

	if response.Error.Message != "" {
		return resp, UploadFileResponse{Message: response.Error.Message}, nil
	}

	uploadFileResp := UploadFileResponse{
		UploadId:               response.Data.Items.UploadId,
		NewPaths:               response.Data.Items.NewPaths,
		AlreadyExitingPaths:    response.Data.Items.AlreadyExitingPaths,
		NoLongerAvailablePaths: response.Data.Items.NoLongerAvailablePaths,
		Message:                response.Data.Items.Message,
	}

	return resp, uploadFileResp, nil
}

// Confirm PathFileUpload confirms the upload of a path file by checking the response status code and the upload statistics.
func ConfirmPathFileUpload(UploadId string, headers map[string]string) (*http.Response, ConfirmPathFileUploadResponseItems, error) {
	fullURL := fmt.Sprintf("%s/api/v1/paths-upload/confirm/%s", CONFIG_SERVICE_URL, UploadId)

	resp, err := SendAPIRequest(http.MethodPost, fullURL, nil, headers)
	if err != nil {
		return nil, ConfirmPathFileUploadResponseItems{}, fmt.Errorf("error sending confirm API request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, ConfirmPathFileUploadResponseItems{}, fmt.Errorf("error reading response body: %w", err)
	}

	var response ConfirmPathFileUploadResponse
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return nil, ConfirmPathFileUploadResponseItems{}, fmt.Errorf("error un-marshalling response: %w", err)
	}
	return resp, response.Data.Items, nil
}
