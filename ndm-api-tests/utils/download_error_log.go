package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

func GenerateCsvFile(idType string, id string, headers map[string]string) (string, error) {
	generateURL := fmt.Sprintf("%s/api/v1/report/job-run/generate-error-csv/%s/%s", REPORT_SERVICE_URL, idType, id)
	resp, err := SendAPIRequest("GET", generateURL, nil, headers)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Read the response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Check if this is an error response (4xx or 5xx status codes)
	if resp.StatusCode >= 400 {
		var errorResponse ErrorResponse
		if err := json.Unmarshal(bodyBytes, &errorResponse); err != nil {
			return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(bodyBytes))
		}
		// Use displayMessage if available, otherwise fall back to message
		errorMsg := errorResponse.DisplayMessage
		if errorMsg == "" {
			errorMsg = errorResponse.Message
		}
		return "", fmt.Errorf("backend error: %s", errorMsg)
	}

	// Parse the success JSON response
	var csvResponse ErrorCsvResponse
	if err := json.Unmarshal(bodyBytes, &csvResponse); err != nil {
		return "", err
	}

	return csvResponse.Message, nil
}

func IsCsvFileReady(idType string, id string, headers map[string]string) (ErrorCsvReadyResponse, error) {
	readyURL := fmt.Sprintf("%s/api/v1/report/job-run/is-error-csv-ready/%s/%s", REPORT_SERVICE_URL, idType, id)
	resp, err := SendAPIRequest("GET", readyURL, nil, headers)
	if err != nil {
		return ErrorCsvReadyResponse{}, err
	}
	defer resp.Body.Close()

	// Read the response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return ErrorCsvReadyResponse{}, err
	}

	// Check for successful response
	if resp.StatusCode != http.StatusOK {
		var errorResponse ErrorResponse
		if err := json.Unmarshal(bodyBytes, &errorResponse); err != nil {
			return ErrorCsvReadyResponse{}, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(bodyBytes))
		}
		// Use displayMessage if available, otherwise fall back to message
		errorMsg := errorResponse.DisplayMessage
		if errorMsg == "" {
			errorMsg = errorResponse.Message
		}
		return ErrorCsvReadyResponse{}, fmt.Errorf("backend error: %s", errorMsg)
	}

	// Parse the JSON response
	var readyResponse ErrorCsvReadyResponse
	if err := json.Unmarshal(bodyBytes, &readyResponse); err != nil {
		return ErrorCsvReadyResponse{}, err
	}

	return readyResponse, nil
}

func DownloadErrorCsv(idType string, id string, headers map[string]string) (int, error) {
	downloadURL := fmt.Sprintf("%s/api/v1/report/job-run/download-error-csv/%s/%s", REPORT_SERVICE_URL, idType, id)
	resp, err := SendAPIRequest("GET", downloadURL, nil, headers)
	if err != nil {
		return 0, fmt.Errorf("failed to send download CSV request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Try to parse error response for better error messages
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return resp.StatusCode, fmt.Errorf("download CSV failed with status %d: %s", resp.StatusCode, resp.Status)
		}

		var errorResponse ErrorResponse
		if err := json.Unmarshal(bodyBytes, &errorResponse); err != nil {
			return resp.StatusCode, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(bodyBytes))
		}
		
		// Use displayMessage if available, otherwise fall back to message
		errorMsg := errorResponse.DisplayMessage
		if errorMsg == "" {
			errorMsg = errorResponse.Message
		}
		return resp.StatusCode, fmt.Errorf("backend error: %s", errorMsg)
	}

	return resp.StatusCode, nil
}

func PollForCsvReadiness(idType string, id string, headers map[string]string, maxAttempts int, pollInterval time.Duration) (bool, bool, error) {
	if pollInterval == 0 {
		pollInterval = 3 * time.Second
	}

	var lastResponse ErrorCsvReadyResponse
	for i := 0; i < maxAttempts; i++ {
		response, err := IsCsvFileReady(idType, id, headers)
		if err != nil {
			time.Sleep(pollInterval)
			continue
		}
		lastResponse = response

		if response.Data.Items.Ready {
			return response.Data.Items.Ready, response.Data.Items.Processing, nil
		}

		if i < maxAttempts-1 {
			time.Sleep(pollInterval)
		}
	}
	return lastResponse.Data.Items.Ready, lastResponse.Data.Items.Processing, nil
}
