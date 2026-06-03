package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Returns the Worker list for a given project ID
type WorkerResponse = ApiResponse[Worker]

// Worker represents a worker in the system with its details
type Worker struct {
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
	CreatedBy  string  `json:"createdBy"`
	UpdatedBy  *string `json:"updatedBy"`
	WorkerID   string  `json:"workerId"`
	ProjectID  string  `json:"projectId"`
	WorkerName string  `json:"workerName"`
	IPAddress  string  `json:"ipAddress"`
	Status     string  `json:"status"`
	Platform   string  `json:"platform"`
	Stats      Stats   `json:"stats"`
}

// Stats contains the statistics of a worker, including health status and system stats
type Stats struct {
	CreatedAt    string      `json:"createdAt"`
	UpdatedAt    string      `json:"updatedAt"`
	CreatedBy    *string     `json:"createdBy"`
	UpdatedBy    *string     `json:"updatedBy"`
	ID           string      `json:"id"`
	HealthStatus string      `json:"healthStatus"`
	SystemStats  SystemStats `json:"systemStats"`
	WorkerID     string      `json:"workerId"`
}

// SystemStats contains the system statistics of a worker, such as CPU and memory usage
type SystemStats struct {
	CPUUsage    string `json:"cpuUsage"`
	DiskLimit   string `json:"diskLimit"`
	DiskUsage   string `json:"diskUsage"`
	MemoryLimit string `json:"memoryLimit"`
	MemoryUsage string `json:"memoryUsage"`
}

// List workers returns a formatted string listing all available workers
func ListWorkers(projectID string, headers map[string]string) ([]Worker, error) {
	// Build the full URL
	fullURL := fmt.Sprintf("%s/api/v1/workers?projectId=%s", JOB_SERVICE_URL, projectID)

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, fullURL, nil, headers)
		if err != nil {
			return nil, fmt.Errorf("error while sending api request , err : %v", err)
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("error reading response body: %w", err)
		}

		// Parse the response JSON
		var response WorkerResponse
		err = json.Unmarshal(bodyBytes, &response)
		if err != nil {
			return nil, fmt.Errorf("error unmarshalling response JSON: %w", err)
		}

		if len(response.Data.Items) > 0 {
			return response.Data.Items, nil
		}
		Wait(DefaultPollInterval)
	}

	return nil, fmt.Errorf("no workers found for project ID: %s", projectID)
}

// ListAllWorkers returns every worker registered on the control plane across all
// projects (no projectId filter), used to discover workers to reuse.
func ListAllWorkers(headers map[string]string) ([]Worker, error) {
	fullURL := fmt.Sprintf("%s/api/v1/workers", JOB_SERVICE_URL)

	resp, err := SendAPIRequest(http.MethodGet, fullURL, nil, headers)
	if err != nil {
		return nil, fmt.Errorf("error while sending api request , err : %v", err)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %w", err)
	}

	var response WorkerResponse
	if err = json.Unmarshal(bodyBytes, &response); err != nil {
		return nil, fmt.Errorf("error unmarshalling response JSON: %w", err)
	}

	return response.Data.Items, nil
}

// GetWorkerStatus returns the status of a worker by its ID
func GetWorkerStatus(projectID string, workerIDs []string) (map[string]string, error) {
	fullURL := fmt.Sprintf("%s/api/v1/workers?projectId=%s", JOB_SERVICE_URL, projectID)

	fmt.Printf("\n[DEBUG GetWorkerStatus] Project ID: %s\n", projectID)
	fmt.Printf("[DEBUG GetWorkerStatus] Worker IDs to check: %+v\n", workerIDs)
	fmt.Printf("[DEBUG GetWorkerStatus] Full URL: %s\n", fullURL)

	headers := GetHeaders(AuthToken, ContentTypeJSON)
	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, fullURL, nil, headers)
		if err != nil {
			fmt.Printf("[DEBUG GetWorkerStatus] API request error on attempt %d: %v\n", attempt, err)
			return nil, fmt.Errorf("error while sending api request , err : %v", err)
		}

		LogDebug(fmt.Sprintf("Getting Worker Status for IDs %+v , attempt %d", workerIDs, attempt))
		fmt.Printf("[DEBUG GetWorkerStatus] HTTP Status Code: %d (attempt %d)\n", resp.StatusCode, attempt)

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			fmt.Printf("[DEBUG GetWorkerStatus] Error reading response body: %v\n", err)
			return nil, fmt.Errorf("error reading response body: %w", err)
		}

		fmt.Printf("[DEBUG GetWorkerStatus] Response body length: %d bytes\n", len(bodyBytes))
		fmt.Printf("[DEBUG GetWorkerStatus] Response body: %s\n", string(bodyBytes))

		// Parse the response JSON
		var response WorkerResponse
		err = json.Unmarshal(bodyBytes, &response)
		if err != nil {
			fmt.Printf("[DEBUG GetWorkerStatus] JSON unmarshal error: %v\n", err)
			return nil, fmt.Errorf("error unmarshalling response JSON: %w", err)
		}

		fmt.Printf("[DEBUG GetWorkerStatus] Number of workers in response: %d\n", len(response.Data.Items))
		if len(response.Data.Items) > 0 {
			fmt.Printf("[DEBUG GetWorkerStatus] Workers found:\n")
			for i, worker := range response.Data.Items {
				fmt.Printf("  [%d] WorkerID: %s, Status: %s, IPAddress: %s\n", i, worker.WorkerID, worker.Status, worker.IPAddress)
			}

			workerStatus := make(map[string]string)
			for _, worker := range response.Data.Items {
				for _, workerID := range workerIDs {
					if workerID == worker.WorkerID {
						workerStatus[workerID] = worker.Status
						fmt.Printf("[DEBUG GetWorkerStatus] Matched worker %s with status: %s\n", workerID, worker.Status)
					}
				}
			}
			fmt.Printf("[DEBUG GetWorkerStatus] Final worker status map: %+v\n", workerStatus)
			return workerStatus, nil
		}
		fmt.Printf("[DEBUG GetWorkerStatus] No workers found in response, waiting %d seconds before retry\n", DefaultPollInterval)
		Wait(DefaultPollInterval)
	}
	fmt.Printf("[DEBUG GetWorkerStatus] Max retries exceeded, no workers found\n")
	return nil, fmt.Errorf("no workers found for project ID: %s", projectID)
}

func GetAddFilesToWorkerScript(localFilePath, remoteTargetPath, workerInstance string) string {
	script := fmt.Sprintf(`#!/bin/bash
    set -e

    SUDO_PASS="%%s"

    FILE_SRC="%s"
    FILE_DEST="%s"
    INSTANCE="%s"

    echo "Transferring $FILE_SRC to $INSTANCE:$FILE_DEST"
    multipass transfer "$FILE_SRC" "$INSTANCE:$FILE_DEST"

    echo "File successfully transferred."
    `, localFilePath, remoteTargetPath, workerInstance)
	return script
}
